"""Capture the bounded OPTICAL emitter-isolation diagnostic and check restoration.

Do not interpret ADC response as an SpO2 calibration or proof of sensor accuracy.
"""
import argparse
import json
import re
from pathlib import Path

import serial
from baud_probe import Reader


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', default='COM5')
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    port = serial.Serial(port=None, baudrate=115200, timeout=0.05, write_timeout=3)
    port.dtr = False
    port.rts = False
    port.port = args.port
    reader = Reader(port)
    report = {'phases': [], 'restored': False, 'configuration_unchanged': False}
    try:
        port.open()
        reader.collect(3)
        reader.verify_baud(115200)
        port.write(b'CONT\n')
        port.flush()
        reader.collect(3)
        report['initial_config'] = reader.command('SPO2', b'[SPO2 CONFIG]')
        print('Starting dark / red / infrared emitter probe', flush=True)
        port.write(b'OPTICAL\n')
        port.flush()
        raw_lines, _ = reader.collect(20, lambda raw: raw.startswith(b'[OPTICAL END]'))
        (args.output_dir / 'optical-emitters.log').write_bytes(b'\n'.join(raw_lines) + b'\n')
        errors, end = [], None
        for raw in raw_lines:
            line = raw.decode('utf-8', errors='replace')
            if line.startswith('[OPTICAL PHASE] '):
                report['phases'].append(json.loads(line[len('[OPTICAL PHASE] '):]))
            elif line.startswith('[OPTICAL START]'):
                report['start'] = line
            elif line.startswith('[OPTICAL END]'):
                end = line
            elif line.startswith('[OPTICAL ERROR]'):
                errors.append(line)
        report['errors'] = errors
        report['end'] = end
        if end:
            for field in ('complete', 'restored', 'configuration_unchanged'):
                report[field] = bool(int(re.search(rf'\b{field}:(\d+)', end)[1]))
        # Read physical registers after the test, independently of the END flags.
        report['registers_after'] = reader.command('PPGREG', b'[PPG REG]')
        if not (report.get('complete') and report['restored'] and report['configuration_unchanged']):
            raise RuntimeError('Emitter test incomplete or configuration restoration not verified; inspect saved log.')
        if len(report['phases']) != 5:
            raise RuntimeError('Expected five complete emitter phases.')
        for phase in report['phases']:
            if phase['count'] != 100 or phase['errors'] != 0:
                raise RuntimeError('Incomplete optical phase; do not compare emitter responses.')
        print(json.dumps({'phases': [{k: v for k, v in p.items() if k not in ('red', 'ir')} for p in report['phases']],
                          'end': end, 'registers_after': report['registers_after']}, indent=2), flush=True)
    finally:
        port.close()
        report['port_closed'] = not port.is_open
        (args.output_dir / 'optical-emitters.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps({'port_closed': not port.is_open}), flush=True)


if __name__ == '__main__':
    main()
