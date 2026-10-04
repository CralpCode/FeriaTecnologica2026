"""Regression coverage for the merge: actual v2 wire shape, synthetic fixtures only."""
import unittest
import json
from datetime import datetime

import test_esp32_inputs as fixtures
import database
import measurement_quality


class IntegratedTelemetryTests(unittest.TestCase):
    setUp = fixtures.Esp32InputTests.setUp
    tearDown = fixtures.Esp32InputTests.tearDown

    def send_v2(self, **changes):
        packet = {
            'v': 2, 'valid': 31, 'bpm': 72, 'spo2': 97.5, 'hrv': 0,
            'chip_temp': 29.5, 'temperature': 29.5, 'systolic': 118, 'diastolic': 76,
            'stress': 25, 'audio_rms': -42.0, 'audio_peak': 0.1, 'audio_unit': 'dBFS',
            'finger': True, 'scan_mode': 'continuous', 'scan_sec': 3,
            'scan_phase': 'measuring', 'cardiac_locked': True, 'power': 'active',
            'cal': False, 'session_id': 'merge-patient',
        }
        packet.update(changes)
        response = self.client.post('/api/telemetry', json=packet)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['saved']

    def test_v2_survives_storage_history_and_clinical_checks(self):
        for _ in range(3):
            saved = self.send_v2()
        self.assertEqual(saved['heartRate'], 72)
        self.assertTrue(saved['heartRateValid'])
        self.assertEqual(saved['bloodOxygen'], 97.5)
        self.assertEqual(saved['provenance']['bloodOxygen'], 'estimated')
        self.assertFalse(saved['spo2Calibrated'])
        self.assertIsNone(measurement_quality.usable_value(saved, 'bloodOxygen'))
        self.assertEqual(measurement_quality.usable_value(saved, 'heartRate'), 72)
        self.assertTrue(saved['validity']['hrv'])  # Real zero RMSSD must survive.
        self.assertEqual(saved['chipTemperature'], 29.5)
        self.assertEqual(saved['audio_rms'], -42)
        self.assertTrue(saved['validity']['audio_peak'])
        for key in ('temperature', 'systolicPressure', 'diastolicPressure', 'stressLevel'):
            self.assertEqual(saved[key], 0)
            self.assertFalse(saved['validity'][key])
        current = self.client.get('/api/vitals/current?session_id=merge-patient').json()
        self.assertEqual(current['scan_mode'], 'continuous')
        history = database.get_history_points(session_id='merge-patient')
        self.assertTrue(history[-1]['heartRateValid'])
        self.assertEqual(history[-1]['chipTemperature'], 29.5)
        self.assertEqual(database.get_vitals_summary('merge-patient')['n_spo2'], 0)

    def test_invalid_or_standby_v2_never_becomes_a_legacy_measurement(self):
        for changes in ({'valid': 0}, {'valid': None}, {'valid': True}, {'power': 'standby'},
                        {'test': True}, {'finger': False}):
            with self.subTest(changes=changes):
                saved = self.send_v2(**changes)
                self.assertEqual(saved['heartRate'], 0)
                self.assertFalse(saved['heartRateValid'])
                self.assertIsNone(measurement_quality.usable_value(saved, 'heartRate'))

    def test_channels_do_not_depend_on_an_available_pulse_number(self):
        saved = self.send_v2(valid=6, bpm=0, hrv=40, cal=True)
        self.assertEqual(saved['heartRate'], 0)
        self.assertFalse(saved['heartRateValid'])
        self.assertEqual(saved['hrv'], 40)
        self.assertTrue(saved['validity']['hrv'])
        self.assertEqual(measurement_quality.usable_value(saved, 'bloodOxygen'), 97.5)
        self.assertFalse(self.send_v2(cal=False, spo2Calibrated=True)['spo2Calibrated'])
        pulse = self.send_v2(valid=1, finger=None, source='ble_hr')
        self.assertIsNone(pulse['finger'])
        self.assertEqual(measurement_quality.usable_value(pulse, 'heartRate'), 72)

    def test_v2_sessions_and_pulmonary_compatibility_route(self):
        self.send_v2()
        empty = self.client.get('/api/vitals/current?session_id=another-patient').json()
        self.assertEqual(empty['heartRate'], 0)
        report = self.client.post('/api/ai/pulmonary/analyze', json={'session_id': 'another-patient'}).json()
        self.assertEqual(report['status'], 'insufficient_data')
        self.assertIsNone(report['confidence'])
        self.assertIsNone(report['healthScore'])

    def test_existing_main_metadata_is_preserved_without_reviving_unsupported_values(self):
        conn = database.get_db_connection()
        try:
            with conn:
                conn.execute("ALTER TABLE vitals_log ADD COLUMN metadata_json TEXT DEFAULT '{}'")
                conn.execute(
                    "INSERT INTO vitals_log (timestamp, heartRate, bloodOxygen, temperature, device_id, metadata_json) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (datetime.now().isoformat(), 72, 97.5, 36.6, 'previous-main', json.dumps({
                        'v': 2, 'valid': 15, 'cal': False, 'finger': True, 'source': 'esp32',
                        'power': 'active', 'scan_mode': 'cardiac', 'chipTemperature': 29.5,
                        'validity': {'heartRate': True, 'bloodOxygen': True, 'hrv': True, 'chipTemperature': True},
                    })),
                )
        finally:
            conn.close()
        database.init_db()
        current = database.get_latest_reading('previous-main')
        self.assertEqual(current['heartRate'], 72)
        self.assertTrue(current['heartRateValid'])
        self.assertEqual(current['chipTemperature'], 29.5)
        self.assertEqual(current['scan_mode'], 'cardiac')
        self.assertEqual(current['temperature'], 0)
        self.assertFalse(current['spo2Calibrated'])
        self.assertEqual(database.get_history_points(session_id='previous-main')[0]['heartRate'], 72)


if __name__ == '__main__':
    unittest.main()
