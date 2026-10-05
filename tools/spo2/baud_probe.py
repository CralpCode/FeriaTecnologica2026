"""Compare matched UART rates; restore the ESP32 and host to 115200 in finally.

Requires the BAUD/BAUD_<rate> diagnostic commands in Esp32.ino.
Uses continuous mode, preserves sensor configuration and does not assert RTS/DTR.
"""
import argparse
import json
import re
import statistics
import time
from pathlib import Path

import serial

RATES = (115200, 230400, 460800, 57600)


class Reader:
    def __init__(self, port):
        self.port = port
        self.pending = b''

    def clear(self):
        self.port.reset_input_buffer()
        self.pending = b''

    def collect(self, seconds, stop=None):
        lines, byte_count = [], 0
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            chunk = self.port.read(max(1, self.port.in_waiting))
            byte_count += len(chunk)
            self.pending += chunk
            while b'\n' in self.pending:
                line, self.pending = self.pending.split(b'\n', 1)
                lines.append(line.rstrip(b'\r'))
                if stop and stop(line):
                    return lines, byte_count
            if len(self.pending) > 65536:
                raise RuntimeError('UART stream has no line terminators; check matched baud rates.')
        return lines, byte_count

    def command(self, command, prefix, timeout=3):
        self.port.write(command.encode('ascii') + b'\n')
        self.port.flush()
        lines, _ = self.collect(timeout, lambda line: line.startswith(prefix))
        hits = [line.decode('utf-8') for line in lines if line.startswith(prefix)]
        if not hits:
            raise RuntimeError(f'No {prefix!r} response at host {self.port.baudrate}.')
        return hits[-1]

    def verify_baud(self, requested):
        line = self.command('BAUD', b'[BAUD] current:')
        actual = int(re.search(r'current:(\d+)', line)[1])
        # UART divider rounding is expected on ESP32.
        if abs(actual - requested) > requested * 0.005:
            raise RuntimeError(f'UART reports {actual}, host requested {requested}.')
        return actual

    def switch(self, target):
        if self.port.baudrate == target:
            return self.verify_baud(target)
        self.port.write(f'BAUD_{target}\n'.encode('ascii'))
        self.port.flush()
        time.sleep(0.25)
        self.port.baudrate = target
        self.clear()
        return self.verify_baud(target)


def config_value(config, key):
    return int(re.search(rf'\b{key}:(\d+)', config)[1])


def summarize(rate, actual, lines, byte_count, start_config, end_config, elapsed):
    packets, diagnostics, bad_utf8, bad_json = [], [], 0, 0
    for raw in lines:
        try:
            line = raw.decode('utf-8')
        except UnicodeDecodeError:
            bad_utf8 += 1
            continue
        if line.startswith('{'):
            try:
                packet = json.loads(line)
                if not isinstance(packet, dict) or packet.get('v') != 2:
                    bad_json += 1
                else:
                    packets.append(packet)
            except ValueError:
                bad_json += 1
        elif line.startswith('[SPO2'):
            diagnostics.append(line)
    pulse = [p['bpm'] for p in packets if p.get('valid', 0) & 1]
    oxygen = [p['spo2'] for p in packets if p.get('valid', 0) & 2]
    quality = [s for s in diagnostics if s.startswith('[SPO2 QUALITY]')]
    ratios = [float(re.search(r'ratio_ref:([\d.]+)', s)[1]) for s in quality]
    sample_delta = config_value(end_config, 'samples') - config_value(start_config, 'samples')
    return {
        'baud_requested': rate, 'baud_reported': actual,
        'duration_between_configs_s': round(elapsed, 3),
        'bytes_received': byte_count, 'complete_lines': len(lines),
        'invalid_utf8_lines': bad_utf8, 'invalid_json_lines': bad_json,
        'telemetry_packets': len(packets),
        'contact_packets': sum(bool(p.get('finger')) for p in packets),
        'valid_oxygen_packets': len(oxygen),
        'oxygen_range': [min(oxygen), max(oxygen)] if oxygen else None,
        'pulse_median': statistics.median(pulse) if pulse else None,
        'pulse_range': [min(pulse), max(pulse)] if pulse else None,
        'optical_sample_delta': sample_delta,
        'optical_samples_per_second': round(sample_delta / elapsed, 2),
        'software_drops_delta': config_value(end_config, 'fifo_lost') - config_value(start_config, 'fifo_lost'),
        'i2c_errors_delta': config_value(end_config, 'i2c_errors') - config_value(start_config, 'i2c_errors'),
        'quality_windows': len(quality),
        'quality_passed': sum('quality:1 ' in s for s in quality),
        'reference_ratio_range': [min(ratios), max(ratios)] if ratios else None,
        'start_config': start_config, 'end_config': end_config,
        'packets': packets, 'diagnostics': diagnostics,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', default='COM5')
    parser.add_argument('--seconds', type=float, default=20)
    parser.add_argument('--rates', type=int, nargs='+', choices=RATES, default=RATES)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    port = serial.Serial(port=None, baudrate=115200, timeout=0.05, write_timeout=3)
    port.dtr = False
    port.rts = False
    port.port = args.port
    reader = Reader(port)
    results = []
    restored = False
    try:
        port.open()
        reader.collect(3)
        reader.verify_baud(115200)
        for rate in args.rates:
            print(f'Starting matched baud {rate}', flush=True)
            actual = reader.switch(rate)
            port.write(b'CONT\n')
            port.flush()
            reader.collect(6)  # Same settling interval after resetting each scan.
            start_config = reader.command('SPO2', b'[SPO2 CONFIG]')
            start = time.monotonic()
            lines, byte_count = reader.collect(args.seconds)
            end_config = reader.command('SPO2', b'[SPO2 CONFIG]')
            elapsed = time.monotonic() - start
            result = summarize(rate, actual, lines, byte_count, start_config, end_config, elapsed)
            results.append(result)
            (args.output_dir / f'baud-{rate}.log').write_bytes(b'\n'.join(lines) + b'\n')
            print(json.dumps({k: v for k, v in result.items() if k not in ('packets', 'diagnostics', 'start_config', 'end_config')}), flush=True)
    finally:
        if port.is_open:
            try:
                actual = reader.switch(115200)
                restored = True
                print(f'Restored matched UART baud: {actual}', flush=True)
            finally:
                port.close()
        report = {'results': results, 'restored_115200': restored, 'port_closed': not port.is_open}
        (args.output_dir / 'baud-results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps({'restored_115200': restored, 'port_closed': not port.is_open}), flush=True)


if __name__ == '__main__':
    main()
