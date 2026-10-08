/**
 * Onda de una grabación real: se descarga el WAV del servidor, se decodifica con Web Audio y se resume en picos.
 * Solo en web (en Android no hay decodificador); si algo falla, no se dibuja nada (nunca se inventa una onda).
 */
const cache = new Map<string, Promise<number[] | null>>();
const gains = new Map<string, number>();

/** El micrófono del estetoscopio da un golpe al arrancar (hasta ~0,5 s): la onda y la escucha empiezan después. */
export const START_SKIP_S = 0.6;
const MAX_PLAYBACK_GAIN = 30;   // hasta +30 dB para que los latidos suaves se oigan

/** Ganancia de escucha calculada al dibujar la onda (1 si todavía no se calculó). */
export function playbackGain(url: string): number {
  return gains.get(url) ?? 1;
}

export function waveformSupported(): boolean {
  return typeof window !== 'undefined' && !!((window as any).AudioContext || (window as any).webkitAudioContext)
    && typeof fetch === 'function';
}

async function compute(url: string, bars: number): Promise<number[] | null> {
  const Ctx = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const Live = (window as any).AudioContext || (window as any).webkitAudioContext;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.arrayBuffer();
  // Un contexto fuera de línea evita pedir permiso de audio al navegador solo para decodificar
  const ctx = Ctx ? new Ctx(1, 2, 44100) : new Live();
  const buffer: AudioBuffer = await new Promise((ok, fail) => {
    const p = ctx.decodeAudioData(data, ok, fail);
    if (p && typeof p.then === 'function') p.then(ok, fail);
  });
  if (!Ctx && typeof ctx.close === 'function') ctx.close();
  const all = buffer.getChannelData(0);
  const skip = Math.floor(START_SKIP_S * buffer.sampleRate);
  const ch = all.length > skip * 4 ? all.subarray(skip) : all;
  if (!ch.length) return null;
  const step = Math.max(1, Math.floor(ch.length / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    let max = 0;
    const end = Math.min(ch.length, (i + 1) * step);
    for (let j = i * step; j < end; j++) {
      const v = Math.abs(ch[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  // Volumen de escucha: lleva el percentil 99,9 de la señal a -6 dBFS (sin pasar de MAX_PLAYBACK_GAIN)
  const sorted = Array.from(ch, Math.abs).sort((a, b) => a - b);
  const p999 = sorted[Math.floor(sorted.length * 0.999)] || 0;
  gains.set(url, p999 > 0 ? Math.min(MAX_PLAYBACK_GAIN, Math.max(1, 0.5 / p999)) : 1);
  // Se normaliza para que se vea la forma; la altura no es el volumen real
  const top = Math.max(...peaks);
  return top > 0 ? peaks.map((p) => p / top) : peaks;
}

export function loadWaveform(url: string, bars = 120): Promise<number[] | null> {
  if (!waveformSupported()) return Promise.resolve(null);
  const key = `${url}|${bars}`;
  if (!cache.has(key)) {
    // Si falla (red, servidor reiniciando), no se guarda el fallo: el próximo intento vuelve a descargar
    cache.set(key, compute(url, bars).catch(() => { cache.delete(key); return null; }));
  }
  return cache.get(key)!;
}
