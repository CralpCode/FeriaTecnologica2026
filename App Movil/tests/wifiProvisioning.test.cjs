const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file, deps = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => { if (!(name in deps)) throw new Error(name); return deps[name]; });
  return exports;
}
const wifi = load('wifiProvisioning.ts');
const { DevicePacketBuffer } = load('DevicePacketBuffer.ts');
const status = (id, state, error = '') => ({ type: 'wifi_status', id, state, saved: state === 'connected', error });

test('minimum-MTU writes preserve exact spaces, case, quotes and Unicode', () => {
  const ssid = 'Mi red ñ 👋'; const password = ' AbC!"ñ\\  ';
  const frames = wifi.wifiFrames(ssid, password, '1234abcd');
  assert(frames.every(f => Buffer.byteLength(f) <= 20));
  const encoded = frames.slice(1, -1).map(f => f.slice(10)).join('');
  assert.deepEqual(JSON.parse(Buffer.from(encoded, 'hex').toString()), { ssid, password });
  assert.equal(frames.at(-1), 'WIFI_APPLY_1234abcd');
  for (const [s, p] of [['', '12345678'], ['ñ'.repeat(17), '12345678'], ['x', 'short'], ['x', 'g'.repeat(64)], ['x\0', '12345678'], ['x', '\ud80012345678']]) {
    assert.throws(() => wifi.wifiFrames(s, p, '1234abcd'));
  }
  assert(wifi.wifiFrames('open', '', '1234abcd'));
  assert(wifi.wifiFrames('psk', 'a'.repeat(64), '1234abcd'));
});
test('Bluetooth is required; gateway connection cannot provision', async () => {
  const sent = [];
  const p = new wifi.WifiProvisioner(() => false, async f => { sent.push(f); return true; });
  await assert.rejects(p.configure('Red', '12345678'), /Bluetooth/);
  await assert.rejects(p.query(), /Bluetooth/);
  await assert.rejects(p.forget(), /Bluetooth/);
  assert.equal(sent.length, 0);
});
test('waits for matching ESP32 acknowledgment, supports fragmented notifications', async () => {
  const sent = []; const p = new wifi.WifiProvisioner(() => true, async f => { sent.push(f); return true; });
  const pending = p.configure('Red', '12345678');
  const id = sent[0].slice(11); let settled = false; pending.then(() => { settled = true; });
  await new Promise(r => setImmediate(r));
  p.receive(status('00000000', 'connected'));
  p.receive(status(id, 'connecting')); await Promise.resolve(); assert.equal(settled, false);
  const buffer = new DevicePacketBuffer(); const raw = JSON.stringify(status(id, 'connected'));
  for (let i = 0; i < raw.length; i += 20) for (const packet of buffer.push(raw.slice(i, i + 20))) p.receive(packet);
  assert.equal((await pending).saved, true);
  assert.equal(sent.at(-1), `WIFI_APPLY_${id}`);
});
test('rejects errors, timeout, write failure and Bluetooth loss without false success', async () => {
  const sent = []; const p = new wifi.WifiProvisioner(() => true, async f => { sent.push(f); return true; }, 20);
  let request = p.configure('Red', '12345678'); const failed = assert.rejects(request, /contraseña/);
  p.receive(status(sent[0].slice(11), 'failed', 'connection_failed')); await failed;
  request = p.configure('Red', '12345678'); const disconnected = assert.rejects(request, /Bluetooth/); p.disconnect(); await disconnected;
  await assert.rejects(p.configure('Red', '12345678'), /confirmó/);
  const broken = new wifi.WifiProvisioner(() => true, async () => false);
  await assert.rejects(broken.configure('Red', '12345678'), /enviar/);
});
test('WiFi status is intercepted before clinical normalization or cloud forwarding', async () => {
  const { deviceBridge } = load('DeviceBridgeService.ts', {
    'react-native': { Platform: { OS: 'web' } }, '../config/api': { API_CONFIG: {} }, '../types/vitals': {},
    './NativeBleBridge': { nativeBle: {} }, './measurementQuality': load('measurementQuality.ts'),
    './DevicePacketBuffer': { DevicePacketBuffer }, './wifiProvisioning': wifi,
  });
  let vitals = 0, cloud = 0;
  deviceBridge.isConnected = true;
  deviceBridge.onVitals(() => vitals++);
  deviceBridge.forwardToCloudApi = () => cloud++;
  deviceBridge.handleIncomingRawData(status('12345678', 'connected'));
  assert.equal(vitals, 0); assert.equal(cloud, 0);
  deviceBridge.handleIncomingRawData({ v: 2, valid: 1, bpm: 78, finger: true, source: 'real' });
  assert.equal(vitals, 1); assert.equal(cloud, 1);
});
