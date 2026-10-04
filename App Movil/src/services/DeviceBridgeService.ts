import { Platform } from 'react-native';
import { API_CONFIG, getSessionId } from '../config/api';
import { VitalSigns, RawDevicePacket } from '../types/vitals';
import { nativeBle } from './NativeBleBridge';
import { isLegacyPacket, LegacyPulseValidator } from './measurementQuality';

export { RawDevicePacket };

type VitalsListener = (vitals: VitalSigns) => void;
type StatusListener = (connected: boolean, deviceName: string | null) => void;

class DeviceBridgeService {
  private bluetoothDevice: any = null;
  private isConnected: boolean = false;
  private deviceName: string | null = null;
  private vitalsListeners: Set<VitalsListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();
  private relayToCloud: boolean = true;
  private ws: WebSocket | null = null;
  private shouldAutoReconnect: boolean = true;
  private reconnectAttempts: number = 0;
  private smoothedBpm: number = 0;
  private legacyPulse = new LegacyPulseValidator();

  public getConnected(): boolean {
    if (Platform.OS !== 'web') {
      return this.isConnected || nativeBle.getConnected();
    }
    return this.isConnected;
  }

  public getDeviceName(): string | null {
    return this.deviceName;
  }

  public setRelayToCloud(enabled: boolean) {
    this.relayToCloud = enabled;
  }

  public getRelayToCloud(): boolean {
    return this.relayToCloud;
  }

  public isWebBluetoothSupported(): boolean {
    if (Platform.OS !== 'web') {
      return nativeBle.isAvailable;
    }
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  /**
   * Conexión por enlace directo a la PC (puerto 8765) como fallback
   */
  public connectToDevice(deviceHost: string = '192.168.1.163', port: number = 8765) {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
    }

    const url = `ws://${deviceHost}:${port}`;
    console.log('[DeviceBridge] Conectando a enlace PC en:', url);

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.deviceName = 'SpiroScan PC Host';
        console.log('[DeviceBridge] ¡Enlace directo con la PC ESTABLECIDO!');
        this.notifyStatusListeners(true, this.deviceName);
      };

      this.ws.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          if (packet.data) {
            this.handleIncomingRawData(packet.data);
          } else if (packet.bpm !== undefined) {
            this.handleIncomingRawData(packet);
          }
        } catch (e) {}
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.notifyStatusListeners(false, null);
      };

      this.ws.onerror = (err) => {
        console.warn('[DeviceBridge] Error de conexión con PC:', err);
        this.isConnected = false;
        this.notifyStatusListeners(false, null);
      };
    } catch (err) {
      this.isConnected = false;
      this.notifyStatusListeners(false, null);
    }
  }

  /**
   * Escaneo y Enlace Directo Bluetooth BLE:
   * - En APK Nativo (Android): Utiliza react-native-ble-plx con escaneo por radio BLE nativo.
   * - En Navegador Web: Utiliza la Web Bluetooth API estándar de Chrome / Edge.
   */
  public async scanAndConnectRealBluetooth(): Promise<{ success: boolean; message: string; deviceName?: string }> {
    // 1. Caso Android Nativo (APK)
    if (Platform.OS !== 'web') {
      console.log('[BLE] Iniciando conexión Bluetooth Nativa Android en APK...');
      this.shouldAutoReconnect = true;

      try {
        const res = await nativeBle.scanAndConnect(
          (packet: RawDevicePacket) => {
            this.handleIncomingRawData(packet);
          },
          () => {
            console.warn('[BLE Native] Desconexión de dispositivo detectada');
            this.isConnected = false;
            this.deviceName = null;
            this.notifyStatusListeners(false, null);
          }
        );

        if (res.success) {
          this.isConnected = true;
          this.deviceName = res.deviceName || 'SpiroScan-Band';
          this.notifyStatusListeners(true, this.deviceName);
        }
        return res;
      } catch (err: any) {
        console.error('[BLE Native Error]:', err);
        return {
          success: false,
          message: `Error en Bluetooth nativo: ${err?.message || err}`,
        };
      }
    }

    // 2. Caso Navegador Web (Chrome / Edge)
    if (!this.isWebBluetoothSupported()) {
      return {
        success: false,
        message: 'Tu navegador no soporta Web Bluetooth. En Android abre la app en Google Chrome, o en PC usa Chrome/Edge.',
      };
    }

    try {
      this.shouldAutoReconnect = true;

      let device: any = null;
      try {
        // Intento 1: Filtrar directamente por el nombre anunciado del ESP32
        // @ts-ignore
        device = await navigator.bluetooth.requestDevice({
          filters: [
            { name: 'SpiroScan-Band' },
            { namePrefix: 'Spiro' },
          ],
          optionalServices: [
            '4fafc201-1fb5-459e-8fcc-c5c9c331914b', // SpiroScan Telemetría Completa JSON
            '0000180d-0000-1000-8000-00805f9b34fb', // Heart Rate Estándar (0x180D)
            '00001800-0000-1000-8000-00805f9b34fb', // Generic Access
            '0000180a-0000-1000-8000-00805f9b34fb', // Device Info
          ],
        });
      } catch (filterErr: any) {
        // Intento 2: Si el filtro no se seleccionó o falla, listar todos los dispositivos BLE
        // @ts-ignore
        device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [
            '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
            '0000180d-0000-1000-8000-00805f9b34fb',
            '00001800-0000-1000-8000-00805f9b34fb',
            '0000180a-0000-1000-8000-00805f9b34fb',
          ],
        });
      }

      if (!device) {
        return { success: false, message: 'No se seleccionó ningún dispositivo Bluetooth.' };
      }

      this.bluetoothDevice = device;
      this.deviceName = device.name || 'SpiroScan-Band';

      // Manejador de desconexión del servidor GATT
      device.addEventListener('gattserverdisconnected', () => {
        console.warn('[BLE] Servidor GATT desconectado de:', this.deviceName);
        this.isConnected = false;
        this.notifyStatusListeners(false, null);

        if (this.shouldAutoReconnect) {
          this.attemptReconnection();
        }
      });

      await this.connectGattServer(device);

      return {
        success: true,
        message: `¡Enlazado exitosamente a ${this.deviceName}!`,
        deviceName: this.deviceName || undefined,
      };
    } catch (error: any) {
      if (error.name === 'NotFoundError') {
        return { success: false, message: 'Búsqueda cancelada por el usuario.' };
      }
      console.error('[BLE Error]:', error);
      return { success: false, message: error.message || 'Error al conectar por Bluetooth.' };
    }
  }

  /**
   * Conecta al GATT server y suscribe las características de telemetría (Web Bluetooth)
   */
  private async connectGattServer(device: any) {
    console.log('[BLE Web] Conectando a GATT Server de:', device.name);
    const server = await device.gatt.connect();

    let subscribedCustom = false;

    // 1. Prioridad: Canal de Telemetría Completa JSON SpiroScan
    try {
      const customService = await server.getPrimaryService('4fafc201-1fb5-459e-8fcc-c5c9c331914b');
      const customChar = await customService.getCharacteristic('beb5483e-36e1-4688-b7f5-ea07361b26a8');
      await customChar.startNotifications();

      const textDecoder = new TextDecoder('utf-8');
      customChar.addEventListener('characteristicvaluechanged', (event: any) => {
        try {
          const str = textDecoder.decode(event.target.value);
          const packet: RawDevicePacket = JSON.parse(str);
          this.handleIncomingRawData(packet);
        } catch (e) {
          // Ignorar paquetes parciales si ocurren
        }
      });

      subscribedCustom = true;
      console.log('[BLE Web] ¡Suscripción a telemetría SpiroScan activa (100% tiempo real)!');
    } catch (e) {
      console.warn('[BLE Web] Servicio personalizado no disponible, verificando canal estándar...', e);
    }

    // 2. Canal Estándar Heart Rate (0x180D) de respaldo
    try {
      const hrService = await server.getPrimaryService('0000180d-0000-1000-8000-00805f9b34fb');
      const hrChar = await hrService.getCharacteristic('00002a37-0000-1000-8000-00805f9b34fb');
      await hrChar.startNotifications();
      hrChar.addEventListener('characteristicvaluechanged', (event: any) => {
        if (!subscribedCustom) {
          const value = event.target.value;
          const flags = value.getUint8(0);
          const bpm = flags & 0x01 ? value.getUint16(1, true) : value.getUint8(1);

          // El canal estándar solo trae el pulso: el resto queda en 0 (sin dato), nunca inventado.
          this.handleIncomingRawData({
            bpm: bpm,
            spo2: 0,
            systolic: 0,
            diastolic: 0,
            audio_rms: 0,
            audio_peak: 0,
            finger: bpm > 0,
          });
        }
      });
      console.log('[BLE Web] Canal Heart Rate estándar conectado.');
    } catch (e) {}

    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.notifyStatusListeners(true, this.deviceName);
  }

  /**
   * Intento de auto-reconexión cuando se pierde la señal BLE (Web)
   */
  private async attemptReconnection() {
    if (!this.bluetoothDevice || !this.shouldAutoReconnect) return;
    if (this.reconnectAttempts >= 5) {
      console.warn('[BLE Web] Máximo número de intentos de reconexión alcanzado.');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[BLE Web] Intentando auto-reconexión (${this.reconnectAttempts}/5)...`);

    setTimeout(async () => {
      try {
        if (this.bluetoothDevice && !this.isConnected && this.shouldAutoReconnect) {
          await this.connectGattServer(this.bluetoothDevice);
          console.log('[BLE Web] ¡Auto-reconexión exitosa!');
        }
      } catch (err) {
        console.warn('[BLE Web] Reintento fallido, programando siguiente intento...');
        this.attemptReconnection();
      }
    }, 2000);
  }

  public disconnect() {
    this.shouldAutoReconnect = false;
    this.isConnected = false;
    this.deviceName = null;
    this.smoothedBpm = 0;
    this.legacyPulse.reset();

    if (Platform.OS !== 'web') {
      nativeBle.disconnect().catch(() => {});
    }

    if (this.bluetoothDevice) {
      if (this.bluetoothDevice.gatt && this.bluetoothDevice.gatt.connected) {
        try {
          this.bluetoothDevice.gatt.disconnect();
        } catch (e) {}
      }
      this.bluetoothDevice = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }

    this.notifyStatusListeners(false, null);
  }

  public handleIncomingRawData(raw: RawDevicePacket) {
    // Si el usuario desconectó el dispositivo, ignorar paquetes residuales inmediatamente
    if (!this.isConnected) {
      return;
    }

    const isFingerPresent = raw.finger === true;
    // Formato original del firmware (sin indicadores de calidad): se valida aquí con la misma regla del servidor
    // y su SpO2, HRV y estrés no se muestran (el firmware original no tiene SpO2 calibrada).
    const legacy = isLegacyPacket(raw);
    const legacyCheck = legacy ? this.legacyPulse.check(raw.bpm, raw.finger) : null;
    const heartRateValid = legacyCheck ? legacyCheck.stable : (raw.heartRateValid ?? raw.heart_rate_valid) === true;
    const bloodOxygenValid = legacy ? false : (raw.bloodOxygenValid ?? raw.spo2_valid) === true;
    const spo2Calibrated = legacy ? false : (raw.spo2Calibrated ?? raw.spo2_calibrated) === true;
    // Preserve the measured values; never smooth away clinically relevant changes.
    const finalHeartRate = Number.isFinite(raw.bpm) ? raw.bpm : 0;
    const currentSpo2 = !legacy && Number.isFinite(raw.spo2) ? raw.spo2 : 0;

    const updatedVitals: VitalSigns = {
      heartRate: finalHeartRate,
      bloodOxygen: currentSpo2,
      // El MAX30102 no mide presión arterial ni temperatura corporal.
      systolicPressure: 0,
      diastolicPressure: 0,
      temperature: 0,
      hrv: legacy ? 0 : raw.hrv || 0,
      stressLevel: legacy ? 0 : raw.stress ?? raw.stress_score ?? 0,
      audio_rms: raw.audio_rms || 0.0,
      audio_peak: raw.audio_peak || 0.0,
      steps: 0,
      calories: 0,
      timestamp: new Date().toISOString(),
      device_connected: true,
      finger: isFingerPresent,
      audioUnit: raw.audioUnit,
      source: legacy ? (raw.test === true ? 'simulated' : 'real') : raw.source || 'unknown',
      heartRateValid,
      bloodOxygenValid,
      spo2Calibrated,
      signalQuality: legacyCheck
        ? (legacyCheck.stable ? 'good' : legacyCheck.finger ? 'unstable' : 'no_finger')
        : raw.signalQuality ?? raw.signal_quality ?? null,
      sampleAgeMs: legacy ? 0 : raw.sampleAgeMs ?? raw.sample_age_ms ?? null,
    };

    this.notifyVitalsListeners(updatedVitals);

    if (this.relayToCloud) {
      this.forwardToCloudApi(raw);
    }
  }

  private async forwardToCloudApi(data: RawDevicePacket) {
    try {
      const url = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.TELEMETRY}`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Solo se reenvía lo que trae el paquete (undefined no viaja en JSON): así el servidor
        // reconoce el formato original y aplica su propia validación, sin indicadores inventados.
        body: JSON.stringify({
          bpm: data.bpm,
          spo2: data.spo2,
          stress: data.stress ?? data.stress_score,
          hrv: data.hrv,
          audio_rms: data.audio_rms,
          audio_peak: data.audio_peak,
          finger: data.finger,
          test: data.test,
          audioUnit: data.audioUnit,
          source: data.source,
          heartRateValid: data.heartRateValid ?? data.heart_rate_valid,
          bloodOxygenValid: data.bloodOxygenValid ?? data.spo2_valid,
          spo2Calibrated: data.spo2Calibrated ?? data.spo2_calibrated,
          signalQuality: data.signalQuality ?? data.signal_quality,
          sampleAgeMs: data.sampleAgeMs ?? data.sample_age_ms,
          device_id: 'SpiroScan-Band',
          session_id: getSessionId(),
        }),
      });
    } catch (e) {}
  }

  public onVitals(listener: VitalsListener) {
    this.vitalsListeners.add(listener);
    return () => this.vitalsListeners.delete(listener);
  }

  public onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private notifyVitalsListeners(vitals: VitalSigns) {
    this.vitalsListeners.forEach((l) => l(vitals));
  }

  private notifyStatusListeners(connected: boolean, deviceName: string | null) {
    this.statusListeners.forEach((l) => l(connected, deviceName));
  }
}

export const deviceBridge = new DeviceBridgeService();
