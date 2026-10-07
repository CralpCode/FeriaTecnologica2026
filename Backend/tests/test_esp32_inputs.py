"""Lo que envía el ESP32 es externo: paquetes incompletos o raros nunca deben tumbar el servidor.

Las señales de audio de estas pruebas son artificiales y solo comprueban el manejo de errores.
"""
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
_tmp = tempfile.TemporaryDirectory()
os.environ['SPIROSCAN_DB_PATH'] = str(Path(_tmp.name) / 'unit_test.db')
os.environ['LLM_BASE_URL'] = 'http://127.0.0.1:9/v1'  # sin LLM real en las pruebas
os.environ['SPIROSCAN_MDNS'] = '0'
import database
import clinical_assessment as clinical
import measurement_quality
import alerts
from fastapi.testclient import TestClient
import main
import audio_service
import reports

# Formato que envía el firmware original (Esp32.ino en e45fde1): sin indicadores de calidad.
LEGACY = {"bpm": 72, "spo2": 98.2, "stress": 40, "hrv": 50, "audio_rms": 12.5, "audio_peak": 30.1,
          "finger": True, "test": False, "device_id": "ESP32-BIO-01"}


class Esp32InputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        # Audios e informes de prueba en carpetas temporales, nunca en Backend/recordings ni reports
        for module, attr in ((audio_service, 'REC_DIR'), (reports, 'REPORT_DIR')):
            patcher = patch.object(module, attr, Path(self.tmp.name))
            patcher.start()
            self.addCleanup(patcher.stop)
        database.DB_PATH = str(Path(self.tmp.name) / 'test.db')
        database.init_db()
        main._sessions_cache.clear()
        main._device_link.clear()
        main._armed.clear()
        alerts._since.clear()
        alerts._last_alert.clear()
        alerts._last_packet.clear()
        measurement_quality._legacy_recent.clear()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        self.tmp.cleanup()

    def send(self, **changes):
        packet = {**LEGACY, **changes}
        r = self.client.post('/api/telemetry', json=packet)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['saved']

    # --- Telemetría en formato original -------------------------------------------------

    def test_legacy_pulse_used_only_after_three_stable_readings(self):
        first = self.send(bpm=72)
        self.assertFalse(first['heartRateValid'])
        self.send(bpm=75)
        saved = self.send(bpm=74)
        self.assertTrue(saved['heartRateValid'])
        self.assertEqual(saved['source'], 'real')
        self.assertEqual(saved['validadoPor'], 'servidor')
        # La valoración además exige 3 lecturas válidas: con el formato original, desde el 5.º paquete.
        self.assertIsNone(clinical.recent_vitals('ESP32-BIO-01')['heartRate'])
        self.send(bpm=76)
        self.send(bpm=73)
        v = clinical.recent_vitals('ESP32-BIO-01')
        self.assertEqual(v['heartRate'], 74)
        self.assertIsNone(v['bloodOxygen'])

    def test_legacy_spo2_hrv_and_stress_are_never_stored(self):
        for _ in range(3):
            saved = self.send()
        self.assertEqual(saved['bloodOxygen'], 0)
        self.assertFalse(saved['bloodOxygenValid'])
        self.assertFalse(saved['spo2Calibrated'])
        self.assertEqual(saved['hrv'], 0)
        self.assertEqual(saved['stressLevel'], 0)
        self.assertEqual(database.get_vitals_summary('ESP32-BIO-01')['n_spo2'], 0)

    def test_legacy_unstable_out_of_range_or_no_finger_is_not_used(self):
        for sequence in ([72, 130, 75], [72, 25, 74], [72, 230, 74]):
            measurement_quality._legacy_recent.clear()
            for bpm in sequence:
                saved = self.send(bpm=bpm)
            self.assertFalse(saved['heartRateValid'], sequence)
        measurement_quality._legacy_recent.clear()
        for _ in range(3):
            saved = self.send(finger=False)
        self.assertFalse(saved['heartRateValid'])
        self.assertEqual(saved['signalQuality'], 'no_finger')

    def test_legacy_test_packets_are_simulated(self):
        for _ in range(3):
            saved = self.send(test=True)
        self.assertEqual(saved['source'], 'simulated')
        self.assertIsNone(measurement_quality.usable_value(saved, 'heartRate'))

    def test_new_format_flags_are_respected_not_recomputed(self):
        r = self.client.post('/api/telemetry', json={**LEGACY, 'source': 'real', 'heartRateValid': False,
                                                     'signalQuality': 'good', 'sampleAgeMs': 0})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()['saved']['heartRateValid'])
        self.assertNotEqual(r.json()['saved'].get('validadoPor'), 'servidor')

    def test_incomplete_or_strange_packets_never_fail(self):
        weird = [{}, {'bpm': None}, {'bpm': '80'}, {'bpm': [1, 2]}, {'bpm': {'x': 1}}, {'bpm': True},
                 {'spo2': 'abc'}, {'finger': 'si'}, {'finger': 7}, {'session_id': 123}, {'session_id': ['a']},
                 {'device_id': None}, {'heartRateValid': 'true'}, {'source': 'marte'}, {'sampleAgeMs': -5},
                 {'bpm': 10 ** 12}, {'audio_rms': 'NaN'}, {'extra': {'muy': ['anidado']}}, LEGACY]
        for packet in weird:
            r = self.client.post('/api/telemetry', json=packet)
            self.assertEqual(r.status_code, 200, (packet, r.text))
        for body in (b'{"bpm": NaN, "finger": true}', b'{"bpm": Infinity}'):
            r = self.client.post('/api/telemetry', content=body, headers={'Content-Type': 'application/json'})
            self.assertEqual(r.status_code, 200, body)
            self.assertEqual(r.json()['saved']['heartRate'], 0)

    def test_firmware_v2_reaches_websocket_current_history_and_sqlite(self):
        packet = {"v": 2, "valid": 1, "source": "real", "device_id": "ESP32-BIO-01",
                  "bpm": 77, "spo2": 0, "finger": True, "heartRateValid": True,
                  "bloodOxygenValid": False, "spo2Calibrated": False,
                  "signalQuality": "good", "sampleAgeMs": 12, "audioUnit": "dBFS"}
        with self.client.websocket_connect('/ws/live') as ws:
            self.assertEqual(ws.receive_json()['type'], 'INITIAL_STATE')
            response = self.client.post('/api/telemetry', json=packet)
            self.assertEqual(response.status_code, 200)
            event = ws.receive_json()
            self.assertEqual(event['type'], 'VITALS_UPDATE')
            self.assertEqual(event['data']['heartRate'], 77)
            self.assertTrue(event['data']['heartRateValid'])
        current = self.client.get('/api/vitals/current', params={'session_id': 'ESP32-BIO-01'}).json()
        self.assertEqual(current['heartRate'], 77)
        self.assertEqual(current['sampleAgeMs'], 12)
        history = self.client.get('/api/vitals/history', params={'session_id': 'ESP32-BIO-01'}).json()
        self.assertTrue(history)
        conn = database.get_db_connection()
        row = conn.execute('SELECT heartRate, measurement_metadata FROM vitals_log ORDER BY id DESC LIMIT 1').fetchone()
        conn.close()
        self.assertEqual(row['heartRate'], 77)
        self.assertIn('"heartRateValid": true', row['measurement_metadata'])
        # Removing contact must clear eligibility in every receiving layer.
        packet.update(valid=0, bpm=0, finger=False, heartRateValid=False, signalQuality='no_contact')
        saved = self.client.post('/api/telemetry', json=packet).json()['saved']
        self.assertIsNone(measurement_quality.usable_value(saved, 'heartRate'))

    def test_link_is_connected_even_without_valid_sensor_values(self):
        self.client.post('/api/telemetry', json={"v": 2, "valid": 0, "source": "real",
            "bpm": 0, "spo2": 0, "finger": False, "device_id": "ESP32-BIO-01",
            "signalQuality": "sensor_unavailable", "sampleAgeMs": 86400000})
        self.assertTrue(database.get_latest_reading('ESP32-BIO-01')['device_connected'])
        self.assertFalse(database.get_latest_reading('ESP32-BIO-01')['heartRateValid'])
        database.save_reading({'session_id': 'ESP32-BIO-01', 'device_connected': False})
        self.assertFalse(database.get_latest_reading('ESP32-BIO-01')['device_connected'])

    def test_malformed_bodies_get_client_errors(self):
        for body in (b'', b'hola', b'[1, 2, 3]', b'"texto"', b'{"bpm": 70', b'\xff\xfe\x00'):
            r = self.client.post('/api/telemetry', content=body, headers={'Content-Type': 'application/json'})
            self.assertEqual(r.status_code, 422, body)
        r = self.client.post('/api/telemetry', content=b'{"x": "' + b'a' * 20000 + b'"}')
        self.assertEqual(r.status_code, 413)
        self.assertEqual(self.client.get('/api/status').status_code, 200)

    # --- Audio ---------------------------------------------------------------------------

    def start(self, body=None):
        r = self.client.post('/api/audio/start', json=body or {'device_id': 'ESP32-BIO-01', 'sample_rate': 16000})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['recording_id']

    def test_device_audio_without_source_counts_as_device(self):
        rec = database.get_recording(self.start())
        self.assertEqual(rec['source'], 'real')
        rec = database.get_recording(self.start({'device_id': 'emu', 'sample_rate': 16000, 'source': 'simulated'}))
        self.assertEqual(rec['source'], 'simulated')

    def test_arm_is_used_once_and_dropped_when_patient_changes(self):
        self.client.post('/api/audio/arm', json={'session_id': 'p017', 'location': 'MV'})
        rec = database.get_recording(self.start())
        self.assertEqual((rec['session_id'], rec['location']), ('p017', 'MV'))
        # Segunda presión sin preparar: sigue en el paciente enlazado, pero sin heredar el foco
        rec = database.get_recording(self.start())
        self.assertEqual((rec['session_id'], rec['location']), ('p017', ''))
        # Otro paciente: la preparación pendiente del anterior se descarta
        self.client.post('/api/audio/arm', json={'session_id': 'p017', 'location': 'AV'})
        self.client.post('/api/device/link', json={'session_id': 'p018'})
        rec = database.get_recording(self.start())
        self.assertEqual((rec['session_id'], rec['location']), ('p018', ''))
        # El pulso del firmware original también va al paciente recién enlazado
        self.assertEqual(self.send()['session_id'], 'p018')

    def test_audio_errors_are_client_errors(self):
        for body in ({'sample_rate': 0}, {'sample_rate': 'abc'}, {'sample_rate': 10 ** 9}, {'location': 'XX'},
                     {'location': 123}, {'source': 'marte'}):
            r = self.client.post('/api/audio/start', json={'device_id': 'ESP32', **body})
            self.assertIn(r.status_code, (400, 422), body)
        r = self.client.post('/api/audio/start', content=b'hola', headers={'Content-Type': 'application/json'})
        self.assertEqual(r.status_code, 422)
        rid = self.start()
        self.assertEqual(self.client.post(f'/api/audio/chunk?recording_id={rid}', content=b'\x00' * 3).status_code, 400)
        self.assertEqual(self.client.post(f'/api/audio/chunk?recording_id={rid}', content=b'\x00' * 600_000).status_code, 400)
        self.assertEqual(self.client.post('/api/audio/chunk?recording_id=no_existe', content=b'\x00\x00').status_code, 404)
        self.assertEqual(self.client.post('/api/audio/chunk', content=b'\x00\x00').status_code, 422)
        self.assertEqual(self.client.post('/api/audio/finish?recording_id=no_existe').status_code, 404)

    def test_empty_short_silent_and_repeated_finish_never_fail(self):
        signals = [np.zeros(0), np.zeros(16000 * 3), np.zeros(16000 * 10),
                   (0.1 * np.sin(np.arange(16000 * 2) * 0.2))]
        for samples in signals:
            rid = self.start()
            pcm = (np.asarray(samples) * 32767).astype('<i2').tobytes()
            for i in range(0, len(pcm), 16000):
                self.assertEqual(self.client.post(f'/api/audio/chunk?recording_id={rid}', content=pcm[i:i + 16000]).status_code, 200)
            r = self.client.post(f'/api/audio/finish?recording_id={rid}')
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(r.json()['result'], 'calidad_insuficiente')
            again = self.client.post(f'/api/audio/finish?recording_id={rid}')
            self.assertEqual(again.status_code, 200)
            self.assertEqual(again.json()['result'], 'calidad_insuficiente')
            self.assertTrue(again.json()['repetido'])
            self.assertEqual(self.client.post(f'/api/audio/chunk?recording_id={rid}', content=b'\x00\x00').status_code, 404)
        self.assertEqual(self.client.get('/api/status').status_code, 200)


if __name__ == '__main__':
    unittest.main()

class CompactV2Tests(unittest.TestCase):
    def test_compact_packet_preserves_mask_and_does_not_invent_age(self):
        packet, warnings = measurement_quality.clean_packet({
            'v': 2, 'valid': 0, 'bpm': 80, 'finger': True, 'cal': False, 'audio_unit': 'dBFS'})
        self.assertFalse(packet['legacy'])
        self.assertFalse(packet['heartRateValid'])
        self.assertFalse(packet['spo2Calibrated'])
        self.assertIsNone(packet['sampleAgeMs'])
        self.assertEqual(packet['audioUnit'], 'dBFS')

    def test_compact_test_packet_never_becomes_physical(self):
        packet, _ = measurement_quality.clean_packet({'v': 2, 'valid': 1, 'test': True})
        self.assertEqual(packet['source'], 'simulated')

    def test_explicit_metadata_takes_precedence_over_mask(self):
        packet, _ = measurement_quality.clean_packet({
            'v': 2, 'valid': 1, 'bpm': 80, 'finger': True,
            'heartRateValid': False, 'source': 'simulated', 'sampleAgeMs': 7})
        self.assertFalse(packet['heartRateValid'])
        self.assertEqual(packet['source'], 'simulated')
        self.assertEqual(packet['sampleAgeMs'], 7)
