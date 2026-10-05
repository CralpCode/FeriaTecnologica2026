"""Pruebas de software con señales artificiales: nunca se usan para métricas clínicas."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent / "Backend"))
sys.path.insert(0, str(ROOT))
from ml import classifier, features, lung, lung_baseline
from src.lung_data import load_icbhi
from src.evaluate import clinical_metrics


class SafetyTests(unittest.TestCase):
    def wav(self, samples, rate=2000):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / "unit_test.wav"
        sf.write(path, samples, rate, subtype="FLOAT")
        return path

    def test_invalid_recordings_abstain_without_loading_models(self):
        for signal in (np.zeros(20000), np.ones(20000),
                       np.full(20000, np.nan), np.full(20000, 0.2)):
            path = self.wav(signal)
            with patch.object(classifier, "_load", side_effect=AssertionError("must abstain")), \
                 patch.object(lung, "_load", side_effect=AssertionError("must abstain")):
                self.assertEqual(classifier.classify_wav(path)["result"], "calidad_insuficiente")
                self.assertEqual(lung.classify_wav(path)["result"], "calidad_insuficiente")

    def test_unusable_lung_heads_do_not_mean_normal(self):
        path = self.wav(0.1 * np.sin(np.arange(20000) * 0.2))
        model = lambda x: torch.zeros((len(x), 2))
        meta = {"salidas": ["crepitantes", "sibilancias"],
                "metricas_prueba": {n: {"mostrar": False} for n in ("crepitantes", "sibilancias")}}
        with patch.object(lung, "_load", side_effect=lambda name: (model, meta) if name == "lung_sounds_cnn" else None), \
             patch.object(lung.LF, "features_from_audio", return_value=np.zeros((2, 1, 64, 126), dtype=np.float32)), \
             patch.object(lung.lung_baseline, "classify_audio", return_value={"estado": "no_disponible"}):
            result = lung.classify_wav(path)
        self.assertEqual(result["result"], "indeterminado")
        self.assertIsNone(result["probability"])

    def test_nonfinite_neural_output_abstains(self):
        path = self.wav(0.1 * np.sin(np.arange(20000) * 0.2))
        with patch.object(classifier, "_load"), \
             patch.object(classifier, "_model", lambda x: torch.full((len(x),), float("nan"))):
            result = classifier.classify_wav(path)
        self.assertEqual(result["result"], "indeterminado")

    def test_missing_and_nonfinite_features_are_never_filled_in(self):
        for vector in ({"a": 1}, [1], [1, float("nan")], None):
            with self.assertRaises(ValueError):
                lung_baseline._vector(vector, ["a", "b"])
        self.assertEqual(lung_baseline._vector({"a": 1, "b": 2}, ["a", "b"]), [1, 2])

    def test_legacy_murmur_head_is_not_reported_as_validated(self):
        with patch.object(classifier, "_load_murmur", return_value=True), \
             patch.object(classifier, "_murmur_meta", {"caracteristicas": {"intensidad": {"mostrar": True}}}):
            self.assertEqual(classifier.describe_murmur(None), {})

    def test_stereo_uses_samples_axis(self):
        mono = np.sin(np.arange(20000) * 0.2).astype(np.float32)
        np.testing.assert_allclose(features.preprocess(np.stack([mono, mono], axis=1), 2000),
                                   features.preprocess(mono, 2000))

    def test_icbhi_split_is_not_invented(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "101_1b1_Al_sc_Meditron.wav").touch()
            with self.assertRaisesRegex(ValueError, "partición oficial"):
                load_icbhi(Path(folder))

    def test_icbhi_rejects_patient_overlap(self):
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder)
            names = ["101_1b1_Al_sc_Meditron", "101_1b1_Ar_sc_Meditron"]
            for name in names:
                (p / f"{name}.wav").touch()
            (p / "ICBHI_challenge_train_test.txt").write_text(f"{names[0]} train\n{names[1]} test\n")
            with self.assertRaisesRegex(ValueError, "Fuga"):
                load_icbhi(p)
            # Solo con la opción explícita: el paciente que cruza queda completo en prueba
            recs = load_icbhi(p, overlap_to_test=True)
            self.assertEqual({r.split for r in recs}, {"test"})

    def test_empty_metrics_and_nonfinite_scores_rejected(self):
        with self.assertRaises(ValueError):
            clinical_metrics([], [])
        with self.assertRaises(ValueError):
            clinical_metrics([0], [float("nan")])


if __name__ == "__main__":
    unittest.main()
