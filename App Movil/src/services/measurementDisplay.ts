import type { VitalSigns } from '../types/vitals';

export type DisplayMetric = 'heartRate' | 'bloodOxygen' | 'hrv' | 'audio_rms' | 'experimentalStressScore';
export interface DisplayReading {
  value: number;
  timestamp: string;
  unit?: string | null;
  calibrated: boolean;
  expiresAt: number;
  state: 'live' | 'held';
}
const metrics: DisplayMetric[] = ['heartRate', 'bloodOxygen', 'hrv', 'audio_rms', 'experimentalStressScore'];
const MAX_DISPLAY_AGE_MS = 10000;

/** Presentation only: retained readings never change telemetry or clinical eligibility. */
export class MeasurementDisplayCache {
  private scope: string | undefined;
  private last: Partial<Record<DisplayMetric, DisplayReading>> = {};

  update(vitals: VitalSigns, scope: string, now: number): Partial<Record<DisplayMetric, DisplayReading>> {
    if (scope !== this.scope) { this.last = {}; this.scope = scope; }
    if (vitals.source === 'simulated' || vitals.power === 'standby') this.last = {};
    const received = Date.parse(vitals.timestamp);
    const age = now - received;
    const sampleAge = vitals.sampleAgeMs;
    const fresh = Number.isFinite(received) && age >= -1000
      && (sampleAge == null || Number.isFinite(sampleAge) && sampleAge >= 0)
      && Math.max(0, age) + (sampleAge ?? 0) <= MAX_DISPLAY_AGE_MS;
    const out: Partial<Record<DisplayMetric, DisplayReading>> = {};
    for (const metric of metrics) {
      const optical = metric !== 'audio_rms';
      if (optical && vitals.source === 'real' && vitals.finger === false) delete this.last[metric];
      const value = vitals[metric];
      const valid = vitals.source === 'real' && vitals.device_connected !== false
        && vitals.power !== 'standby' && fresh && (!optical || vitals.finger !== false)
        && vitals.validity?.[metric === 'experimentalStressScore' ? 'hrv' : metric] === true
        && typeof value === 'number' && Number.isFinite(value)
        && (metric === 'heartRate' || metric === 'bloodOxygen' ? value > 0 : true);
      if (valid) {
        this.last[metric] = { value, timestamp: vitals.timestamp, unit: vitals.audioUnit,
          calibrated: vitals.spo2Calibrated === true,
          expiresAt: received + MAX_DISPLAY_AGE_MS - (sampleAge ?? 0), state: 'live' };
      }
      const reading = this.last[metric];
      if (reading && now <= reading.expiresAt) {
        out[metric] = { ...reading, state: valid ? 'live' : 'held' };
      } else {
        delete this.last[metric];
      }
    }
    return out;
  }
}
