"""Transport retries, integrity and capture while inference is busy."""
import hashlib
import asyncio
import wave
import threading
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from test_device_command import database, audio_service, main, TestClient


class AudioQueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.previous_db = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'queue.db')
        database.init_db()
        self.dir_patch = patch.object(audio_service, 'REC_DIR', Path(self.tmp.name))
        self.dir_patch.start()
        self.client = TestClient(main.app)
        main._armed.clear()
        self.raw = b'\x01\x00' * 240000

    def tearDown(self):
        self.client.close()
        self.dir_patch.stop()
        database.DB_PATH = self.previous_db
        self.tmp.cleanup()

    def capture(self):
        rec = audio_service.start('queue_patient', 'AV', 16000, source='real')
        for offset in range(0, len(self.raw), 128 * 1024):
            audio_service.append_chunk(rec, self.raw[offset:offset + 128 * 1024], offset)
        return rec

    def finish(self, rec, **override):
        params = dict(recording_id=rec, background=True, expected_bytes=len(self.raw),
                      sha256=hashlib.sha256(self.raw).hexdigest())
        params.update(override)
        return self.client.post('/api/audio/finish', params=params)

    def test_duplicate_chunk_does_not_duplicate_samples_and_gap_is_rejected(self):
        rec = audio_service.start('queue_patient', 'AV', 16000)
        block = self.raw[:100]
        self.assertEqual(audio_service.append_chunk(rec, block, 0), 100)
        self.assertEqual(audio_service.append_chunk(rec, block, 0), 100)
        with self.assertRaises(ValueError):
            audio_service.append_chunk(rec, b'\x02\x00' * 50, 0)
        with self.assertRaises(ValueError):
            audio_service.append_chunk(rec, block, 200)
        self.assertEqual(audio_service._pcm_path(rec).read_bytes(), block)

    def test_stale_capture_expires_and_newer_recording_is_reported(self):
        old = audio_service.start('queue_patient', 'TV', 16000, source='real')
        audio_service.append_chunk(old, self.raw[:100], 0)
        with patch.object(audio_service.time, 'time', return_value=audio_service.time.time() + 600):
            self.assertEqual(audio_service.expire_stale_recordings(), 1)
        self.assertEqual(database.get_recording(old)['status'], 'error')
        new = audio_service.start('queue_patient', 'AL', 16000, source='real')
        status = audio_service.recording_status('queue_patient')
        self.assertEqual((status['recording_id'], status['stage']), (new, 'capturing'))
        self.assertEqual(database.get_recording(new)['mode'], 'pulmon')

    def test_bad_hash_and_incomplete_audio_never_enter_analysis(self):
        rec = self.capture()
        self.assertEqual(self.finish(rec, sha256='0' * 64).status_code, 400)
        self.assertEqual(self.finish(rec, expected_bytes=len(self.raw) - 2).status_code, 400)
        self.assertEqual(database.get_recording(rec)['status'], 'recording')
        self.assertEqual(database.pending_audio_jobs(), [])

    def test_saved_audio_can_be_reanalyzed_without_recording_again(self):
        rec = self.capture()
        self.finish(rec)
        database.update_recording(rec, status='error', result='error')
        response = self.client.post(f'/api/recordings/{rec}/retry')
        self.assertEqual(response.status_code, 202)
        self.assertEqual(database.get_recording(rec)['status'], 'queued')
        with wave.open(database.get_recording(rec)['wav_path'], 'rb') as audio:
            self.assertEqual(audio.getnframes(), 240000)

    def test_finish_retry_is_idempotent_and_queue_survives_restart(self):
        rec = self.capture()
        first = self.finish(rec)
        self.assertEqual(first.status_code, 202)
        self.assertTrue(first.json()['verified'])
        self.assertEqual(self.finish(rec).json(), first.json())
        self.assertTrue(database.claim_audio_job(rec))
        self.assertFalse(database.claim_audio_job(rec))
        database.recover_audio_jobs()
        self.assertEqual(database.pending_audio_jobs(), [rec])
        self.assertTrue(Path(database.get_recording(rec)['wav_path']).exists())

    def test_stalled_process_is_terminated_and_saved_audio_is_kept(self):
        rec = self.capture()
        self.assertEqual(self.finish(rec).status_code, 202)
        stalled = Path(self.tmp.name) / 'stalled_worker.py'
        stalled.write_text('import time; time.sleep(60)')
        with patch.object(main, 'AUDIO_WORKER_PATH', str(stalled)):
            result = asyncio.run(main._run_audio_worker(rec, timeout_s=0.1))
        self.assertEqual(result['result'], 'error')
        self.assertTrue(result['has_audio'])
        self.assertEqual(database.pending_audio_jobs(), [])

    def test_next_capture_is_accepted_while_previous_inference_is_blocked(self):
        rec = self.capture()
        self.assertEqual(self.finish(rec).status_code, 202)
        entered, release = threading.Event(), threading.Event()
        def classify(*args, **kwargs):
            entered.set()
            release.wait(5)
            return dict(result='normal', probability=0.1, threshold=0.5, quality={}, details={})
        with patch.object(audio_service.classifier, 'classify_wav', side_effect=classify):
            worker = threading.Thread(target=audio_service.analyze_queued, args=(rec,))
            worker.start()
            try:
                self.assertTrue(entered.wait(3))
                armed = self.client.post('/api/audio/arm', json={'session_id': 'queue_patient', 'location': 'PV'})
                self.assertEqual(armed.status_code, 200)
                started = self.client.post('/api/audio/start', json={'device_id': 'x', 'sample_rate': 16000,
                                                                    'comando_id': armed.json()['comando_id']})
                self.assertEqual(started.status_code, 200)
                second = started.json()['recording_id']
                self.assertEqual(database.get_recording(second)['location'], 'PV')
                self.assertEqual(database.get_recording(rec)['status'], 'processing')
                self.assertEqual(self.client.post('/api/audio/arm', json={'session_id': 'queue_patient', 'location': 'TV'}).status_code, 409)
            finally:
                release.set()
                worker.join(5)
        self.assertEqual(database.get_recording(rec)['status'], 'done')
        self.assertEqual(database.get_recording(second)['status'], 'recording')
