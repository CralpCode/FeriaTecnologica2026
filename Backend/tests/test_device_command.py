"""Grabación iniciada desde la página: la app da la orden y el ESP32 (sin botón) la recibe preguntando."""
import os
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


if __name__ == '__main__':
    unittest.main()
