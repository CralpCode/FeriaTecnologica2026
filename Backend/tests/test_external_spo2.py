"""External/manual oxygen never becomes calibrated ESP32 telemetry."""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('SPIROSCAN_DB_PATH', str(Path(tempfile.mkdtemp()) / 'test.db'))
os.environ['LLM_BASE_URL'] = 'http://127.0.0.1:9/v1'
import database
import main
import llm_tasks
import reports
from fastapi.testclient import TestClient


class ExternalSpO2Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        database.DB_PATH = str(Path(self.tmp.name) / 'test.db')
        database.init_db()
        self.client = TestClient(main.app)
        self.url = '/api/clinical/external-spo2/p001'

    def tearDown(self):
        self.client.close()
        self.tmp.cleanup()

    def save(self, value=95):
        result = self.client.post(self.url, json={'value': value, 'device_name': 'Oxímetro de referencia'})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()['reading']

    def test_roundtrip_isolated_provenance_and_telemetry_cannot_replace_manual(self):
        reading = self.save()
        self.assertEqual(reading['source'], 'manual_external')
        self.assertTrue(reading['active'])
        self.assertEqual(self.client.get('/api/clinical/external-spo2/p002').json(), {'reading': None})
        self.client.put('/api/clinical/context/p001', json={'age_years': 40, 'notes': 'Context updated'})
        self.client.post('/api/telemetry', json={'session_id': 'p001', 'v': 2, 'valid': 3, 'cal': False,
                         'source': 'real', 'finger': True, 'bpm': 78, 'spo2': 81, 'sampleAgeMs': 0})
        self.assertEqual(self.client.get(self.url).json()['reading']['value'], 95)
        assessment = self.client.get('/api/clinical/assessment/p001').json()
        self.assertEqual(assessment['vitals_used']['bloodOxygen'], 95)
        self.assertEqual(assessment['vitals_used']['bloodOxygenSource'], 'manual_external')
        sensor = database.get_latest_reading(session_id='p001')
        self.assertFalse(sensor['spo2Calibrated'])
        self.assertEqual(sensor['bloodOxygen'], 81)
        used = self.client.get('/api/triage/p001').json()['datos_usados']['vitales_ultimo_minuto']
        self.assertEqual(used['spo2_origen'], 'manual_external')

    def test_invalid_input_has_no_write_or_invented_measurement(self):
        for value in [True, False, None, '', '95', 0, -1, 101]:
            self.assertEqual(self.client.post(self.url, json={'value': value}).status_code, 422)
        for extra in [{'source': 'real'}, {'measured_at': '2099-01-01'}, {'spo2Calibrated': True}]:
            self.assertEqual(self.client.post(self.url, json={'value': 95, **extra}).status_code, 422)
        self.assertEqual(self.client.post(self.url, content='{"value":NaN}', headers={'Content-Type': 'application/json'}).status_code, 422)
        self.assertEqual(self.client.post(self.url, json={'value': 95, 'device_name': ' '}).status_code, 422)
        self.assertEqual(self.client.get(self.url).json(), {'reading': None})

    def test_expiration_update_and_withdrawal_preserve_audit_history(self):
        self.save(96)
        old = (datetime.now(timezone.utc) - timedelta(minutes=16)).isoformat()
        conn = database.get_db_connection()
        with conn:
            conn.execute('UPDATE external_spo2 SET measured_at = ?', (old,))
        conn.close()
        self.assertFalse(self.client.get(self.url).json()['reading']['active'])
        self.assertIsNone(self.client.get('/api/clinical/assessment/p001').json()['vitals_used']['bloodOxygen'])
        self.assertEqual(self.save(95)['value'], 95)
        self.assertEqual(self.client.delete(self.url).json(), {'reading': None})
        self.assertIsNone(self.client.get('/api/clinical/assessment/p001').json()['vitals_used']['bloodOxygen'])
        conn = database.get_db_connection()
        rows = conn.execute('SELECT value FROM external_spo2 ORDER BY id').fetchall()
        conn.close()
        self.assertEqual([r['value'] for r in rows], [96, 95, None])

    def test_manual_only_patient_history_and_archiving(self):
        self.save()
        row = next(r for r in database.get_sessions_overview() if r['session_id'] == 'p001')
        self.assertEqual(row['external_readings'], 1)
        self.assertEqual(row['readings'], 0)
        self.assertEqual(self.client.post('/api/sessions/p001/archive').status_code, 200)
        self.assertEqual(database.get_sessions_overview(), [])
        self.assertEqual(self.client.get(self.url).json()['reading']['value'], 95)

    def test_llm_fallback_and_pdf_receive_explicit_external_origin(self):
        self.save()
        with patch.object(llm_tasks.ai_engine, 'llm_chat', return_value='Datos recibidos.') as llm:
            llm_tasks.chat('p001', '¿Cuál es mi oxígeno?')
        system = llm.call_args.args[0][0]['content']
        context = json.loads(system.split('DATOS DE LA SESIÓN (fuente única de verdad):\n')[1])
        self.assertEqual(context['oximetria_externa']['value'], 95)
        self.assertEqual(context['oximetria_externa']['source'], 'manual_external')
        self.assertEqual(context['valoracion']['vitals_used']['bloodOxygen'], 95)
        with patch.object(llm_tasks.ai_engine, 'llm_chat', side_effect=RuntimeError('offline')):
            self.assertIn('SpO2 externa: 95 %', llm_tasks.chat('p001', 'Oxígeno'))
        with patch.object(reports, 'REPORT_DIR', Path(self.tmp.name)), patch.object(reports, 'Paragraph', wraps=reports.Paragraph) as paragraph:
            path = reports.build_session_pdf(1, 'p001', {'resumen': 'r', 'hallazgos': [], 'recomendacion': 'x', 'datos': {}}, False)
        self.assertGreater(path.stat().st_size, 1000)
        text = '\n'.join(str(call.args[0]) for call in paragraph.call_args_list)
        self.assertIn('95 %', text)
        self.assertIn('ingreso manual', text)


if __name__ == '__main__':
    unittest.main()
