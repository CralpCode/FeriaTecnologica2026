export interface WifiStatus {
  type: 'wifi_status';
  id: string;
  state: 'waiting_bluetooth' | 'disabled' | 'connecting' | 'connected' | 'failed';
  saved: boolean;
  error: string;
}

const messages: Record<string, string> = {
  connection_failed: 'No se pudo conectar. Revisa la contraseña y que la red sea de 2.4 GHz.',
  connection_lost: 'El ESP32 perdió la conexión WiFi.',
  recording_busy: 'Espera a que termine la grabación para configurar el WiFi.',
  invalid_config: 'El ESP32 rechazó la configuración. Revisa la red y la contraseña.',
  storage_error: 'No se pudo guardar la configuración en el ESP32.',
  bluetooth_required: 'Primero conecta el ESP32 por Bluetooth.',
};
export const wifiErrorMessage = (code: string) => messages[code] || 'No se pudo configurar el WiFi.';

// JSON stays ASCII on the wire; cJSON restores Unicode on the ESP32.
export function wifiFrames(ssid: string, password: string, id: string): string[] {
  const bytes = (s: string) => encodeURIComponent(s).replace(/%[0-9A-F]{2}|[^%]/g, 'x').length;
  if (!/^[a-f0-9]{8}$/.test(id)) throw new Error('Identificador inválido.');
  if (/[\u0000-\u001f\u007f]/.test(ssid + password)) throw new Error('La red y la contraseña contienen caracteres no admitidos.');
  let s: number, p: number;
  try { s = bytes(ssid); p = bytes(password); } catch { throw new Error('La red o la contraseña contienen texto inválido.'); }
  if (!s || s > 32) throw new Error('El nombre de la red debe tener entre 1 y 32 bytes.');
  if (p && (p < 8 || p > 63) && !/^[a-fA-F0-9]{64}$/.test(password)) {
    throw new Error('La contraseña debe tener entre 8 y 63 bytes; déjala vacía si la red es abierta.');
  }
  const json = JSON.stringify({ ssid, password }).replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const hex = Array.from(json, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const frames = [`WIFI_BEGIN_${id}`];
  for (let i = 0; i < hex.length; i += 10) frames.push(`WIFI_PART_${hex.slice(i, i + 10)}`);
  frames.push(`WIFI_APPLY_${id}`);
  return frames;
}

export class WifiProvisioner {
  private listeners = new Set<(status: WifiStatus) => void>();
  private pending: { id: string; goal: 'connected' | 'disabled'; resolve: (s: WifiStatus) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private queryId = '';
  private sequence = 0;
  public status: WifiStatus | null = null;

  constructor(private connected: () => boolean, private write: (frame: string) => Promise<boolean>, private timeoutMs = 45000) {}
  private id() { return ((Date.now() + ++this.sequence) >>> 0).toString(16).padStart(8, '0'); }
  public subscribe(listener: (status: WifiStatus) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  public receive(raw: unknown): boolean {
    const s = raw as WifiStatus;
    if (s?.type !== 'wifi_status') return false;
    if (!/^[a-fA-F0-9]{8}$/.test(s.id) || !['waiting_bluetooth', 'disabled', 'connecting', 'connected', 'failed'].includes(s.state)
      || typeof s.saved !== 'boolean' || typeof s.error !== 'string') return true;
    if (s.id !== this.pending?.id && s.id !== this.queryId) return true;
    this.status = s;
    this.listeners.forEach(l => l(s));
    if (this.pending?.id === s.id) {
      if (s.error || s.state === 'failed') this.fail(wifiErrorMessage(s.error));
      else if (s.state === this.pending.goal) {
        const p = this.pending; this.pending = null; clearTimeout(p.timer); p.resolve(s);
      }
    }
    return true;
  }
  private fail(message: string) {
    const p = this.pending; this.pending = null;
    if (p) { clearTimeout(p.timer); p.reject(new Error(message)); }
  }
  public disconnect() { this.fail('Se perdió Bluetooth durante la configuración.'); this.status = null; this.queryId = ''; }
  public async query() {
    if (this.pending) return;
    if (!this.connected()) throw new Error(messages.bluetooth_required);
    this.queryId = this.id();
    if (!await this.write(`WIFI_STATUS_${this.queryId}`)) throw new Error('No se pudo consultar el WiFi por Bluetooth.');
  }
  public configure(ssid: string, password: string): Promise<WifiStatus> {
    if (!this.connected()) return Promise.reject(new Error(messages.bluetooth_required));
    const id = this.id();
    let frames: string[];
    try { frames = wifiFrames(ssid, password, id); } catch (e) { return Promise.reject(e); }
    return this.perform(id, frames, 'connected');
  }
  public forget(): Promise<WifiStatus> {
    const id = this.id();
    return this.perform(id, [`WIFI_FORGET_${id}`], 'disabled');
  }
  private perform(id: string, frames: string[], goal: 'connected' | 'disabled'): Promise<WifiStatus> {
    if (!this.connected()) return Promise.reject(new Error(messages.bluetooth_required));
    if (this.pending) return Promise.reject(new Error('Ya hay una configuración en curso.'));
    this.queryId = id;
    return new Promise((resolve, reject) => {
      this.pending = { id, goal, resolve, reject, timer: setTimeout(() => this.fail('El ESP32 no confirmó la conexión. Revisa que tenga el firmware actualizado.'), this.timeoutMs) };
      (async () => {
        for (const frame of frames) {
          if (this.pending?.id !== id) return;
          if (!this.connected() || !await this.write(frame)) throw new Error('No se pudo enviar la configuración por Bluetooth.');
        }
      })().catch(() => { if (this.pending?.id === id) this.fail('No se pudo enviar la configuración por Bluetooth.'); });
    });
  }
}
