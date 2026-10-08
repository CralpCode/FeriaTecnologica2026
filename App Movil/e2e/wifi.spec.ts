import { test, expect } from '@playwright/test';
import { mockBluetooth } from './bluetoothFixture';

test('Bluetooth first, wrong password, retry, confirmed WiFi and forget', async ({ page }) => {
  await mockBluetooth(page);
  const requests: string[] = [];
  page.on('request', request => { if (request.postData()) requests.push(request.postData()!); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Conectar dispositivo', exact: true }).click();
  await expect(page.getByLabel('Nombre de la red WiFi')).toBeDisabled();
  await expect(page.getByLabel('Contraseña del WiFi')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Guardar y conectar WiFi', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Buscar y enlazar', exact: true }).click();
  await expect(page.getByLabel('Nombre de la red WiFi')).toBeEnabled();
  await page.getByLabel('Nombre de la red WiFi').fill('Mi red ñ');
  await page.getByLabel('Contraseña del WiFi').fill(' AbC!ñ123 ');
  await page.evaluate(() => { (window as any).bleFixture.fail = true; });
  await page.getByRole('button', { name: 'Guardar y conectar WiFi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recibir datos en este paciente', exact: true })).toBeDisabled();
  await expect(page.getByText(/No se pudo conectar. Revisa la contraseña/).first()).toBeVisible();
  await page.evaluate(() => { (window as any).bleFixture.fail = false; });
  await page.getByRole('button', { name: 'Guardar y conectar WiFi', exact: true }).click();
  await expect(page.getByText('WiFi conectado y guardado en el ESP32.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Contraseña del WiFi')).toHaveValue('');
  expect(await page.evaluate(() => (window as any).bleFixture.credentials)).toEqual({ ssid: 'Mi red ñ', password: ' AbC!ñ123 ' });
  expect(await page.evaluate(() => (window as any).bleFixture.frames.every((f: string) => f.length <= 20))).toBe(true);
  expect(requests.some(body => body.includes('AbC!'))).toBe(false);
  // Keeping BLE connected must not switch the selected server transport back.
  await page.getByRole('button', { name: 'Recibir datos en este paciente', exact: true }).click();
  await page.evaluate(() => (window as any).bleFixture.emit({ v: 2, valid: 1, bpm: 78, finger: true, source: 'real' }));
  await page.getByRole('button', { name: 'Dispositivo conectado', exact: true }).click();
  await expect(page.getByText(/^ESP32 por WiFi/)).toBeVisible();
  expect(requests.some(body => body.includes('"bpm":78'))).toBe(false);
  await page.getByRole('button', { name: 'Olvidar red WiFi', exact: true }).click();
  await expect(page.getByText('WiFi sin configurar. Bluetooth sigue disponible.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bluetooth conectado', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recibir datos en este paciente', exact: true })).toBeDisabled();
});
