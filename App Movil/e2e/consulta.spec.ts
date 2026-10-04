import { APIRequestContext, expect, Page, test } from '@playwright/test';

/**
 * Recorre una consulta completa como lo haría el médico, con el ESP32 simulado por la API.
 * Revisa que la interfaz llegue a cada estado; no evalúa exactitud clínica (el audio es sintético).
 */

const SR = 16000;

/** Latido sintético (S1 y S2) a 72 por minuto: PCM de 16 bits, como lo envía el ESP32. */
function heartbeatPcm(seconds = 15): Buffer {
  const n = SR * seconds;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = (Math.random() - 0.5) * 0.02;
  for (let beat = 0; beat < seconds; beat += 60 / 72) {
    for (const [start, f, dur] of [[beat, 60, 0.05], [beat + 0.3, 90, 0.04]]) {
      const i0 = Math.floor(start * SR); const len = Math.floor(dur * SR);
      for (let k = 0; k < len && i0 + k < n; k++) {
        y[i0 + k] += 0.6 * Math.sin((2 * Math.PI * f * k) / SR) * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / len));
      }
    }
  }
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(y[i] * 32767))), i * 2);
  return buf;
}

function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** El ESP32: toma la preparación vigente y envía la grabación en bloques de 0.5 s. */
async function simulateRecording(api: APIRequestContext) {
  const start = await (await api.post('/api/audio/start', { data: { device_id: 'esp32', sample_rate: SR } })).json();
  const pcm = heartbeatPcm();
  for (let i = 0; i < pcm.length; i += SR) {   // SR bytes = 0.5 s de audio de 16 bits
    await api.post(`/api/audio/chunk?recording_id=${start.recording_id}`, {
      data: pcm.subarray(i, i + SR), headers: { 'Content-Type': 'application/octet-stream' },
    });
  }
  const res = await api.post(`/api/audio/finish?recording_id=${start.recording_id}`);
  expect(res.ok()).toBeTruthy();
}

async function sendPulse(api: APIRequestContext, seconds = 7) {
  for (let i = 0; i < seconds; i++) {
    await api.post('/api/telemetry', {
      data: { bpm: 72 + (i % 3), source: 'real', heartRateValid: true, bloodOxygenValid: false, spo2Calibrated: false,
              signalQuality: 'good', sampleAgeMs: 0, finger: true },
    });
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name }).first();

test('consulta completa: paciente, datos, pulso, corazón, resultado, notas, informe e historial', async ({ page, request }, info) => {
  const code = `E2E${info.project.name === 'celular' ? 'CEL' : 'PC'}${Date.now() % 100000}`;
  const other = `e2eotro${info.project.name === 'celular' ? 'c' : 'p'}${Date.now() % 1000}`;
  page.on('popup', (p) => p.close().catch(() => {}));   // el PDF se abre en otra pestaña

  // 1. Paciente nuevo
  await page.goto('/');
  await button(page, 'Nuevo paciente').click();
  await page.getByLabel('Código o iniciales del paciente').fill(code);
  await button(page, 'Crear paciente').click();

  // 2. Datos y síntomas
  await expect(page.getByLabel('Edad en años')).toBeVisible();
  await page.getByLabel('Edad en años').fill('40');
  await page.getByRole('radio', { name: /reposo.*: Sí$/ }).click();
  await button(page, 'Guardar y continuar').click();

  // 3. Pulso (paquetes válidos del "ESP32")
  await expect(page.getByText('Dedo índice sobre el sensor', { exact: false })).toBeVisible();
  const connect = page.getByRole('button', { name: 'Conectar ESP32' });
  if (await connect.isVisible()) await connect.click();
  await sendPulse(request);
  await expect(page.getByText('Lectura válida').first()).toBeVisible();
  await button(page, 'Continuar a corazón').click();

  // 4. Corazón: foco aórtico, preparar y grabación simulada
  await button(page, /^Foco aórtico: pendiente/).click();
  await button(page, /^Preparar grabación · Aórtico/).click();
  await expect(page.getByText('Presiona 1 s el botón', { exact: false })).toBeVisible();
  await simulateRecording(request);
  await expect(button(page, /^Foco aórtico: (grabado|repetir)/)).toBeVisible({ timeout: 60_000 });

  // 5. Resultado: mapa, notas e informe
  await page.getByRole('tab', { name: /^Paso 6: Resultado/ }).click();
  await expect(page.getByText('Mapa de hallazgos')).toBeVisible();
  await page.getByLabel('Notas del médico').fill('Nota de prueba automática.');
  await button(page, 'Guardar notas').click();
  await expect(page.getByText('Notas guardadas', { exact: false })).toBeVisible();
  await button(page, 'Informe PDF').click();
  await expect(page.getByText('Informe listo')).toBeVisible({ timeout: 60_000 });

  // 6. Historial: otro paciente (creado por la API) se archiva y se restaura
  const up = await request.post('/api/audio/upload', {
    multipart: { file: { name: 'a.wav', mimeType: 'audio/wav', buffer: wav(heartbeatPcm(10)) },
                 session_id: other, location: 'AV', source: 'simulated' },
  });
  expect(up.ok()).toBeTruthy();
  await page.getByRole('tab', { name: /^Historial/ }).click();
  await page.getByLabel('Buscar paciente por código').fill(other.toUpperCase());
  await button(page, new RegExp(`^${other.toUpperCase()}\\.`)).click();
  await button(page, 'Archivar').click();
  await expect(page.getByText('se archivó', { exact: false })).toBeVisible();
  await button(page, 'Archivados').click();
  await button(page, new RegExp(`^${other.toUpperCase()}\\.`)).click();
  await button(page, 'Restaurar a la lista').click();
  await expect(page.getByText('volvió a la lista', { exact: false })).toBeVisible();
});
