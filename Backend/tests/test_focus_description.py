"""Descripción por foco: orientativa, solo con el foco y el resultado (no con la caracterización del soplo)."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('SPIROSCAN_DB_PATH', str(Path(tempfile.mkdtemp()) / 'unit_test.db'))
os.environ['LLM_BASE_URL'] = 'http://127.0.0.1:9/v1'
import database
import clinical_assessment as clinical


class FocusDescriptionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        database.DB_PATH = str(Path(self.tmp.name) / 'test.db')
        database.init_db()

    def tearDown(self):
        self.tmp.cleanup()

    def record(self, rid, site, result, mode='corazon', source='real'):
        database.create_recording(rid, 'p1', site, 16000)
        database.update_recording(rid, source=source, status='done', result=result, mode=mode)

    def why(self):
        a = clinical.evaluate_session('p1')
        heart = [p for p in a['possibilities'] if p['condition'].startswith('Soplo a evaluar')]
        return (heart[0]['why'], heart[0]['source_ids']) if heart else ([], [])

    def test_aortic_focus_names_the_aortic_valve(self):
        self.record('a', 'AV', 'anormal')
        self.record('b', 'MV', 'normal')
        why, refs = self.why()
        text = ' '.join(why)
        self.assertIn('foco aórtico (AV)', text)
        self.assertIn('válvula aórtica', text)
        self.assertIn('Solo en 1 de 2 focos grabados', text)
        self.assertIn('Focos sin grabar: PV, TV.', text)
        self.assertIn('no identifica qué válvula', text)
        self.assertIn('circor_sites', refs)
        self.assertIn('circor_sites', {s['id'] for s in clinical.SOURCES})

    def test_several_foci_suggest_repeating(self):
        for rid, site in (('a', 'AV'), ('b', 'PV'), ('c', 'MV')):
            self.record(rid, site, 'anormal')
        text = ' '.join(self.why()[0])
        self.assertIn('En 3 de 3 focos grabados', text)
        self.assertIn('conviene repetir', text)

    def test_normal_or_lung_only_produces_nothing(self):
        self.record('a', 'AV', 'normal')
        self.record('b', 'AL', 'anormal', mode='pulmon')
        self.assertEqual(self.why()[0], [])


if __name__ == '__main__':
    unittest.main()
