"""Bounded capture for the temporary MAX30102-only firmware; always close UART."""
import argparse
import json
import re
import statistics
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
    port.port = args.port
    port.dtr = port.rts = False
    reader = Reader(port)
    report = {'windows': [], 'complete': False}
    try:
        port.open()
        reader.collect(2)
        report['info'] = reader.command('INFO', b'[MODULE INFO]')
        if 'firmware:2026-10-04-max30102-only' not in report['info'] or 'found:1' not in report['info']:
            raise RuntimeError('Expected temporary firmware and a detected sensor.')
        port.write(b'INFO\n')
        port.flush()
        info_lines, _ = reader.collect(2)
        report['registers_before'] = [r.decode('utf-8') for r in info_lines if r.startswith(b'[MODULE REG]')]
        port.write(b'START\n')
        port.flush()
        print('MAX30102-only capture started: keep finger still for 30 seconds.', flush=True)
        lines, _ = reader.collect(35, lambda line: line.startswith(b'[MODULE END]'))
        (args.output_dir / 'module.log').write_bytes(b'\n'.join(lines) + b'\n')
        raw, bad_lines = [], []
        for line in lines:
            if line.startswith(b'[RAW] '):
                try:
                    fields = [int(v) for v in line[6:].split(b',')]
                    if len(fields) != 3:
                        raise ValueError('Expected sequence, red, IR')
                    raw.append(fields)
                except ValueError:
                    bad_lines.append(line.decode('utf-8', errors='replace'))
            elif line.startswith(b'[MODULE WINDOW] '):
                try:
                    report['windows'].append(json.loads(line[len(b'[MODULE WINDOW] '):]))
                except ValueError:
                    bad_lines.append(line.decode('utf-8', errors='replace'))
            elif line.startswith(b'[MODULE END]'):
                report['end'] = line.decode('utf-8')
        report['raw'] = raw
        report['bad_lines'] = bad_lines
        if 'end' not in report:
            raise RuntimeError('Bounded capture did not finish; inspect saved log.')
        counters = {k: int(v) for k, v in re.findall(r'(\w+):(\d+)', report['end'])}
        report['counters'] = counters
        report['complete'] = True
        report['raw_sequence_gaps'] = sum(b[0] != a[0] + 1 for a, b in zip(raw, raw[1:]))
        report['acquisition_hz'] = round(counters['samples'] * 1000 / counters['elapsed_ms'], 2)
        report['raw_received'] = len(raw)
        report['algorithm_valid_windows'] = sum(bool(w['candidate_valid']) for w in report['windows'])
        report['quality_pass_windows'] = sum(bool(w['quality']) for w in report['windows'])
        if raw:
            report['red_median'] = statistics.median(r[1] for r in raw)
            report['ir_median'] = statistics.median(r[2] for r in raw)
            report['saturated_pairs'] = sum(r[1] >= 262143 or r[2] >= 262143 for r in raw)
        print(json.dumps({k: v for k, v in report.items() if k not in ('raw', 'windows')}, indent=2), flush=True)
        print(json.dumps({'windows': [{k: v for k, v in w.items() if k not in ('red', 'ir')} for w in report['windows']]}, indent=2), flush=True)
    finally:
        try:
            if port.is_open:
                port.write(b'STOP\n')
                port.flush()
        finally:
            port.close()
            report['port_closed'] = not port.is_open
            (args.output_dir / 'module.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            print(json.dumps({'port_closed': not port.is_open}), flush=True)


if __name__ == '__main__':
    main()
