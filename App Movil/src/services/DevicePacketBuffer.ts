import { RawDevicePacket } from '../types/vitals';

/** Reassembles BLE notifications without assuming that one notification is one JSON object. */
export class DevicePacketBuffer {
  private buffer = '';

  public clear(): void {
    this.buffer = '';
  }

  public push(fragment: string): RawDevicePacket[] {
    this.buffer += fragment;
    const packets: RawDevicePacket[] = [];

    while (this.buffer.length > 0) {
      const start = this.buffer.indexOf('{');
      if (start < 0) {
        this.clear();
        break;
      }
      if (start > 0) this.buffer = this.buffer.slice(start);

      let depth = 0;
      let inString = false;
      let escaped = false;
      let end = -1;
      for (let index = 0; index < this.buffer.length; index++) {
        const character = this.buffer[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') inString = true;
        else if (character === '{') depth++;
        else if (character === '}' && --depth === 0) {
          end = index + 1;
          break;
        }
      }

      if (end < 0) break;
      const candidate = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      try {
        const packet: unknown = JSON.parse(candidate);
        if (packet && typeof packet === 'object' && !Array.isArray(packet)) {
          packets.push(packet as RawDevicePacket);
        }
      } catch {
        // A malformed complete frame must not block the next valid frame.
      }
    }

    // Bound memory if a device sends an incomplete or corrupt frame indefinitely.
    if (this.buffer.length > 4096) this.clear();
    return packets;
  }
}
