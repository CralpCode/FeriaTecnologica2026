import { VitalSigns } from '../types/vitals';

/** Missing provenance or quality metadata never becomes a valid clinical measurement. */
export function measurementValidity(vitals: VitalSigns, now = Date.now()) {
  const received = Date.parse(vitals.timestamp);
  const elapsed = now - received;
  const age = vitals.sampleAgeMs;
  const fresh = Number.isFinite(received) && elapsed >= -1000 && elapsed <= 10000
    && typeof age === 'number' && Number.isFinite(age) && age >= 0 && age + Math.max(0, elapsed) <= 10000;
  const eligible = fresh && vitals.source === 'real' && vitals.finger === true
    && vitals.device_connected !== false;
  return {
    heartRate: eligible && vitals.heartRateValid === true && Number.isFinite(vitals.heartRate) && vitals.heartRate > 0,
    bloodOxygen: eligible && vitals.bloodOxygenValid === true && vitals.spo2Calibrated === true
      && Number.isFinite(vitals.bloodOxygen) && vitals.bloodOxygen > 0 && vitals.bloodOxygen <= 100,
  };
}
