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

export const nativeBle: NativeBleService = {
  isAvailable: false,
  async scanAndConnect() {
    return {
      success: false,
      message: 'Native BLE no está activo en entorno Web (utilizando Web Bluetooth estándar).',
    };
  },
  async disconnect() {},
  getConnected() {
    return false;
  },
};
