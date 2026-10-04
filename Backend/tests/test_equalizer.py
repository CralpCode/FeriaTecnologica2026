"""Ecualizador: solo con medición, solo bandas confiables, solo audio del dispositivo.

Las señales son senoidales artificiales: comprueban el filtro, no la exactitud clínica.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
_tmp = tempfile.TemporaryDirectory()
os.environ['SPIROSCAN_DB_PATH'] = str(Path(_tmp.name) / 'unit_test.db')
os.environ['LLM_BASE_URL'] = 'http://127.0.0.1:9/v1'  # sin LLM real en las pruebas
import database
import audio_service
from ml import equalizer

SR = 16000
RESUMEN = {
    "variante": "tpu_membrana", "relativa_a_referencia": False,
    "ganancia_db_vs_100_600Hz": {"30 Hz": -40.0, "50 Hz": -10.0, "100 Hz": 0.0, "200 Hz": 0.0,
                                 "400 Hz": 0.0, "600 Hz": 0.0, "1000 Hz": 3.0},
    "bandas_coherencia_baja": ["30 Hz"],
}


def tone(freq, seconds=3.0):
    t = np.arange(int(SR * seconds)) / SR
    return (0.1 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def level_db(y):
    mid = y[len(y) // 4: -len(y) // 4]  # sin los bordes del filtro
    return 20 * np.log10(np.sqrt(np.mean(mid ** 2)))


class EqualizerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        database.DB_PATH = str(Path(self.tmp.name) / 'test.db')
        database.init_db()
        for module, attr, value in ((audio_service, 'REC_DIR', Path(self.tmp.name)),
                                    (equalizer, 'CONFIG_PATH', Path(self.tmp.name) / 'ecualizador.json')):
            p = patch.object(module, attr, value)
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def activate(self, modes=('corazon', 'pulmon')):
        profile = equalizer.build_profile(RESUMEN)
        equalizer.CONFIG_PATH.write_text(json.dumps({"perfiles": {m: profile for m in modes}}))
        return profile

    def test_profile_inverts_measurement_skips_unreliable_bands_and_limits_boost(self):
        p = equalizer.build_profile(RESUMEN)
        self.assertNotIn("30", p["correccion_db"])        # coherencia baja: no se toca
        self.assertEqual(p["correccion_db"]["50"], 10.0)    # pierde 10 dB -> se refuerzan 10 dB
        self.assertEqual(p["correccion_db"]["1000"], -3.0)  # sobra 3 dB -> se atenúan 3 dB
        limited = equalizer.build_profile({**RESUMEN, "bandas_coherencia_baja": []}, max_boost_db=12)
        self.assertEqual(limited["correccion_db"]["30"], 12.0)  # -40 dB medido, pero máximo +12 dB
        with self.assertRaises(ValueError):
            equalizer.build_profile({**RESUMEN, "bandas_coherencia_baja": list(RESUMEN["ganancia_db_vs_100_600Hz"])})

    def test_filter_applies_measured_correction(self):
        p = equalizer.build_profile(RESUMEN)
        for freq, expected in ((50, 10.0), (400, 0.0), (1000, -3.0)):
            y = tone(freq)
            self.assertAlmostEqual(level_db(equalizer.apply(y, SR, p)) - level_db(y), expected, delta=1.0, msg=freq)

    def test_without_measurement_nothing_is_applied(self):
        self.assertIsNone(equalizer.profile_for('corazon'))

    def record_device(self, mode='corazon'):
        rid = audio_service.start('p1', 'MV' if mode == 'corazon' else 'AL', SR, source='real')
        pcm = (tone(100, 10) * 32767).astype('<i2').tobytes()
        for i in range(0, len(pcm), 16000):  # bloques de 0.5 s, como el ESP32
            audio_service.append_chunk(rid, pcm[i:i + 16000])
        return audio_service.finish(rid)

    def fake_classifier(self, calls):
        def classify(path, eq=None, check_placement=False):
            calls.append(eq)
            return {"result": "normal", "probability": 0.1, "threshold": 0.8, "quality": {}, "details": {}}
        return classify

    def test_device_recordings_are_equalized_and_traced(self):
        self.activate()
        calls = []
        with patch('ml.classifier.classify_wav', self.fake_classifier(calls)):
            out = self.record_device('corazon')
        self.assertIsNotNone(calls[0])
        self.assertEqual(out["details"]["ecualizacion"]["perfil"], "tpu_membrana")
        stored = database.list_recordings('p1')[0]
        self.assertEqual(stored["details"]["ecualizacion"]["perfil"], "tpu_membrana")

    def test_mode_without_profile_and_uploads_are_not_equalized(self):
        self.activate(modes=('pulmon',))
        calls = []
        with patch('ml.classifier.classify_wav', self.fake_classifier(calls)):
            out = self.record_device('corazon')          # corazón sin perfil
            wav = Path(self.tmp.name) / 'subido.wav'
            import soundfile as sf
            sf.write(wav, tone(100, 10), SR)
            up = audio_service.save_upload('p1', 'MV', wav.read_bytes(), 'corazon', 'real')  # archivo subido
        self.assertEqual(calls, [None, None])
        self.assertNotIn("ecualizacion", out["details"])
        self.assertNotIn("ecualizacion", up["details"])


if __name__ == '__main__':
    unittest.main()
