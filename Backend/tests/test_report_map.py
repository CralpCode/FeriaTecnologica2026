"""El informe PDF lleva el mapa del torso; el intérprete de trazos acepta todo el dibujo compartido con la app."""
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
import report_body
import reports


class ReportMapTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        database.DB_PATH = str(Path(self.tmp.name) / 'test.db')
        database.init_db()
        p = patch.object(reports, 'REPORT_DIR', Path(self.tmp.name))
        p.start()
        self.addCleanup(p.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def test_every_shared_path_parses(self):
        art = report_body.load_art()
        self.assertIsNotNone(art, 'falta App Movil/src/components/body/bodyArt.json')
        paths = [art['silhouette'], *art['contours']]
        for group in (art['front'], art['back']):
            for v in group.values():
                paths += v if isinstance(v, list) and v and isinstance(v[0], str) else [v] if isinstance(v, str) else []
        for d in paths:
            report_body.svg_path(d)
        self.assertEqual(set(art['points']), set(report_body.HEART + report_body.LUNG))

    def pdf(self):
        content = {'resumen': 'r', 'hallazgos': [], 'recomendacion': 'x', 'datos': {}}
        return reports.build_session_pdf(1, 'p1', content, False)

    def test_pdf_with_and_without_recordings(self):
        self.assertGreater(self.pdf().stat().st_size, 2000)
        database.create_recording('a', 'p1', 'AV', 16000)
        database.update_recording('a', source='real', status='done', result='anormal', probability=0.9, threshold=0.8)
        database.create_recording('b', 'p1', 'PL', 16000)
        database.update_recording('b', source='real', status='done', result='normal', mode='pulmon', probability=0.1, threshold=0.5)
        self.assertGreater(self.pdf().stat().st_size, 2000)


if __name__ == '__main__':
    unittest.main()
