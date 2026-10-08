"""SpO2 estimada (fórmula del fabricante, sin calibrar): se usa solo con su etiqueta."""
import unittest
from datetime import datetime

import measurement_quality as mq


def packet(**over):
    base = {"source": "real", "signalQuality": "good", "finger": True, "sampleAgeMs": 100,
            "timestamp": datetime.now().isoformat(), "bloodOxygenValid": True, "spo2Calibrated": False,
            "spo2Estimated": True, "bloodOxygen": 96.0}
    base.update(over)
    return base


class EstimatedSpo2Tests(unittest.TestCase):
    def test_estimated_value_is_never_taken_as_calibrated(self):
        self.assertIsNone(mq.usable_value(packet(), "bloodOxygen"))
        self.assertEqual(mq.usable_value(packet(), "bloodOxygen", allow_estimated=True), 96.0)

    def test_estimate_requires_flag_validity_and_plausible_range(self):
        self.assertIsNone(mq.usable_value(packet(spo2Estimated=False), "bloodOxygen", allow_estimated=True))
        self.assertIsNone(mq.usable_value(packet(bloodOxygenValid=False), "bloodOxygen", allow_estimated=True))
        self.assertIsNone(mq.usable_value(packet(bloodOxygen=55.0), "bloodOxygen", allow_estimated=True))
        self.assertIsNone(mq.usable_value(packet(signalQuality="acquiring"), "bloodOxygen", allow_estimated=True))

    def test_packet_cleaning_keeps_the_estimated_flag(self):
        out, _ = mq.clean_packet({"v": 2, "valid": 3, "bpm": 70, "spo2": 96.0, "spo2Estimated": True,
                                  "finger": True, "sampleAgeMs": 50})
        self.assertIs(out["spo2Estimated"], True)
        self.assertIs(out["spo2Calibrated"], False)
        self.assertIn("spo2Estimated", mq.metadata(out))


class EstimatedSpo2AssessmentTests(unittest.TestCase):
    def assess(self, spo2):
        import clinical_assessment
        ctx = clinical_assessment.ClinicalContext().model_dump()
        vitals = {"heartRate": 72.0, "bloodOxygen": spo2, "spo2_estimated": True, "counts": {}}
        return clinical_assessment.assess(ctx, vitals, [])

    def test_low_estimate_never_creates_a_finding(self):
        out = self.assess(80.5)
        self.assertEqual(out["findings"], [])
        self.assertNotEqual(out["status"], "urgent")
        self.assertNotEqual(out["status"], "findings")

    def test_uncalibrated_or_missing_spo2_never_blocks_green(self):
        import clinical_assessment
        ctx = clinical_assessment.ClinicalContext(
            age_years=30, at_rest=True, altitude_m=1500,
            symptoms={k: False for k in clinical_assessment.Symptoms.model_fields},
            history={k: False for k in clinical_assessment.History.model_fields}).model_dump()
        recs = [{"id": f, "mode": "corazon", "location": f, "result": "normal", "source": "real"}
                for f in ("AV", "PV", "TV", "MV")] + [{"id": "AL", "mode": "pulmon", "location": "AL",
                                                       "result": "normal", "source": "real"}]
        for spo2, estimated in ((80.5, True), (None, False)):
            out = clinical_assessment.assess(ctx, {"heartRate": 72.0, "bloodOxygen": spo2,
                                                   "spo2_estimated": estimated, "counts": {}}, recs)
            self.assertEqual(out["status"], "no_specific_findings", out["missing_data"])
            self.assertFalse(any("SpO2" in m for m in out["missing_data"]))
            self.assertTrue(any("SpO2 calibrada" in m for m in out["limitations"]))


if __name__ == "__main__":
    unittest.main()
