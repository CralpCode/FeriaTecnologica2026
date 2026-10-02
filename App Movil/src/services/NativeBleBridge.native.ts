import { BleManager, Device, BleError, Characteristic } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';
import { RawDevicePacket } from '../types/vitals';

export interface NativeBleService {
  isAvailable: boolean;
  scanAndConnect(
    onData: (packet: RawDevicePacket) => void,
    onDisconnect: () => void
  ): Promise<{ success: boolean; message: string; deviceName?: string }>;
  disconnect(): Promise<void>;
  getConnected(): boolean;
}

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const HR_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb';
const HR_CHAR_UUID = '00002a37-0000-1000-8000-00805f9b34fb';

// Decodificador seguro Base64 a UTF-8 para Android / iOS
function base64ToUtf8(base64: string): string {
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let str = '';
    let buffer = 0;
    let bits = 0;

    for (let i = 0; i < base64.length; i++) {
      const c = base64.charAt(i);
      if (c === '=') break;
      const index = chars.indexOf(c);
      if (index === -1) continue;

      buffer = (buffer << 6) | index;
      bits += 6;

      if (bits >= 8) {
        bits -= 8;
        str += String.fromCharCode((buffer >> bits) & 0xff);
      }
    }
    return str;
  } catch {
    return '';
  }
}

class NativeBleServiceImpl implements NativeBleService {
  public isAvailable: boolean = true;
  private manager: BleManager | null = null;
  private connectedDevice: Device | null = null;
  private isScanning: boolean = false;
  private packetBuffer: string = '';

  private getManager(): BleManager {
    if (!this.manager) {
      this.manager = new BleManager();
    }
    return this.manager;
  }

  private async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;

    try {
      if (Platform.Version >= 31) {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return (
          result['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
          result['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      console.warn('[Native BLE Permissions Error]:', err);
      return false;
    }
  }

  public getConnected(): boolean {
    return this.connectedDevice !== null;
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.isScanning && this.manager) {
        this.manager.stopDeviceScan();
        this.isScanning = false;
      }
      if (this.connectedDevice) {
        await this.connectedDevice.cancelConnection();
      }
    } catch {}
    this.connectedDevice = null;
    this.packetBuffer = '';
  }

  private parseOrBufferPacket(text: string): RawDevicePacket | null {
    this.packetBuffer += text;

    // Buscar si hay un objeto JSON completo en el buffer
    const start = this.packetBuffer.indexOf('{');
    const end = this.packetBuffer.lastIndexOf('}');

    if (start !== -1 && end > start) {
      const candidate = this.packetBuffer.substring(start, end + 1);
      try {
        const parsed = JSON.parse(candidate);
        this.packetBuffer = this.packetBuffer.substring(end + 1);
        return parsed;
      } catch {
        // Paquete fragmentado aún
      }
    }

    if (this.packetBuffer.length > 2048) {
      this.packetBuffer = '';
    }
    return null;
  }

  public async scanAndConnect(
    onData: (packet: RawDevicePacket) => void,
    onDisconnect: () => void
  ): Promise<{ success: boolean; message: string; deviceName?: string }> {
    const hasPerms = await this.requestPermissions();
    if (!hasPerms) {
      return { success: false, message: 'Permisos de Bluetooth no concedidos en tu teléfono Android.' };
    }

    const mgr = this.getManager();

    // Comprobar estado del adaptador Bluetooth en el celular
    const state = await mgr.state();
    if (state !== 'PoweredOn') {
      return { success: false, message: 'Por favor enciende el Bluetooth de tu teléfono Android.' };
    }

    if (this.isScanning) {
      mgr.stopDeviceScan();
      this.isScanning = false;
    }

    this.packetBuffer = '';

    return new Promise<{ success: boolean; message: string; deviceName?: string }>((resolve) => {
      this.isScanning = true;
      let resolved = false;

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.isScanning = false;
          mgr.stopDeviceScan();
          resolve({
            success: false,
            message: 'Tiempo de espera agotado: No se detectó el ESP32 SpiroScan-Band cerca.',
          });
        }
      }, 15000);

      mgr.startDeviceScan(null, null, async (error: BleError | null, scannedDevice: Device | null) => {
        if (error) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            this.isScanning = false;
            mgr.stopDeviceScan();
            resolve({ success: false, message: `Error escaneando Bluetooth: ${error.message}` });
          }
          return;
        }

        if (!scannedDevice || resolved) return;

        const name = scannedDevice.name || scannedDevice.localName || '';
        const isMatch = name.includes('SpiroScan') || name.startsWith('Spiro');

        if (isMatch) {
          resolved = true;
          clearTimeout(timeoutId);
          this.isScanning = false;
          mgr.stopDeviceScan();

          try {
            console.log('[Native BLE] Conectando a:', name, scannedDevice.id);
            const connected = await scannedDevice.connect({ timeout: 10000 });

            // CRÍTICO PARA ANDROID: Negociar MTU alto (512 bytes) para recibir el paquete JSON completo
            if (Platform.OS === 'android') {
              try {
                await connected.requestMTU(512);
                console.log('[Native BLE] MTU 512 negociado exitosamente.');
              } catch (mtuErr) {
                console.warn('[Native BLE] No se pudo solicitar MTU 512, reintentando con 256:', mtuErr);
                try {
                  await connected.requestMTU(256);
                } catch {}
              }
            }

            await connected.discoverAllServicesAndCharacteristics();
            this.connectedDevice = connected;

            connected.onDisconnected(() => {
              console.warn('[Native BLE] Desconectado de:', name);
              this.connectedDevice = null;
              this.packetBuffer = '';
              onDisconnect();
            });

            let receivedCustomData = false;

            // 1. Canal Primario: Telemetría Completa JSON de SpiroScan
            try {
              connected.monitorCharacteristicForService(
                SERVICE_UUID,
                CHAR_UUID,
                (charError: BleError | null, characteristic: Characteristic | null) => {
                  if (charError || !characteristic?.value) return;
                  try {
                    const text = base64ToUtf8(characteristic.value);
                    const packet = this.parseOrBufferPacket(text);
                    if (packet && (packet.bpm !== undefined || (packet as any).heartRate !== undefined)) {
                      receivedCustomData = true;
                      onData(packet);
                    }
                  } catch (parseErr) {
                    console.warn('[Native BLE Parse Error]:', parseErr);
                  }
                }
              );
              console.log('[Native BLE] Suscrito a telemetría JSON principal.');
            } catch (serviceErr) {
              console.warn('[Native BLE] Canal JSON no disponible directamente:', serviceErr);
            }

            // 2. Canal de Respaldo: Heart Rate Standard (0x180D / 0x2A37)
            try {
              connected.monitorCharacteristicForService(
                HR_SERVICE_UUID,
                HR_CHAR_UUID,
                (hrError: BleError | null, hrChar: Characteristic | null) => {
                  if (hrError || !hrChar?.value) return;
                  if (receivedCustomData) return; // Si ya se recibe JSON completo, no sobreescribir

                  try {
                    const raw = base64ToUtf8(hrChar.value);
                    if (raw.length >= 2) {
                      const flags = raw.charCodeAt(0);
                      const bpm = flags & 0x01
                        ? (raw.charCodeAt(1) | (raw.charCodeAt(2) << 8))
                        : raw.charCodeAt(1);

                      if (bpm > 0) {
                        // El canal estándar solo trae el pulso: el resto queda en 0 (sin dato), nunca inventado.
                        onData({
                          bpm,
                          spo2: 0,
                          systolic: 0,
                          diastolic: 0,
                          audio_rms: 0,
                          audio_peak: 0,
                          finger: true,
                          device_id: 'SpiroScan-Band',
                        });
                      }
                    }
                  } catch {}
                }
              );
              console.log('[Native BLE] Suscrito a canal Heart Rate estándar de respaldo.');
            } catch {}

            resolve({
              success: true,
              message: `¡Enlazado exitosamente a ${name}!`,
              deviceName: name,
            });
          } catch (connErr: any) {
            console.error('[Native BLE Connect Error]:', connErr);
            resolve({
              success: false,
              message: `Fallo al enlazar con ${name}: ${connErr?.message || connErr}`,
            });
          }
        }
      });
    });
  }
}

export const nativeBle: NativeBleService = new NativeBleServiceImpl();
