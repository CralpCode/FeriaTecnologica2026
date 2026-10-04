import { MeasurementProvenance, MeasurementQuality, RawDevicePacket, VitalMetric, VitalSigns } from '../types/vitals';

export const METRIC_VALIDITY_BITS = {
  heartRate: 1,
  bloodOxygen: 2,
  hrv: 4,
  chipTemperature: 8,
  audio: 16,
} as const;

/** Numeric zero may be a real RMSSD/audio reading; validity is checked separately. */
export function readingExists(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function measurementValidity(vitals: MeasurementQuality | null | undefined, metric: VitalMetric): boolean;
export function measurementValidity(vitals: VitalSigns, now?: number): { heartRate: boolean; bloodOxygen: boolean };
export function measurementValidity(vitals: MeasurementQuality | null | undefined, metricOrNow?: VitalMetric | number) {
  if (typeof metricOrNow === 'string') return vitals?.validity?.[metricOrNow] === true;
  return clinicalValidity(vitals as VitalSigns, metricOrNow);
}

export function normalizeDevicePacket(raw: RawDevicePacket): VitalSigns {
  const mask = raw.v === 2 && Number.isInteger(raw.valid) && (raw.valid ?? -1) >= 0 ? raw.valid! : 0;
  const opticalContact = raw.finger !== false && raw.power !== 'standby' && raw.test !== true && raw.source !== 'simulated';
  const hasBit = (bit: number) => raw.power !== 'standby' && raw.test !== true && raw.source !== 'simulated' && (mask & bit) !== 0;
  const validity: Record<VitalMetric, boolean> = {
    heartRate: opticalContact && hasBit(1) && readingExists(raw.bpm) && raw.bpm > 0,
    bloodOxygen: opticalContact && hasBit(2) && readingExists(raw.spo2) && raw.spo2 > 0 && raw.spo2 <= 100,
    hrv: opticalContact && hasBit(4) && readingExists(raw.hrv) && raw.hrv >= 0,
    chipTemperature: hasBit(8) && readingExists(raw.chip_temp),
    audio_rms: hasBit(16) && readingExists(raw.audio_rms),
    audio_peak: hasBit(16) && readingExists(raw.audio_peak),
    systolicPressure: false,
    diastolicPressure: false,
    temperature: false,
    stressLevel: false,
    steps: false,
    calories: false,
  };

  const status = (metric: VitalMetric, value: unknown, kind: MeasurementProvenance): MeasurementProvenance => {
    if (validity[metric]) return kind;
    return raw.v !== 2 && readingExists(value) && value !== 0 ? 'unverified' : 'unavailable';
  };
  const provenance: Record<VitalMetric, MeasurementProvenance> = {
    heartRate: status('heartRate', raw.bpm, 'measured'),
    bloodOxygen: status('bloodOxygen', raw.spo2, 'estimated'),
    hrv: status('hrv', raw.hrv, 'derived'),
    chipTemperature: status('chipTemperature', raw.chip_temp, 'measured'),
    audio_rms: status('audio_rms', raw.audio_rms, 'measured'),
    audio_peak: status('audio_peak', raw.audio_peak, 'measured'),
    systolicPressure: status('systolicPressure', raw.systolic, 'unavailable'),
    diastolicPressure: status('diastolicPressure', raw.diastolic, 'unavailable'),
    temperature: status('temperature', raw.temperature, 'unavailable'),
    stressLevel: status('stressLevel', raw.stress ?? raw.stress_score, 'unavailable'),
    steps: 'unavailable',
    calories: 'unavailable',
  };

  return {
    heartRate: validity.heartRate ? raw.bpm! : 0,
    bloodOxygen: validity.bloodOxygen ? raw.spo2! : 0,
    systolicPressure: 0,
    diastolicPressure: 0,
    temperature: 0,
    hrv: validity.hrv ? raw.hrv! : 0,
    stressLevel: 0,
    chipTemperature: validity.chipTemperature ? raw.chip_temp! : 0,
    audio_rms: validity.audio_rms ? raw.audio_rms! : 0,
    audio_peak: validity.audio_peak ? raw.audio_peak! : 0,
    steps: 0,
    calories: 0,
    timestamp: new Date().toISOString(),
    device_connected: true,
    finger: raw.finger,
    scan_mode: raw.scan_mode ?? 'none',
    scan_sec: readingExists(raw.scan_sec) ? raw.scan_sec : 0,
    scan_phase: raw.scan_phase ?? 'none',
    cardiac_locked: raw.cardiac_locked === true && validity.heartRate,
    power: raw.power ?? 'active',
    validity,
    provenance,
    spo2_calibrated: validity.bloodOxygen && raw.cal === true,
    source: raw.test === true || raw.source === 'simulated' ? 'simulated' : raw.v === 2 && (!raw.source || ['real', 'esp32', 'ble_hr'].includes(raw.source)) ? 'real' : raw.source ?? 'unknown',
    heartRateValid: validity.heartRate,
    bloodOxygenValid: validity.bloodOxygen,
    spo2Calibrated: validity.bloodOxygen && raw.cal === true,
    signalQuality: validity.heartRate || validity.bloodOxygen || validity.hrv ? 'good' : opticalContact ? 'unstable' : 'no_finger',
    sampleAgeMs: raw.sampleAgeMs ?? raw.sample_age_ms ?? 0,
    audioUnit: raw.audioUnit ?? raw.audio_unit ?? 'relative_uncalibrated',
  };
}

/** Canonical API readings need the same explicit quality checks as device packets. */
export function normalizePublicVitals(vitals: Partial<VitalSigns>): VitalSigns {
  const qualityPresent = vitals.validity !== undefined || vitals.heartRateValid !== undefined;
  const has = (metric: VitalMetric) => vitals.validity?.[metric] ?? (
    metric === 'heartRate' ? vitals.heartRateValid === true :
    metric === 'bloodOxygen' ? vitals.bloodOxygenValid === true :
    (metric === 'audio_rms' || metric === 'audio_peak') ? vitals.audioUnit === 'dBFS' && readingExists(vitals[metric]) : false
  );
  const mask =
    (has('heartRate') ? 1 : 0) |
    (has('bloodOxygen') ? 2 : 0) |
    (has('hrv') ? 4 : 0) |
    (has('chipTemperature') ? 8 : 0) |
    (has('audio_rms') && has('audio_peak') ? 16 : 0);
  const normalized = normalizeDevicePacket({
    v: qualityPresent ? 2 : undefined,
    valid: mask,
    cal: (vitals.spo2_calibrated ?? vitals.spo2Calibrated) === true,
    audioUnit: vitals.audioUnit,
    sampleAgeMs: vitals.sampleAgeMs,
    source: vitals.source,
    bpm: vitals.heartRate,
    spo2: vitals.bloodOxygen,
    systolic: vitals.systolicPressure,
    diastolic: vitals.diastolicPressure,
    temperature: vitals.temperature,
    chip_temp: vitals.chipTemperature,
    stress: vitals.stressLevel,
    hrv: vitals.hrv,
    audio_rms: vitals.audio_rms,
    audio_peak: vitals.audio_peak,
    finger: vitals.finger,
    scan_mode: vitals.scan_mode,
    scan_sec: vitals.scan_sec,
    scan_phase: vitals.scan_phase,
    cardiac_locked: vitals.cardiac_locked,
    power: vitals.power,
  });
  return {
    ...normalized,
    timestamp: typeof vitals.timestamp === 'string' ? vitals.timestamp : normalized.timestamp,
    device_connected: vitals.device_connected,
    signalQuality: vitals.signalQuality ?? normalized.signalQuality,
  };
}

/** Only Heart Rate Measurement fields are present on standard BLE 0x2A37. */
export function decodeHeartRateMeasurement(bytes: ArrayLike<number>): RawDevicePacket | null {
  if (bytes.length < 2) return null;
  const flags = bytes[0];
  const is16Bit = (flags & 1) !== 0;
  if (is16Bit && bytes.length < 3) return null;
  const bpm = is16Bit ? bytes[1] | (bytes[2] << 8) : bytes[1];
  const contactSupported = (flags & 4) !== 0;
  const contactDetected = (flags & 2) !== 0;
  const validHeartRate = bpm > 0 && (!contactSupported || contactDetected);
  return {
    v: 2,
    valid: validHeartRate ? 1 : 0,
    cal: false,
    source: 'ble_hr',
    bpm: validHeartRate ? bpm : 0,
    ...(contactSupported ? { finger: contactDetected } : {}),
  };
}

/** Missing provenance or quality metadata never becomes a valid clinical measurement. */
function clinicalValidity(vitals: VitalSigns, now = Date.now()) {
  const received = Date.parse(vitals.timestamp);
  const elapsed = now - received;
  const age = vitals.sampleAgeMs;
  const fresh = Number.isFinite(received) && elapsed >= -1000 && elapsed <= 10000
    && typeof age === 'number' && Number.isFinite(age) && age >= 0 && age + Math.max(0, elapsed) <= 10000;
  const eligible = fresh && vitals.source === 'real' && vitals.signalQuality === 'good'
    && vitals.device_connected !== false;
  return {
    heartRate: eligible && vitals.finger !== false && vitals.heartRateValid === true
      && Number.isFinite(vitals.heartRate) && vitals.heartRate > 0,
    bloodOxygen: eligible && vitals.finger === true && vitals.bloodOxygenValid === true && vitals.spo2Calibrated === true
      && Number.isFinite(vitals.bloodOxygen) && vitals.bloodOxygen > 0 && vitals.bloodOxygen <= 100,
  };
}

/** Indicadores que solo envía el firmware nuevo; si no llega ninguno, el paquete es del formato original. */
const NEW_FORMAT_KEYS = ['v', 'valid', 'validity', 'source', 'heartRateValid', 'heart_rate_valid', 'bloodOxygenValid', 'spo2_valid',
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
