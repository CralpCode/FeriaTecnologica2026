"""Compresión sin pérdida del ESP32 (rice1): idéntica bit a bit o rechazada, nunca analizada con errores."""
import hashlib
import shutil
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np

import audio_codec
from test_device_command import database, audio_service, main, TestClient

ESP32_DIR = Path(__file__).resolve().parents[2] / 'Esp32'


def samples():
    rng = np.random.default_rng(7)
    t = np.arange(240000) / 16000
    heart = (800 * np.sin(2 * np.pi * 40 * t) * (np.sin(2 * np.pi * 1.2 * t) > 0.95)
             + rng.normal(0, 30, t.size)).astype(np.int16)
    return {
        'latidos': heart,
        'silencio': np.zeros(240000, np.int16),
        'ruido_escala_completa': rng.integers(-32768, 32768, 240000).astype(np.int16),
        'saturacion': np.tile(np.array([32767, -32768], np.int16), 120000),
        'escalon': np.repeat(np.array([0, 32767, -32768, 5], np.int16), 60000),
        'corto': rng.integers(-300, 300, 1025).astype(np.int16),
        'una_muestra': np.array([-32768], np.int16),
    }


class CodecTests(unittest.TestCase):
    def test_round_trip_is_bit_exact_and_never_much_larger(self):
        for name, x in samples().items():
            with self.subTest(name):
                data = audio_codec.encode(x)
                np.testing.assert_array_equal(audio_codec.decode(data, len(x)), x)
                blocks = -(-len(x) // audio_codec.BLOCK)
                self.assertLessEqual(len(data), 2 * len(x) + blocks)

    def test_quiet_heart_sounds_compress(self):
        x = samples()['latidos']
        self.assertLess(len(audio_codec.encode(x)), 0.7 * 2 * len(x))

    def test_firmware_encoder_matches_reference(self):
        compiler = shutil.which('clang++') or shutil.which('g++')
        if not compiler:
            self.skipTest('Sin compilador C++')
        with tempfile.TemporaryDirectory() as tmp:
            exe = Path(tmp) / 'rice_enc'
            subprocess.run([compiler, '-std=c++17', '-O2', '-o', str(exe), str(ESP32_DIR / 'tests' / 'rice_codec_test.cpp')],
                           check=True)
            for name, x in samples().items():
                with self.subTest(name):
                    out = subprocess.run([str(exe)], input=x.astype('<i2').tobytes(), capture_output=True, check=True).stdout
                    self.assertEqual(out, audio_codec.encode(x))

    def test_corrupt_or_truncated_stream_is_rejected(self):
        x = samples()['latidos']
        data = bytearray(audio_codec.encode(x))
        with self.assertRaises(ValueError):
            audio_codec.decode(bytes(data[:-10]), len(x))
        with self.assertRaises(ValueError):
            audio_codec.decode(bytes(data) + b'\x00', len(x))


class CompressedUploadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.previous_db = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'codec.db')
        database.init_db()
        self.dir_patch = patch.object(audio_service, 'REC_DIR', Path(self.tmp.name))
        self.dir_patch.start()
        self.client = TestClient(main.app)
        main._armed.clear()
        self.pcm = samples()['latidos']
        self.raw = self.pcm.astype('<i2').tobytes()
        self.stream = audio_codec.encode(self.pcm)

    def tearDown(self):
        self.client.close()
        self.dir_patch.stop()
        database.DB_PATH = self.previous_db
        self.tmp.cleanup()

    def upload(self, stream):
        rec = audio_service.start('codec_patient', 'AV', 16000, source='real')
        for offset in range(0, len(stream), 6553):          # bloques de tamaño impar, como puede llegar
            r = self.client.post('/api/audio/chunk', params={'recording_id': rec, 'offset': offset, 'codec': 'rice1',
                                                             'total': len(stream)}, content=stream[offset:offset + 6553])
            self.assertEqual(r.status_code, 200)
        return rec

    def finish(self, rec):
        return self.client.post('/api/audio/finish', params={
            'recording_id': rec, 'background': True, 'codec': 'rice1', 'expected_bytes': len(self.raw),
            'sha256': hashlib.sha256(self.raw).hexdigest()})

    def test_compressed_upload_stores_identical_audio(self):
        rec = self.upload(self.stream)
        self.assertEqual(audio_service.recording_status('codec_patient')['pending'][0]['bytes_total'], len(self.stream))
        r = self.finish(rec)
        self.assertEqual(r.status_code, 202)
        self.assertTrue(r.json()['verified'])
        with wave.open(database.get_recording(rec)['wav_path'], 'rb') as w:
            self.assertEqual(w.readframes(w.getnframes()), self.raw)

    def test_damaged_compressed_audio_never_reaches_analysis(self):
        damaged = bytearray(self.stream)
        damaged[len(damaged) // 2] ^= 0x10
        rec = self.upload(bytes(damaged))
        self.assertEqual(self.finish(rec).status_code, 400)
        self.assertEqual(database.get_recording(rec)['status'], 'recording')
        self.assertEqual(database.pending_audio_jobs(), [])


if __name__ == '__main__':
    unittest.main()
