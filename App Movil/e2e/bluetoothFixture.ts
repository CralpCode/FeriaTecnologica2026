import { expect, Page } from '@playwright/test';

/** In-browser BLE device double. Never opens a real adapter or posts sensor data. */
export async function mockBluetooth(page: Page) {
  await page.addInitScript(() => {
    const callbacks = new Map<string, Function>();
    let hex = '', id = '', configured = false;
    const fixture = { frames: [] as string[], credentials: null as any, fail: false, emit: (_: any) => {} };
    const emit = (packet: any) => {
      const raw = JSON.stringify(packet) + '\n';
      for (let i = 0; i < raw.length; i += 20) {
        const bytes = new TextEncoder().encode(raw.slice(i, i + 20));
        callbacks.get('characteristicvaluechanged')?.({ target: { value: new DataView(bytes.buffer) } });
      }
    };
    fixture.emit = emit;
    const characteristic = {
      startNotifications: async () => characteristic,
      addEventListener: (event: string, callback: Function) => callbacks.set(event, callback),
      writeValueWithResponse: async (bytes: BufferSource) => {
        const frame = new TextDecoder().decode(bytes);
        fixture.frames.push(frame);
        if (frame.startsWith('WIFI_BEGIN_')) { id = frame.slice(11); hex = ''; }
        if (frame.startsWith('WIFI_PART_')) hex += frame.slice(10);
        if (frame.startsWith('WIFI_APPLY_')) {
          fixture.credentials = JSON.parse(hex.match(/../g)!.map(s => String.fromCharCode(parseInt(s, 16))).join(''));
          configured = !fixture.fail;
          emit({ type: 'wifi_status', id, state: configured ? 'connected' : 'failed', saved: configured, error: configured ? '' : 'connection_failed' });
        }
        if (frame.startsWith('WIFI_STATUS_')) emit({ type: 'wifi_status', id: frame.slice(12), state: configured ? 'connected' : 'disabled', saved: configured, error: '' });
        if (frame.startsWith('WIFI_FORGET_')) {
          configured = false;
          emit({ type: 'wifi_status', id: frame.slice(12), state: 'disabled', saved: false, error: '' });
        }
      },
    };
    const device: any = { name: 'SpiroScan-Band', addEventListener: () => {}, gatt: {
      connected: false,
      connect: async () => {
        device.gatt.connected = true;
        return { getPrimaryService: async (uuid: string) => {
          if (!uuid.startsWith('4faf')) throw new Error('No HR fallback in fixture');
          return { getCharacteristic: async () => characteristic };
        } };
      },
      disconnect: () => { device.gatt.connected = false; },
    } };
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => device } });
    (window as any).bleFixture = fixture;
  });
}

export async function connectBluetoothAndWifi(page: Page) {
  await page.getByRole('button', { name: 'Conectar dispositivo', exact: true }).click();
  await expect(page.getByLabel('Nombre de la red WiFi')).toBeDisabled();
  await page.getByRole('button', { name: 'Buscar y enlazar', exact: true }).click();
  await expect(page.getByLabel('Nombre de la red WiFi')).toBeEnabled();
  await page.getByLabel('Nombre de la red WiFi').fill('Red prueba');
  await page.getByLabel('Contraseña del WiFi').fill('Prueba123!');
  await page.getByRole('button', { name: 'Guardar y conectar WiFi', exact: true }).click();
  await expect(page.getByText('WiFi conectado y guardado en el ESP32.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Contraseña del WiFi')).toHaveValue('');
  await page.getByRole('button', { name: 'Recibir datos en este paciente', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).not.toBeVisible();
}
