"""Los rasgos del modelo AST en el servidor son idénticos a los del entrenamiento (IA/train_lung_ast.py)."""
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "Backend"))
from ml import lung

try:
    sys.path.insert(0, str(ROOT / "IA"))
    import train_lung_ast as T
except Exception:  # sin la carpeta IA o sus dependencias no se puede comparar
    T = None


@unittest.skipIf(T is None, "IA/train_lung_ast.py no disponible")
class AstParityTests(unittest.TestCase):
    META = {"sr": 16000, "frames": 512, "num_mel_bins": 128, "frame_shift_ms": 10, "ventana_s": 5.12, "salto_s": 2.56,
            "media": -4.2677393, "desviacion": 4.5689974}

    def test_same_features_as_training(self):
        rng = np.random.default_rng(0)
        y = (rng.standard_normal(int(16000 * 12)) * 0.1).astype(np.float32)
        server = lung.ast_features(y, 16000, self.META).numpy()
        import torch
        n, hop = int(16000 * 5.12), int(16000 * 2.56)
        for k, s in enumerate(range(0, len(y) - n + 1, hop)):
            train = T.fbank(torch.from_numpy(T.fit_length(y[s:s + n], None))).numpy()
            self.assertLess(float(np.abs(server[k] - train).max()), 1e-3)

    def test_short_audio_is_repeated_like_training(self):
        y = np.sin(np.arange(16000 * 3) * 0.05).astype(np.float32)
        import torch
        server = lung.ast_features(y, 16000, self.META).numpy()[0]
        train = T.fbank(torch.from_numpy(T.fit_length(y, None))).numpy()
        self.assertLess(float(np.abs(server - train).max()), 1e-3)


if __name__ == "__main__":
    unittest.main()
