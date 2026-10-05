"""Archivar una sesión solo la oculta de las listas: nunca borra ni cambia sus datos."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
_tmp = tempfile.TemporaryDirectory()
os.environ['SPIROSCAN_DB_PATH'] = str(Path(_tmp.name) / 'unit_test.db')
os.environ['LLM_BASE_URL'] = 'http://127.0.0.1:9/v1'  # sin LLM real en las pruebas
import database
from fastapi.testclient import TestClient
import main


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        database.DB_PATH = str(Path(self.tmp.name) / 'test.db')
        database.init_db()
        main._sessions_cache.clear()
        self.client = TestClient(main.app)
        # Dos pacientes con datos: un informe y un contexto clínico
        database.save_report('p001', {'resumen': 'x', 'hallazgos': [], 'recomendacion': 'y'}, False, None)
        database.save_clinical_context('p002', {'age_years': 40})

    def tearDown(self):
        self.client.close()
        self.tmp.cleanup()

    def ids(self, **params):
        return {r['session_id'] for r in self.client.get('/api/history', params=params).json()}

    def test_archive_hides_and_unarchive_restores(self):
        self.assertIn('p001', self.ids())
        r = self.client.post('/api/sessions/p001/archive')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['archived'])
        self.assertNotIn('p001', self.ids())
        self.assertIn('p001', self.ids(archived='true'))
        self.client.post('/api/sessions/p001/unarchive')
        self.assertIn('p001', self.ids())
        self.assertNotIn('p001', self.ids(archived='true'))

    def test_archive_keeps_every_record(self):
        self.client.post('/api/sessions/p001/archive')
        self.client.post('/api/sessions/p002/archive')
        self.assertEqual(len(database.list_reports('p001')), 1)
        self.assertEqual(database.get_clinical_context('p002'), {'age_years': 40})
        self.assertEqual(self.client.get('/api/clinical/context/p002').status_code, 200)

    def test_archived_sessions_leave_session_list(self):
        database.save_reading({'bpm': 70, 'source': 'real', 'session_id': 'p003'})
        self.assertIn('p003', {s['session_id'] for s in self.client.get('/api/sessions').json()})
        self.client.post('/api/sessions/p003/archive')
        self.assertNotIn('p003', {s['session_id'] for s in self.client.get('/api/sessions').json()})

    def test_unknown_session_is_404_and_archiving_twice_is_harmless(self):
        self.assertEqual(self.client.post('/api/sessions/nadie/archive').status_code, 404)
        self.assertEqual(self.client.post('/api/sessions/nadie/unarchive').status_code, 404)
        self.assertEqual(self.client.post('/api/sessions/p001/archive').status_code, 200)
        self.assertEqual(self.client.post('/api/sessions/p001/archive').status_code, 200)
        self.assertEqual(self.ids(archived='true'), {'p001'})


if __name__ == '__main__':
    unittest.main()
