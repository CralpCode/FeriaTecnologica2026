"""Protocol fixtures only; no patient measurements or model-training data."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("gateway", Path(__file__).resolve().parents[2] / "gateway.py")
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class TelemetryTests(unittest.TestCase):
    def packet(self, **changes):
        packet = dict(bpm=75, spo2=98, source="real", finger=True,
                      heartRateValid=True, bloodOxygenValid=True,
                      spo2Calibrated=True, signalQuality="good", sampleAgeMs=0)
        packet.update(changes)
        return gateway.normalizar_telemetria(packet)

    def test_legacy_is_not_silently_promoted(self):
        p = gateway.normalizar_telemetria(dict(bpm=75, spo2=98))
        self.assertEqual(p["source"], "unknown")
        self.assertFalse(p["heartRateValid"])
        self.assertFalse(p["bloodOxygenValid"])

    def test_fresh_explicit_measurement(self):
        p = self.packet()
        self.assertTrue(p["heartRateValid"])
        self.assertTrue(p["bloodOxygenValid"])

    def test_simulation_overrides_claimed_real(self):
        p = self.packet(test=True)
        self.assertEqual(p["source"], "simulated")
        self.assertFalse(p["heartRateValid"])
        self.assertFalse(p["bloodOxygenValid"])

    def test_uncalibrated_spo2_unavailable(self):
        p = self.packet(spo2Calibrated=False)
        self.assertFalse(p["bloodOxygenValid"])
        self.assertEqual(gateway.formato_medida(p, "spo2", "bloodOxygenValid", "%"), "no disponible")

    def test_stale_contact_quality_and_invalid_numbers(self):
        for fields in [dict(sampleAgeMs=251), dict(sampleAgeMs=None), dict(sampleAgeMs=True),
                       dict(finger=False), dict(signalQuality="poor"), dict(bpm=float("nan")), dict(bpm=True)]:
            with self.subTest(fields=fields):
                self.assertFalse(self.packet(**fields)["heartRateValid"])
        self.assertFalse(self.packet(spo2=101)["bloodOxygenValid"])


if __name__ == "__main__":
    unittest.main()
