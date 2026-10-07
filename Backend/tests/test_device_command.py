"""Grabación iniciada desde la página: la app da la orden y el ESP32 (sin botón) la recibe preguntando."""
import os
from datetime import datetime, timedelta
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('SPIROSCAN_DB_PATH', str(Path(tempfile.mkdtemp()) / 'unit_test.db'))
os.environ['LLM_BASE_URL'] = 'http://127.0.0.1:9/v1'
import database
from fastapi.testclient import TestClient
import main
import audio_service


class DeviceCommandTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        database.DB_PATH = str(Path(self.tmp.name) / 'test.db')
        database.init_db()
        p = patch.object(audio_service, 'REC_DIR', Path(self.tmp.name))
        p.start()
        self.addCleanup(p.stop)
        main._armed.clear()
        main._device_link.clear()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        self.tmp.cleanup()

    def arm(self, loc='AV', sid='p001'):
        return self.client.post('/api/audio/arm', json={'session_id': sid, 'location': loc}).json()

    def test_no_order_means_null(self):
        self.assertEqual(self.client.get('/api/device/comando').json(), {'accion': None})

    def test_order_is_delivered_and_recording_goes_to_its_zone(self):
        cid = self.arm('PV')['comando_id']
        cmd = self.client.get('/api/device/comando', params={'device_id': 'ESP32-BIO-01'}).json()
        self.assertEqual((cmd['accion'], cmd['id'], cmd['foco'], cmd['segundos']), ('grabar', cid, 'PV', 15))
        r = self.client.post('/api/audio/start', json={'device_id': 'ESP32-BIO-01', 'sample_rate': 16000, 'comando_id': cid})
        self.assertEqual(r.status_code, 200)
        rec = database.get_recording(r.json()['recording_id'])
        self.assertEqual((rec['location'], rec['session_id']), ('PV', 'p001'))
        self.assertEqual(self.client.get('/api/device/comando').json(), {'accion': None})   # una orden = una grabación

    def test_order_also_travels_in_telemetry_response(self):
        cid = self.arm('MV')['comando_id']
        r = self.client.post('/api/telemetry', json={'bpm': 70, 'source': 'real'}).json()
        self.assertEqual(r['comando']['id'], cid)

    def test_stale_order_is_rejected_not_misassigned(self):
        old = self.arm('AV')['comando_id']
        self.arm('MV')                                   # el médico cambió de zona
        r = self.client.post('/api/audio/start', json={'device_id': 'x', 'sample_rate': 16000, 'comando_id': old})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.client.get('/api/device/comando').json()['foco'], 'MV')

    def test_button_flow_without_order_id_still_works(self):
        self.arm('TV')
        r = self.client.post('/api/audio/start', json={'device_id': 'x', 'sample_rate': 16000})
        self.assertEqual(database.get_recording(r.json()['recording_id'])['location'], 'TV')

    def test_order_expires(self):
        self.arm('AV')
        main._armed['at'] -= main.ARM_TTL_S + 1
        self.assertEqual(self.client.get('/api/device/comando').json(), {'accion': None})

    def test_capture_abort_is_terminal_and_rejects_more_audio(self):
        cid = self.arm()['comando_id']
        rec = self.client.post('/api/audio/start', json={'device_id': 'x', 'sample_rate': 16000, 'comando_id': cid}).json()['recording_id']
        self.assertEqual(self.client.post('/api/audio/abort', params={'recording_id': rec}).status_code, 200)
        status = self.client.get('/api/audio/status', params={'session_id': 'p001'}).json()
        self.assertEqual((status['stage'], status['result']['result']), ('error', 'error'))
        self.assertEqual(self.client.post('/api/audio/chunk', params={'recording_id': rec}, content=b'\x00\x00').status_code, 404)

    def test_second_zone_waits_for_current_capture(self):
        cid = self.arm()['comando_id']
        rec = self.client.post('/api/audio/start', json={'device_id': 'x', 'sample_rate': 16000, 'comando_id': cid}).json()['recording_id']
        self.assertEqual(self.client.post('/api/audio/arm', json={'session_id': 'p001', 'location': 'PV'}).status_code, 409)
        self.client.post('/api/audio/abort', params={'recording_id': rec})
        self.assertEqual(self.client.post('/api/audio/arm', json={'session_id': 'p001', 'location': 'PV'}).status_code, 200)

    def test_status_distinguishes_upload_from_processing(self):
        cid = self.arm()['comando_id']
        rec = self.client.post('/api/audio/start', json={'device_id': 'x', 'sample_rate': 16000, 'comando_id': cid}).json()['recording_id']
        from datetime import datetime, timedelta
        database.update_recording(rec, created_at=(datetime.now() - timedelta(seconds=20)).isoformat())
        self.client.post('/api/audio/chunk', params={'recording_id': rec}, content=b'\x00\x00')
        status = self.client.get('/api/audio/status', params={'session_id': 'p001'}).json()
        self.assertEqual((status['stage'], status['bytes_received']), ('uploading', 2))

    def start(self, cid, elapsed_ms=0):
        return self.client.post('/api/audio/start', json={'device_id': 'x', 'sample_rate': 16000, 'comando_id': cid,
                                                          'elapsed_ms': elapsed_ms}).json()['recording_id']

    def test_next_zone_can_be_recorded_while_previous_uploads(self):
        first = self.start(self.arm('AV')['comando_id'], elapsed_ms=18000)   # captura terminada, esperando envío
        self.assertEqual(self.client.get('/api/audio/status', params={'session_id': 'p001'}).json()['stage'],
                         'waiting_upload')
        second_cmd = self.arm('PV')['comando_id']                             # se acepta: el ESP32 tiene cola
        # La orden siguiente viaja en la respuesta del envío (la telemetría está pausada)
        chunk = self.client.post('/api/audio/chunk', params={'recording_id': first, 'offset': 0}, content=b'\x00\x00').json()
        self.assertEqual(chunk['comando']['id'], second_cmd)
        second = self.start(second_cmd)
        status = self.client.get('/api/audio/status', params={'session_id': 'p001'}).json()
        self.assertEqual((status['recording_id'], status['stage']), (second, 'capturing'))
        self.assertEqual({p['recording_id']: p['stage'] for p in status['pending']},
                         {first: 'uploading', second: 'capturing'})
        r = self.client.post('/api/audio/arm', json={'session_id': 'p001', 'location': 'TV'})
        self.assertEqual(r.status_code, 409)                                  # todavía grabando
        database.update_recording(second, created_at=(datetime.now() - timedelta(seconds=20)).isoformat())
        r = self.client.post('/api/audio/arm', json={'session_id': 'p001', 'location': 'TV'})
        self.assertEqual(r.status_code, 409)                                  # cola del ESP32 llena
        self.assertIn('enviando', r.json()['detail'])

    def test_delivered_order_blocks_next_zone_until_capture_registers(self):
        cid = self.arm('AV')['comando_id']
        self.client.get('/api/device/comando')                                # el ESP32 la tomó
        self.assertEqual(self.client.post('/api/audio/arm', json={'session_id': 'p001', 'location': 'PV'}).status_code, 409)
        self.start(cid)                                                       # registrada: la regla normal decide
        self.assertEqual(self.client.post('/api/audio/arm', json={'session_id': 'p001', 'location': 'PV'}).status_code, 409)

    def test_elapsed_capture_time_sets_recording_start(self):
        rec = self.start(self.arm('AV')['comando_id'], elapsed_ms=6000)
        age = (datetime.now() - datetime.fromisoformat(database.get_recording(rec)['created_at'])).total_seconds()
        self.assertAlmostEqual(age, 6, delta=1)

    def test_abandoned_capture_does_not_wait_forever(self):
        cid = self.arm()['comando_id']
        rec = self.client.post('/api/audio/start', json={'device_id': 'x', 'sample_rate': 16000, 'comando_id': cid}).json()['recording_id']
        os.utime(audio_service._pcm_path(rec), (0, 0))
        status = self.client.get('/api/audio/status', params={'session_id': 'p001'}).json()
        self.assertEqual(status['stage'], 'error')
        self.assertIsNotNone(database.get_recording(rec)['finished_at'])


if __name__ == '__main__':
    unittest.main()
