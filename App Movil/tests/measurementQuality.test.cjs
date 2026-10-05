const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', code)(exports);
  return exports;
}
const quality = load('measurementQuality.ts');
const { DevicePacketBuffer } = load('DevicePacketBuffer.ts');
const { MeasurementDisplayCache } = load('measurementDisplay.ts');
const wire = { v: 2, valid: 31, cal: false, bpm: 72, spo2: 97.5, hrv: 0, chip_temp: 29.5,
  audio_rms: -42, audio_peak: 0.1, audio_unit: 'dBFS', finger: true, power: 'active', scan_mode: 'continuous' };

test('device stress heuristic is separate from clinical stress and is never filled in', () => {
  const vitals = quality.normalizeDevicePacket({ ...wire, hrv: 40, stress: 50 });
  assert.equal(vitals.experimentalStressScore, 50);
  assert.equal(vitals.stressLevel, 0);
  assert.equal(vitals.validity.stressLevel, false);
  assert.equal(quality.normalizePublicVitals(vitals).experimentalStressScore, 50);
  for (const change of [{ stress: undefined }, { stress: 0 }, { stress: 25 }, { valid: 27 }, { test: true }]) {
    assert.equal(quality.normalizeDevicePacket({ ...wire, hrv: 40, stress: 50, ...change }).experimentalStressScore, null);
  }
});

test('display retains independent last valid values during gaps without changing clinical data', () => {
  const cache = new MeasurementDisplayCache();
  const t = Date.now();
  const first = { ...quality.normalizeDevicePacket(wire), timestamp: new Date(t).toISOString() };
  let display = cache.update(first, 'patient-1:ble', t);
  assert.equal(display.hrv.value, 0);
  const gap = { ...quality.normalizeDevicePacket({ ...wire, valid: 8 }), timestamp: new Date(t + 500).toISOString() };
  display = cache.update(gap, 'patient-1:ble', t + 500);
  assert.equal(display.heartRate.value, 72);
  assert.equal(display.heartRate.state, 'held');
  assert.equal(display.audio_rms.value, -42);
  assert.equal(display.hrv.value, 0);
  assert.equal(gap.heartRateValid, false);
  assert.equal(quality.measurementValidity(gap, t + 500).heartRate, false);
  const next = { ...quality.normalizeDevicePacket({ ...wire, bpm: 78, hrv: 35 }), timestamp: new Date(t + 700).toISOString() };
  display = cache.update(next, 'patient-1:ble', t + 700);
  assert.equal(display.heartRate.value, 78);
  assert.equal(display.hrv.value, 35);
  assert.equal(display.hrv.state, 'live');
  assert.deepEqual(cache.update(gap, 'patient-1:ble', t + 11000), {});
});

test('display clears across patients, disconnects, standby and explicit loss of contact', () => {
  const t = Date.now();
  const first = { ...quality.normalizeDevicePacket(wire), timestamp: new Date(t).toISOString() };
  const missing = { ...first, source: 'unknown', finger: false, validity: {}, device_connected: false };
  const cache = new MeasurementDisplayCache();
  cache.update(first, 'patient-1:ble', t);
  assert.equal(cache.update(missing, 'patient-1:ble', t + 500).heartRate.state, 'held');
  assert.deepEqual(cache.update(missing, 'patient-2:ble', t + 600), {});
  cache.update(first, 'patient-2:ble', t);
  assert.deepEqual(cache.update(missing, 'patient-2:none', t + 700), {});
  cache.update(first, 'patient-2:ble', t);
  const noContact = { ...quality.normalizeDevicePacket({ ...wire, finger: false }), timestamp: new Date(t + 800).toISOString() };
  assert.equal(cache.update(noContact, 'patient-2:ble', t + 800).heartRate, undefined);
  const standby = quality.normalizeDevicePacket({ ...wire, power: 'standby' });
  assert.deepEqual(cache.update(standby, 'patient-2:ble', t + 900), {});
  const aged = { ...first, sampleAgeMs: 8000 };
  cache.update(aged, 'patient-2:ble', t);
  assert.deepEqual(cache.update(missing, 'patient-2:ble', t + 2100), {});
});

test('previous v2 firmware audio stays uncalibrated and RMS does not require a peak', () => {
  const old = quality.normalizeDevicePacket({ ...wire, valid: 24, bpm: 0, finger: false,
    audio_rms: 65.8, audio_peak: 33052.3, audio_unit: undefined });
  assert.equal(old.audio_rms, 65.8);
  assert.equal(old.audioUnit, 'relative_uncalibrated');
  assert.equal(old.heartRate, 0);
  const current = quality.normalizePublicVitals({ ...old, audio_peak: 0,
    validity: { ...old.validity, audio_peak: false } });
  assert.equal(current.audio_rms, 65.8);
  assert.equal(current.validity.audio_rms, true);
  assert.equal(current.validity.audio_peak, false);
  assert.equal(current.audio_peak, 0);
  assert.equal(current.audioUnit, 'relative_uncalibrated');
});

test('v2 readings survive normalization without invented measurements or clinical SpO2', () => {
  const vitals = quality.normalizeDevicePacket(wire);
  assert.equal(vitals.heartRate, 72);
  assert.equal(vitals.bloodOxygen, 97.5);
  assert.equal(vitals.provenance.bloodOxygen, 'estimated');
  assert.equal(vitals.hrv, 0);
  assert.equal(vitals.validity.hrv, true);
  assert.equal(vitals.chipTemperature, 29.5);
  assert.equal(vitals.audio_rms, -42);
  assert.equal(vitals.audioUnit, 'dBFS');
  for (const key of ['temperature', 'systolicPressure', 'diastolicPressure', 'stressLevel']) {
    assert.equal(vitals[key], 0);
    assert.equal(vitals.validity[key], false);
  }
  assert.deepEqual(quality.measurementValidity(vitals), { heartRate: true, bloodOxygen: false });
  const api = quality.normalizePublicVitals(vitals);
  assert.equal(api.heartRateValid, true);
  assert.equal(api.scan_mode, 'continuous');
  assert.equal(api.spo2Calibrated, false);
});

test('standby, simulation, missing mask and stale data cannot be interpreted as live measurements', () => {
  for (const change of [{ valid: 0 }, { valid: undefined }, { test: true }, { power: 'standby' }, { finger: false }]) {
    const vitals = quality.normalizeDevicePacket({ ...wire, ...change });
    assert.equal(vitals.heartRate, 0);
    assert.equal(quality.measurementValidity(vitals).heartRate, false);
  }
  const vitals = quality.normalizeDevicePacket(wire);
  assert.equal(quality.measurementValidity(vitals, Date.now() + 11000).heartRate, false);
  assert.equal(quality.normalizePublicVitals({ heartRate: 72, bloodOxygen: 98 }).heartRate, 0);
  assert.equal(quality.isLegacyPacket(wire), false);
});

test('BLE JSON handles nested quality, fragmentation, escaped braces and multiple frames', () => {
  const buffer = new DevicePacketBuffer();
  const first = { ...wire, validity: { heartRate: true }, note: 'brace } and "quote"' };
  const text = JSON.stringify(first);
  assert.deepEqual(buffer.push('noise' + text.slice(0, 25)), []);
  assert.deepEqual(buffer.push(text.slice(25) + JSON.stringify({ bpm: 80 })), [first, { bpm: 80 }]);
  assert.deepEqual(buffer.push('{broken}' + JSON.stringify({ bpm: 81 })), [{ bpm: 81 }]);
});

test('standard heart rate BLE validates packet length and only exposes pulse', () => {
  assert.equal(quality.decodeHeartRateMeasurement([1, 72]), null);
  assert.equal(quality.decodeHeartRateMeasurement([0]), null);
  const packet = quality.decodeHeartRateMeasurement([1, 0x2c, 1]);
  assert.equal(packet.bpm, 300);
  assert.equal(packet.valid, 1);
  assert.equal(packet.spo2, undefined);
  assert.equal(quality.decodeHeartRateMeasurement([4, 72]).valid, 0);
  const vitals = quality.normalizeDevicePacket(quality.decodeHeartRateMeasurement([0, 72]));
  assert.equal(vitals.finger, undefined);
  assert.equal(quality.measurementValidity(vitals).heartRate, true);
});
