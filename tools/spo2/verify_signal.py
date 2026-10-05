"""Exercise the actual portable C++ processor with artificial and saved signals.

python tools/spo2/verify_signal.py --runner <compiled-exe> --capture <json> --output <json>
Artificial signals check mathematical properties; they do not validate SpO2 accuracy.
The runner reads 100 IR samples followed by the paired 100 RED samples per line.
"""
import argparse
import json
import math
import random
import subprocess
from pathlib import Path


def wave(ratio=0.7, bpm=75, drift=0, ir_dc=100000, red_dc=150000):
    ir, red = [], []
    for i in range(100):
        phase = 2 * math.pi * bpm / 60 * i / 25
        # Same pulsatile shape, known ratio of normalized amplitudes.
        ac = math.sin(phase) + 0.15 * math.sin(2 * phase)
        ir.append(round(ir_dc * (1 + 0.003 * ac) + drift * i))
        red.append(round(red_dc * (1 + 0.003 * ratio * ac) + 2 * drift * i))
    return ir, red


def analyze(runner, pairs):
    lines = [' '.join(map(str, ir + red)) for ir, red in pairs]
    result = subprocess.run([runner], input='\n'.join(lines) + '\n',
                            capture_output=True, text=True, check=True)
    values = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(values) == len(pairs), (len(values), len(pairs))
    return values


def checks(runner):
    rng = random.Random(17)
    noise = ([100000 + rng.randint(-500, 500) for _ in range(100)],
             [150000 + rng.randint(-500, 500) for _ in range(100)])
    cases = [wave(), wave(drift=5), wave(ir_dc=200000, red_dc=200000),
             wave(ratio=2.1), ([100000]*100, [150000]*100),
             ([0]*100, [0]*100), ([262143]*100, [150000]*100),
             wave(bpm=30), noise, (wave()[0], wave()[1][::-1])]
    values = analyze(runner, cases)
    for index in (0, 1, 2):
        r = values[index]
        assert r['quality_valid'], (index, r)
        assert abs(r['ratio_rms'] - 0.7) < 0.025, (index, r)
        assert abs(r['pulse_cycles_bpm'] - 75) < 3, (index, r)
        assert r['reference_valid'] == 1 and r['ratios_agree'], (index, r)
    assert abs(values[1]['ratio_rms'] - values[0]['ratio_rms']) < 0.01, values[:2]
    assert values[3]['quality_valid'] and values[3]['status'] == 'ratio_out_of_range', values[3]
    assert abs(values[3]['ratio_rms'] - 2.1) < 0.03, values[3]
    assert values[3]['reference_valid'] == 0, values[3]
    for index in range(4, 10):
        assert not values[index]['quality_valid'], (index, values[index])
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runner', required=True)
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    synthetic = checks(args.runner)
    windows = json.loads(args.capture.read_text(encoding='utf-8'))['windows']
    windows = [w for w in windows if w['count'] == 100 and w['rate_hz'] == 25]
    if not windows:
        raise SystemExit('No complete 25 Hz windows in capture.')
    real = analyze(args.runner, [(w['ir'], w['red']) for w in windows])
    for window, result in zip(windows, real):
        result['elapsed_seconds'] = window['elapsed_seconds']
    report = {'synthetic_checks_passed': len(synthetic), 'synthetic': synthetic,
              'capture': str(args.capture), 'real_windows': real,
              'accuracy_validated': False}
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'synthetic_checks_passed': len(synthetic), 'real_windows': real}, indent=2))


if __name__ == '__main__':
    main()
