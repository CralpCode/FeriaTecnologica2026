#!/usr/bin/env python3
"""Verifica telemetría física; no crea lecturas simuladas.
Cerrar otros monitores serie antes de ejecutarlo.
"""
import argparse
import json
import time
from datetime import datetime
import serial
import requests

parser = argparse.ArgumentParser()
parser.add_argument('--port', default='/dev/cu.usbserial-0001')
parser.add_argument('--seconds', type=int, default=60)
parser.add_argument('--server', default='http://127.0.0.1:8000')
parser.add_argument('--forward-usb', action='store_true')
args = parser.parse_args()
session = requests.Session()
ser = serial.Serial()
ser.port = args.port
ser.baudrate = 115200
ser.timeout = .2
ser.dtr = ser.rts = False
ser.open()
# Abrir CP2102 puede reiniciar la placa: descartar fragmentos de la sesion previa.
time.sleep(1)
ser.reset_input_buffer()
ser.write(b'STATUS\n')
startup_end = time.monotonic() + 15
end = startup_end + args.seconds
packets = errors = forwarded = valid_pulse = 0
valid_audio = 0
resets = network_errors = 0
startup_resets = 0
last = None
pending = bytearray()
while time.monotonic() < end:
    pending.extend(ser.readline())
    if not pending.endswith(b'\n'):
        if len(pending) > 8192: pending.clear()
        continue
    line = pending.decode('utf-8', errors='replace').strip()
    pending.clear()
    if not line.startswith('{'):
        if 'rst:0x' in line:
            if time.monotonic() >= startup_end: resets += 1
            else: startup_resets += 1
        network_errors += '[NET] Telemetria no enviada' in line
        if 'WiFi' in line or '[NET]' in line or 'I2C' in line:
            print(line)
        continue
    try:
        raw = json.loads(line)
    except ValueError:
        if time.monotonic() >= startup_end: errors += 1
        continue
    if 'bpm' not in raw:
        continue
    if time.monotonic() < startup_end:
        continue
    packets += 1
    last = raw
    valid_pulse += raw.get('heartRateValid') is True
    valid_audio += raw.get('audioValid') is True
    if args.forward_usb:
        try:
            r = session.post(args.server + '/api/telemetry', json=raw, timeout=3)
            r.raise_for_status()
            forwarded += 1
        except requests.RequestException:
            errors += 1
ser.close()
current = session.get(args.server + '/api/vitals/current', timeout=5)
current.raise_for_status()
v = current.json()
try:
    received = datetime.fromisoformat(v['timestamp'])
    elapsed = (datetime.now(received.tzinfo) - received).total_seconds()
    server_fresh = 0 <= elapsed <= 15 and v.get('source') == 'real' and v.get('device_connected') is True
except (KeyError, TypeError, ValueError):
    server_fresh = False
print(json.dumps({'usb_packets': packets, 'invalid_json_or_http_errors': errors,
                  'device_resets': resets, 'device_network_errors': network_errors,
                  'startup_resets': startup_resets,
                  'forwarded_usb': forwarded, 'valid_pulse_packets': valid_pulse, 'server_receiving': server_fresh,
                  'valid_audio_packets': valid_audio,
                  'last_device_quality': (last or {}).get('signalQuality'),
                  'server_timestamp': v.get('timestamp'), 'server_source': v.get('source'),
                  'server_quality': v.get('signalQuality'), 'server_pulse_valid': v.get('heartRateValid')}, indent=2))
if not packets or errors or resets or network_errors or not server_fresh:
    raise SystemExit(1)
