"""Control de colocación: aviso de si se oyen latidos. Señales sintéticas: prueban el software, no la clínica."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ml import placement

SR = 4000


def heartbeat(bpm=72, seconds=15, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * SR)) / SR
    y = 0.01 * rng.standard_normal(len(t))
    for beat in np.arange(0, seconds, 60 / bpm):
        for start, f, dur in ((beat, 60, 0.05), (beat + 0.3, 90, 0.04)):   # S1 y S2
            i = int(start * SR); n = int(dur * SR)
            if i + n < len(y):
                y[i:i + n] += np.sin(2 * np.pi * f * np.arange(n) / SR) * np.hanning(n)
    return y.astype(np.float32)


class PlacementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = Path(self.tmp.name) / 'colocacion.json'
        self.cfg.write_text(json.dumps({'corazon': {'activo': True, 'umbral': 0.156},
                                        'pulmon': {'activo': False, 'umbral': 0.1}}))
        p = patch.object(placement, 'CONFIG_PATH', self.cfg)
        p.start()
        self.addCleanup(p.stop)
        placement._config = None

    def tearDown(self):
        self.tmp.cleanup()

    def test_heartbeat_passes(self):
        out = placement.check(heartbeat(), SR, 'corazon')
        self.assertTrue(out['ok'], out)
        self.assertEqual(out['que'], 'latidos')

    def test_noise_and_silence_are_flagged(self):
        rng = np.random.default_rng(3)
        self.assertFalse(placement.check(rng.standard_normal(15 * SR).astype(np.float32) * 0.2, SR, 'corazon')['ok'])
        self.assertFalse(placement.check(np.zeros(15 * SR, np.float32), SR, 'corazon')['ok'])

    def test_inactive_or_missing_config_disables(self):
        self.assertIsNone(placement.check(heartbeat(), SR, 'pulmon'))
        self.cfg.unlink()
        placement._config = None
        self.assertIsNone(placement.check(heartbeat(), SR, 'corazon'))


if __name__ == '__main__':
    unittest.main()
