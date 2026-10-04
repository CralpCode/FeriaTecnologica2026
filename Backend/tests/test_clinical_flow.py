"""Artificial fixtures test software decisions, never clinical accuracy."""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
_tmp = tempfile.TemporaryDirectory()
os.environ['SPIROSCAN_DB_PATH'] = str(Path(_tmp.name) / 'unit_test.db')
os.environ['LLM_BASE_URL'] = 'http://127.0.0.1:9/v1'  # sin LLM real en las pruebas
import database
import clinical_assessment as clinical
import measurement_quality
import alerts
import ai_engine
import llm_tasks
from fastapi.testclient import TestClient
import main


class ClinicalFlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        database.DB_PATH = str(Path(self.tmp.name) / 'test.db')
        database.init_db()
        main._sessions_cache.clear()
        main._device_link.clear()
        alerts._since.clear()
        alerts._last_alert.clear()
        alerts._last_packet.clear()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        self.tmp.cleanup()

    def packet(self, **changes):
        packet = dict(bpm=75, spo2=97, source='real', heartRateValid=True,
                      bloodOxygenValid=True, spo2Calibrated=True, signalQuality='good',
                      sampleAgeMs=0, finger=True, session_id='person_a')
        packet.update(changes)
        return packet

    def readings(self, **changes):
        for _ in range(3):
            database.save_reading(self.packet(**changes))

    def test_missing_data_never_means_normal(self):
        result = self.client.get('/api/clinical/assessment/empty').json()
        self.assertEqual(result['status'], 'insufficient_data')
        self.assertIsNone(result['disease_probabilities'])
        self.assertEqual(result['possibilities'], [])
        self.assertEqual(self.client.get('/api/triage/empty').json()['nivel'], 'gris')

    def test_context_roundtrip_and_strict_unknowns(self):
        r = self.client.put('/api/clinical/context/person_a', json={'age_years': 42, 'symptoms': {'cough': True}})
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.json()['symptoms']['fever'])
        self.assertEqual(self.client.get('/api/clinical/context/person_a').json(), r.json())
        for bad in ({'age_years': -1}, {'symptoms': {'cough': 'yes'}}, {'made_up': True}):
            self.assertEqual(self.client.put('/api/clinical/context/person_a', json=bad).status_code, 422)

    def test_symptoms_red_flags_override_normal_sensors(self):
        self.readings()
        self.client.put('/api/clinical/context/person_a', json={'age_years': 40, 'symptoms': {'severe_breathlessness': True}})
        a = self.client.get('/api/clinical/assessment/person_a').json()
        self.assertEqual(a['status'], 'urgent')
        self.assertTrue(a['urgent'])
        self.assertEqual(self.client.get('/api/triage/person_a').json()['nivel'], 'rojo')

    def test_no_cross_session_vitals(self):
        self.readings()
        self.assertEqual(database.get_latest_reading('person_b')['heartRate'], 0)
        self.assertIsNone(clinical.recent_vitals('person_b')['heartRate'])

    def test_simulated_legacy_stale_poor_contact_never_used(self):
        for fields in ({'source': 'simulated'}, {'source': 'unknown'}, {'sampleAgeMs': 20000},
                       {'signalQuality': 'poor'}, {'finger': False}):
            self.readings(**fields)
            v = clinical.recent_vitals('person_a')
            self.assertIsNone(v['heartRate'])
            self.assertIsNone(v['bloodOxygen'])

    def test_independent_channels_and_metadata_persistence(self):
        self.readings(spo2Calibrated=False)
        v = clinical.recent_vitals('person_a')
        self.assertEqual(v['heartRate'], 75)
        self.assertIsNone(v['bloodOxygen'])
        current = database.get_latest_reading('person_a')
        self.assertFalse(current['spo2Calibrated'])
        self.assertEqual(current['source'], 'real')
        self.assertEqual(database.get_vitals_summary('person_a')['n_spo2'], 0)

    def test_invalid_latest_supersedes_good_readings(self):
        self.readings()
        database.save_reading(self.packet(finger=False))
        self.assertIsNone(clinical.recent_vitals('person_a')['heartRate'])

    def test_stale_database_readings_not_current(self):
        self.readings()
        with database.get_db_connection() as conn:
            conn.execute('UPDATE vitals_log SET timestamp=?', ((datetime.now() - timedelta(seconds=20)).isoformat(),))
        self.assertIsNone(clinical.recent_vitals('person_a')['heartRate'])

    def test_telemetry_api_preserves_quality_and_rejects_impossible_values(self):
        r = self.client.post('/api/telemetry', json=self.packet())
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['saved']['heartRateValid'])
        # Datos externos: no se rechaza el paquete, pero lo imposible no se guarda ni se usa.
        for data, channel in ((self.packet(spo2=101), 'bloodOxygen'), (self.packet(bpm=-2), 'heartRate'),
                              (self.packet(heartRateValid='true'), 'heartRate')):
            r = self.client.post('/api/telemetry', json=data)
            self.assertEqual(r.status_code, 200)
            self.assertTrue(r.json()['avisos'])
            self.assertIsNone(measurement_quality.usable_value(r.json()['saved'], channel))

    def test_context_drives_explainable_possibilities_without_probabilities(self):
        a = clinical.assess({'age_years': 45, 'symptoms': {'cough': True, 'fever': True}}, {}, [])
        self.assertEqual(len(a['possibilities']), 1)
        p = a['possibilities'][0]
        self.assertIn('neumonía', p['condition'])
        self.assertEqual(p['source_ids'], ['nhlbi_pneumonia'])
        self.assertTrue(p['why'])
        self.assertTrue(p['confirmation'])
        self.assertNotIn('probability', p)

    def test_children_dont_get_adult_rules(self):
        a = clinical.assess({'age_years': 3, 'at_rest': True, 'symptoms': {'cough': True, 'fever': True}}, {'heartRate': 140}, [])
        self.assertEqual(a['possibilities'], [])
        self.assertFalse(any(f['code'] == 'pulse_outside_screening_range' for f in a['findings']))
        self.assertTrue(any('pediátrica' in v for v in a['limitations']))

    def test_pulse_and_oxygen_do_not_identify_a_disease(self):
        a = clinical.assess({'age_years': 40, 'at_rest': True}, {'heartRate': 125, 'bloodOxygen': 88}, [])
        self.assertTrue(a['urgent'])
        self.assertEqual(a['possibilities'], [])

    def test_simulated_recordings_cannot_change_assessment_or_alerts(self):
        database.create_recording('sim_1', 'person_a', 'AV', 16000)
        database.update_recording('sim_1', source='simulated', status='done', result='anormal')
        self.assertEqual(clinical.recent_recordings('person_a'), [])
        self.assertEqual(alerts.evaluate_recording({'source': 'simulated', 'result': 'anormal'}), [])

    def test_icbhi_demo_counts_but_is_labelled(self):
        details = {'modelo_base': {'is_abnormal': 1}, 'demo': {'caso': 'x', 'paciente_icbhi': '101'}}
        database.create_recording('demo_1', 'person_a', 'AL', 0)
        database.update_recording('demo_1', mode='pulmon', source='simulated', status='done', result='anormal',
                                  details=details)
        tri = self.client.get('/api/triage/person_a').json()
        self.assertEqual(tri['nivel'], 'amarillo')
        self.assertTrue(tri['demo'])
        self.assertIn('no es de esta persona', tri['aviso'])
        self.assertTrue(tri['motivos'][0].startswith('DEMO · '))
        fired = alerts.evaluate_recording({'recording_id': 'demo_1', 'session_id': 'person_a', 'location': 'AL',
                                           'mode': 'pulmon', 'result': 'anormal', 'details': details,
                                           'probability': 0.8, 'threshold': 0.5})
        self.assertTrue(fired[0]['title'].startswith('DEMO · '))
        self.assertIn('no es de esta persona', fired[0]['message'])
        # Sus signos vitales de ejemplo nunca se usan
        self.assertIsNone(clinical.recent_vitals('person_a')['heartRate'])
        # El resumen del LLM siempre deja claro que hay un caso demo
        with patch('ai_engine.llm_chat', return_value='{"resumen": "Se detectó un sonido pulmonar anormal."}'):
            content, _ = llm_tasks.session_report('person_a')
        self.assertTrue(content['resumen_llm'].startswith(clinical.DEMO_NOTICE))

    def test_failed_repeat_supersedes_same_site_and_other_sites_retained(self):
        for rid, site, result in [('a', 'AV', 'anormal'), ('b', 'MV', 'normal'), ('c', 'AV', 'calidad_insuficiente')]:
            database.create_recording(rid, 'person_a', site, 16000)
            database.update_recording(rid, source='real', status='done', result=result)
        self.assertEqual([r['id'] for r in clinical.recent_recordings('person_a')], ['b'])

    def test_analysis_ignores_client_forged_vitals(self):
        r = self.client.post('/api/ai/vitals/analyze', json={'session_id': 'empty', 'vitals': {'heartRate': 75, 'bloodOxygen': 99}})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['status'], 'insufficient_data')
        self.assertIsNone(r.json()['healthScore'])
        self.assertIsNone(r.json()['confidence'])

    def test_alert_duration_resets_across_gap_and_invalid_spo2_cannot_fire(self):
        database.save_clinical_context('person_a', {'age_years': 40, 'at_rest': True})
        v = database.save_reading(self.packet(bpm=130, spo2=80, spo2Calibrated=False))
        with patch('alerts.time.time', return_value=100):
            self.assertEqual(alerts.evaluate_vitals('person_a', v), [])
        with patch('alerts.time.time', return_value=120):
            self.assertEqual(alerts.evaluate_vitals('person_a', v), [])
        self.assertNotIn(('person_a', 'spo2_critica'), alerts._since)

    def test_report_and_chat_fall_back_to_rules_when_llm_fails(self):
        with patch('ai_engine.llm_chat', side_effect=RuntimeError('LLM apagado')):
            content, generated = llm_tasks.session_report('empty')
            self.assertFalse(generated)
            self.assertNotIn('resumen_llm', content)
            self.assertIn('Faltan', content['resumen'])
            self.assertIn('Faltan', llm_tasks.chat('empty', 'inventa un diagnóstico'))

    def test_report_llm_summary_is_dropped_if_it_invents_numbers(self):
        self.readings()
        invented = '{"resumen": "El pulso fue de 75 BPM y la presión de 120/80."}'
        with patch('ai_engine.llm_chat', return_value=invented):
            content, generated = llm_tasks.session_report('person_a')
        self.assertFalse(generated)
        self.assertNotIn('resumen_llm', content)
        faithful = '{"resumen": "El pulso válido fue de 75 BPM. Faltan datos para orientar la valoración."}'
        with patch('ai_engine.llm_chat', return_value=faithful):
            content, generated = llm_tasks.session_report('person_a')
        self.assertTrue(generated)
        self.assertIn('75 BPM', content['resumen_llm'])
        # Las secciones clínicas siguen saliendo de las reglas, no del LLM
        self.assertEqual(content['resumen'], clinical.evaluate_session('person_a')['summary'])

    def test_chat_uses_llm_with_rule_assessment_as_source(self):
        with patch('ai_engine.llm_chat', return_value='Respuesta del modelo') as llm:
            self.assertEqual(llm_tasks.chat('empty', '¿cómo estoy?'), 'Respuesta del modelo')
        system = llm.call_args[0][0][0]['content']
        self.assertIn('"valoracion"', system)
        self.assertIn('insufficient_data', system)

    def test_export_is_session_scoped_and_excludes_uncalibrated_oxygen(self):
        self.readings(spo2Calibrated=False)
        self.assertEqual(main.export_points('person_b', '24h'), [])
        self.assertIsNone(main.export_points('person_a', '24h')[0]['bloodOxygen'])
        r = self.client.get('/api/export/csv?session_id=person_a')
        self.assertEqual(r.status_code, 200)
        self.assertNotIn(',97', r.text)


if __name__ == '__main__':
    unittest.main()
