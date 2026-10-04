"""Protocol fixtures only; no patient measurements or model-training data."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("gateway", Path(__file__).resolve().parents[2] / "gateway.py")
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class TelemetryTests(unittest.TestCase):
    def test_compact_v2_keeps_estimate_and_quality_separate_from_calibration(self):
        raw = dict(v=2, valid=31, cal=False, bpm=72, spo2=97.5, hrv=0,
                   chip_temp=29.5, finger=True, power='active', scan_mode='continuous')
        p = gateway.normalizar_telemetria(raw)
        self.assertTrue(p['heartRateValid'])
        self.assertTrue(p['bloodOxygenValid'])
        self.assertFalse(p['spo2Calibrated'])
        self.assertEqual(p['valid'], 31)
        self.assertEqual(p['chip_temp'], 29.5)
        self.assertEqual(p['scan_mode'], 'continuous')
        self.assertFalse(gateway.normalizar_telemetria({**raw, 'test': True})['heartRateValid'])
        self.assertFalse(gateway.normalizar_telemetria({**raw, 'power': 'standby'})['heartRateValid'])

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
