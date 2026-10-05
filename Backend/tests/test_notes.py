"""Notas del médico: se guardan con el contexto, van al informe y nunca llegan a las reglas ni al modelo de lenguaje."""
import json
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
import llm_tasks
import reports

NOTE = 'Paciente refiere palpitaciones nocturnas desde hace 2 semanas.'


class NotesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        database.DB_PATH = str(Path(self.tmp.name) / 'test.db')
        database.init_db()
        patcher = patch.object(reports, 'REPORT_DIR', Path(self.tmp.name))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        self.tmp.cleanup()

    def test_roundtrip_and_limit(self):
        r = self.client.put('/api/clinical/context/p001', json={'age_years': 40, 'notes': NOTE})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.get('/api/clinical/context/p001').json()['notes'], NOTE)
        self.assertEqual(self.client.put('/api/clinical/context/p001', json={'notes': 'x' * 2001}).status_code, 422)

    def test_notes_never_reach_rules_or_llm(self):
        self.client.put('/api/clinical/context/p001', json={'age_years': 40, 'notes': NOTE})
        assessment = self.client.get('/api/clinical/assessment/p001').json()
        self.assertNotIn('notes', assessment['context'])
        self.assertNotIn('palpitaciones', json.dumps(llm_tasks._session_context('p001'), ensure_ascii=False, default=str))

    def test_notes_go_to_pdf(self):
        self.client.put('/api/clinical/context/p001', json={'notes': NOTE})
        content = {'resumen': 'r', 'hallazgos': [], 'recomendacion': 'x', 'datos': {}}
        path = reports.build_session_pdf(1, 'p001', content, False)
        self.assertTrue(path.exists() and path.stat().st_size > 1000)


if __name__ == '__main__':
    unittest.main()
