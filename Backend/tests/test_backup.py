"""El respaldo copia la base y refleja grabaciones e informes sin borrar nada."""
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('SPIROSCAN_DB_PATH', str(Path(tempfile.mkdtemp()) / 'unit_test.db'))
os.environ['LLM_BASE_URL'] = 'http://127.0.0.1:9/v1'
import database
import backup


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        database.DB_PATH = str(root / 'test.db')
        database.init_db()
        database.save_clinical_context('p001', {'age_years': 50})
        self.rec, self.rep, self.dest = root / 'recordings', root / 'reports', root / 'respaldos'
        self.rec.mkdir(); self.rep.mkdir()
        (self.rec / 'a.wav').write_bytes(b'RIFF1234')

    def tearDown(self):
        self.tmp.cleanup()

    def run_backup(self, keep=48):
        return backup.run_backup(self.dest, keep=keep, folders=[self.rec, self.rep])

    def test_snapshot_opens_and_has_data(self):
        info = self.run_backup()
        snap = self.dest / 'db' / info['base']
        con = sqlite3.connect(snap)
        row = con.execute("SELECT content FROM clinical_context WHERE session_id = 'p001'").fetchone()
        con.close()
        self.assertIn('50', row[0])
        self.assertTrue((self.dest / 'ultimo_respaldo.json').exists())
        self.assertEqual(backup.status()['error'], None)

    def test_rotation_keeps_last_copies(self):
        (self.dest / 'db').mkdir(parents=True)
        for i in range(5):  # copias viejas
            f = self.dest / 'db' / f'telemetry_2020010{i}_000000.db'
            f.write_bytes(b'x')
            os.utime(f, (1_600_000_000 + i, 1_600_000_000 + i))
        info = self.run_backup(keep=2)
        left = sorted(f.name for f in (self.dest / 'db').glob('telemetry_*.db'))
        self.assertEqual(len(left), 2)
        self.assertIn(info['base'], left)                       # la nueva se conserva
        self.assertIn('telemetry_20200104_000000.db', left)     # y la más reciente de las viejas

    def test_recordings_are_only_added(self):
        self.run_backup()
        (self.rec / 'a.wav').unlink()          # borrar en el servidor no borra el respaldo
        (self.rec / 'b.wav').write_bytes(b'RIFF5678')
        info = self.run_backup()
        self.assertTrue((self.dest / 'recordings' / 'a.wav').exists())
        self.assertTrue((self.dest / 'recordings' / 'b.wav').exists())
        self.assertEqual(info['archivos_copiados']['recordings'], 1)

    def test_interval_zero_disables(self):
        old = os.environ.get('SPIROSCAN_BACKUP_MIN')
        os.environ['SPIROSCAN_BACKUP_MIN'] = '0'
        try:
            self.assertFalse(backup.status()['activo'])
        finally:
            if old is None:
                os.environ.pop('SPIROSCAN_BACKUP_MIN')
            else:
                os.environ['SPIROSCAN_BACKUP_MIN'] = old


if __name__ == '__main__':
    unittest.main()
