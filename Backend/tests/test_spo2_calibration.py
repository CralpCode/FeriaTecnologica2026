"""Corrección del SpO2 en el servidor contra el oxímetro de referencia."""
import unittest
from unittest import mock

import measurement_quality as mq
import spo2_calibration as cal

PAIRS = [{"sensor": 100.0, "oximetro": 95.0}, {"sensor": 95.0, "oximetro": 92.0}, {"sensor": 97.5, "oximetro": 95.0}]
CONFIG = {"activo": True, "metodo": "desplazamiento", "pares": PAIRS, **cal.fit(PAIRS)}


class Spo2CalibrationTests(unittest.TestCase):
    def test_fit_is_the_mean_offset(self):
        r = cal.fit(PAIRS)
        self.assertEqual(r["n"], 3)
        self.assertAlmostEqual(r["desplazamiento"], -3.5)
        self.assertLess(r["rms_despues"], r["rms_antes"])

    def test_correct_applies_offset_and_caps_at_100(self):
        with mock.patch.object(cal, "_CONFIG", {**CONFIG, "desplazamiento": 2.0}):
            self.assertEqual(cal.correct(97.0), 99.0)
            self.assertEqual(cal.correct(99.5), 100.0)
            self.assertIsNone(cal.correct(None))
            self.assertEqual(cal.correct(0), 0)

    def test_apply_only_real_device_and_keeps_raw(self):
        with mock.patch.object(cal, "_CONFIG", CONFIG):
            real = {"source": "real", "spo2": 98.0}
            cal.apply(real)
            self.assertEqual(real, {"source": "real", "spo2": 94.5, "spo2Raw": 98.0})
            self.assertIn("spo2Raw", mq.metadata(real))
            sim = {"source": "simulated", "spo2": 98.0}
            cal.apply(sim)
            self.assertEqual(sim, {"source": "simulated", "spo2": 98.0})

    def test_without_active_calibration_nothing_changes(self):
        with mock.patch.object(cal, "_CONFIG", None):
            data = {"source": "real", "spo2": 98.0}
            cal.apply(data)
            self.assertEqual(data, {"source": "real", "spo2": 98.0})


if __name__ == "__main__":
    unittest.main()
