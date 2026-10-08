"""Control de colocación: aviso de si se oyen latidos. Señales sintéticas: prueban el software, no la clínica."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ml import classifier, placement

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


def rumble(seconds=15, seed=1):
    """Retumbo grave continuo (25-40 Hz) sin latidos: como el roce o el movimiento del estetoscopio."""
    from scipy.signal import butter, sosfiltfilt
    rng = np.random.default_rng(seed)
    x = rng.standard_normal(int(seconds * SR))
    y = sosfiltfilt(butter(4, [25, 40], btype='band', fs=SR, output='sos'), x)
    return (0.05 * y / np.abs(y).max() + 0.002 * rng.standard_normal(len(y))).astype(np.float32)


class DeviceCalibrationGateTests(unittest.TestCase):
    """Con el umbral calibrado con el equipo, sin latidos claros el corazón no da normal ni anormal."""

    def setUp(self):
        import soundfile as sf
        self.sf = sf
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = Path(self.tmp.name) / 'colocacion.json'
        p = patch.object(placement, 'CONFIG_PATH', self.cfg)
        p.start()
        self.addCleanup(p.stop)
        self.model_calls = []

        def fake_model(x):
            import torch
            self.model_calls.append(x.shape)
            return torch.zeros(x.shape[0])
        for target, value in (('_load', lambda: None), ('_model', fake_model), ('_meta', {'umbral': 0.5})):
            q = patch.object(classifier, target, value)
            q.start()
            self.addCleanup(q.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def configure(self, device=None):
        heart = {'activo': True, 'umbral': 0.156}
        if device is not None:
            heart['equipo'] = {'umbral': device}
        self.cfg.write_text(json.dumps({'corazon': heart, 'pulmon': {'activo': False, 'umbral': 0.1}}))
        placement._config = None

    def wav(self, y, name):
        path = Path(self.tmp.name) / name
        self.sf.write(str(path), y, SR)
        return path

    def test_rumble_is_blocked_and_the_model_never_runs(self):
        self.configure(device=0.15)
        out = classifier.classify_wav(self.wav(rumble(), 'roce.wav'), check_placement=True)
        self.assertEqual(out['result'], 'calidad_insuficiente')
        self.assertIsNone(out['probability'])
        self.assertIn('latidos claros', out['details']['motivo'])
        self.assertTrue(out['details']['colocacion']['bloquea'])
        self.assertEqual(self.model_calls, [])

    def test_clear_heartbeat_is_classified(self):
        self.configure(device=0.15)
        out = classifier.classify_wav(self.wav(heartbeat(), 'latido.wav'), check_placement=True)
        self.assertIn(out['result'], ('normal', 'anormal'))
        self.assertTrue(out['details']['colocacion']['ok'])
        self.assertEqual(len(self.model_calls), 1)

    def test_without_device_calibration_it_only_warns(self):
        self.configure(device=None)
        out = classifier.classify_wav(self.wav(rumble(), 'roce.wav'), check_placement=True)
        self.assertIn(out['result'], ('normal', 'anormal'))
        self.assertFalse(out['details']['colocacion']['ok'])
        self.assertFalse(out['details']['colocacion']['bloquea'])

    def test_uploaded_files_are_not_checked(self):
        self.configure(device=0.15)
        out = classifier.classify_wav(self.wav(rumble(), 'roce.wav'), check_placement=False)
        self.assertIn(out['result'], ('normal', 'anormal'))


class DeviceThresholdProposalTests(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'IA'))
        import calibrar_colocacion_equipo
        self.propose = calibrar_colocacion_equipo.proponer_umbral

    def test_separated_groups_give_the_midpoint(self):
        thr, _ = self.propose([0.30, 0.25, 0.40], [0.05, 0.10, 0.15], minimo=3)
        self.assertAlmostEqual(thr, 0.20)

    def test_overlap_or_too_few_recordings_give_no_threshold(self):
        self.assertIsNone(self.propose([0.30, 0.12, 0.40], [0.05, 0.10, 0.15], minimo=3)[0])
        self.assertIsNone(self.propose([0.30, 0.25], [0.05, 0.10, 0.15], minimo=3)[0])


if __name__ == '__main__':
    unittest.main()
