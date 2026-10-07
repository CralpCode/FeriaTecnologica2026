import { VitalSigns } from '../types/vitals';

/** Missing provenance or quality metadata never becomes a valid clinical measurement. */
export function measurementValidity(vitals: VitalSigns, now = Date.now()) {
  const received = Date.parse(vitals.timestamp);
  const elapsed = now - received;
  const age = vitals.sampleAgeMs;
  const fresh = Number.isFinite(received) && elapsed >= -1000 && elapsed <= 10000
    && typeof age === 'number' && Number.isFinite(age) && age >= 0 && age + Math.max(0, elapsed) <= 10000;
  const eligible = fresh && vitals.source === 'real' && vitals.finger === true && vitals.signalQuality === 'good'
    && vitals.device_connected !== false;
  return {
    heartRate: eligible && vitals.heartRateValid === true && Number.isFinite(vitals.heartRate) && vitals.heartRate > 0,
    bloodOxygen: eligible && vitals.bloodOxygenValid === true && vitals.spo2Calibrated === true
      && Number.isFinite(vitals.bloodOxygen) && vitals.bloodOxygen > 0 && vitals.bloodOxygen <= 100,
  };
}

/** Indicadores que solo envía el firmware nuevo; si no llega ninguno, el paquete es del formato original. */
const NEW_FORMAT_KEYS = ['v', 'valid', 'source', 'heartRateValid', 'heart_rate_valid', 'bloodOxygenValid', 'spo2_valid',
  'spo2Calibrated', 'spo2_calibrated', 'signalQuality', 'signal_quality', 'sampleAgeMs', 'sample_age_ms'];

export function isLegacyPacket(raw: object): boolean {
  return !NEW_FORMAT_KEYS.some((key) => key in raw);
}

/**
 * Misma regla que el servidor (Backend/measurement_quality.py, validate_legacy) para el formato original:
 * pulso válido solo con dedo puesto, entre 30 y 220 BPM y estable en las últimas 3 lecturas
 * (máximo 15 s, rango de 20 BPM o menos). La SpO2 de ese formato nunca se usa.
 */
export class LegacyPulseValidator {
  private recent: { t: number; bpm: number | null }[] = [];

  check(bpm: unknown, finger: unknown, now = Date.now()): { stable: boolean; finger: boolean } {
    const hasFinger = finger === true;
    const value = typeof bpm === 'number' && Number.isFinite(bpm) ? bpm : null;
    const plausible = hasFinger && value !== null && value >= 30 && value <= 220;
    const last = this.recent[this.recent.length - 1];
    if (last && now - last.t > 15000) this.recent = [];
    this.recent = [...this.recent, { t: now, bpm: plausible ? value : null }].slice(-3);
    const window = this.recent.filter((r) => now - r.t <= 15000).map((r) => r.bpm);
    const values = window.filter((b): b is number => b !== null);
    const stable = window.length >= 3 && values.length === window.length
      && Math.max(...values) - Math.min(...values) <= 20;
    return { stable, finger: hasFinger };
  }

  reset() {
    this.recent = [];
  }
}
