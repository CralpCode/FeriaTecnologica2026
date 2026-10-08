import { BleManager, Device, BleError, Characteristic } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';
import { DevicePacketBuffer } from './DevicePacketBuffer';
import { decodeHeartRateMeasurement } from './measurementQuality';
import { RawDevicePacket } from '../types/vitals';

export interface NativeBleService {
  isAvailable: boolean;
  scanAndConnect(
    onData: (packet: RawDevicePacket) => void,
    onDisconnect: () => void
  ): Promise<{ success: boolean; message: string; deviceName?: string }>;
  disconnect(): Promise<void>;
  getConnected(): boolean;
  sendCommand(cmd: string): Promise<boolean>;
}

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const HR_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb';
const HR_CHAR_UUID = '00002a37-0000-1000-8000-00805f9b34fb';

// Codificador seguro ASCII a Base64 para Android / iOS
function asciiToBase64(str: string): string {
  const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;
  while (i < str.length) {
    const c1 = str.charCodeAt(i++);
    const c2 = i < str.length ? str.charCodeAt(i++) : NaN;
    const c3 = i < str.length ? str.charCodeAt(i++) : NaN;

    const b1 = (c1 >> 2) & 0x3F;
    const b2 = ((c1 & 0x3) << 4) | (isNaN(c2) ? 0 : (c2 >> 4) & 0x0F);
    const b3 = isNaN(c2) ? 64 : (((c2 & 0x0F) << 2) | (isNaN(c3) ? 0 : (c3 >> 6) & 0x03));
    const b4 = isNaN(c3) ? 64 : (c3 & 0x3F);

    result += b64.charAt(b1) + b64.charAt(b2) +
      (b3 === 64 ? '=' : b64.charAt(b3)) +
      (b4 === 64 ? '=' : b64.charAt(b4));
  }
  return result;
}

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
  private packetBuffer = new DevicePacketBuffer();

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
    this.packetBuffer.clear();
  }

  public async sendCommand(cmd: string): Promise<boolean> {
    if (!this.connectedDevice) {
      console.warn('[Native BLE] No hay dispositivo conectado para enviar comando');
      return false;
    }
    const cleanCmd = cmd.trim();
    const base64Val = asciiToBase64(cleanCmd);
    // Configuration frames contain credentials. No logging or ambiguous retry.
    if (cleanCmd.startsWith('WIFI_')) {
      try {
        await this.connectedDevice.writeCharacteristicWithResponseForService(SERVICE_UUID, CHAR_UUID, base64Val);
        return true;
      } catch { return false; }
    }
    console.log(`[Native BLE] Despachando comando "${cleanCmd}" (Base64: ${base64Val})...`);

    // Intento 1: Con respuesta (GATT Write Request estándar con ACK a nivel de enlace)
    try {
      await this.connectedDevice.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        CHAR_UUID,
        base64Val
      );
      console.log(`[Native BLE] ¡Comando "${cleanCmd}" entregado con éxito (writeWithResponse)!`);
      return true;
    } catch (errWithResp: any) {
      console.warn(`[Native BLE] writeWithResponse falló (${errWithResp?.message || errWithResp}). Reintentando con writeWithoutResponse...`);
      try {
        await this.connectedDevice.writeCharacteristicWithoutResponseForService(
          SERVICE_UUID,
          CHAR_UUID,
          base64Val
        );
        console.log(`[Native BLE] Comando "${cleanCmd}" enviado (writeWithoutResponse).`);
        return true;
      } catch (fallbackErr) {
        console.error(`[Native BLE] Error total al enviar comando "${cleanCmd}":`, fallbackErr);
        return false;
      }
    }
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

    this.packetBuffer.clear();

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

      mgr.startDeviceScan(null, { allowDuplicates: false }, async (error: BleError | null, scannedDevice: Device | null) => {
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

          // Respiro de 80ms para que el chip Bluetooth de Android libere el modo escaneo
          // antes de abrir la conexión GATT (evita congelamientos de la pila Fluoride/Bluedroid)
          await new Promise((r) => setTimeout(r, 80));

          try {
            console.log('[Native BLE] Conectando a:', name, scannedDevice.id);
            const connected = await scannedDevice.connect({ timeout: 8000 });

            // Negociar MTU alto (512 bytes) con timeout de seguridad para recepción JSON ágil
            if (Platform.OS === 'android') {
              try {
                await Promise.race([
                  connected.requestMTU(512),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('MTU timeout')), 1200)),
                ]);
                console.log('[Native BLE] MTU 512 negociado exitosamente.');
              } catch (mtuErr) {
                console.warn('[Native BLE] MTU 512 omitido o no respondido a tiempo.');
              }
            }

            await connected.discoverAllServicesAndCharacteristics();
            this.connectedDevice = connected;

            connected.onDisconnected(() => {
              console.warn('[Native BLE] Desconectado de:', name);
              this.connectedDevice = null;
              this.packetBuffer.clear();
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
                    for (const packet of this.packetBuffer.push(text)) {
                      if ((packet as any).type === 'wifi_status') onData(packet);
                      else if (packet.bpm !== undefined || (packet as any).heartRate !== undefined) {
                        receivedCustomData = true;
                        onData(packet);
                      }
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
                    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
                    const packet = decodeHeartRateMeasurement(bytes);
                    if (packet) onData(packet);
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
