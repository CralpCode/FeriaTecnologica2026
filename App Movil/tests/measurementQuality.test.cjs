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
const wire = { v: 2, valid: 31, cal: false, bpm: 72, spo2: 97.5, hrv: 0, chip_temp: 29.5,
  audio_rms: -42, audio_peak: 0.1, audio_unit: 'dBFS', finger: true, power: 'active', scan_mode: 'continuous' };

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
