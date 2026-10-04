import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useVitals } from '../context/VitalsContext';
import { apiService } from '../services/api';
import { ClinicalAssessment, PatientContext } from '../types/vitals';
import { Colors } from '../theme/colors';

const SYMPTOMS: [keyof PatientContext['symptoms'], string][] = [
  ['severe_breathlessness', 'Falta de aire intensa o dificultad para hablar'],
  ['chest_pain', 'Dolor en el pecho'], ['syncope', 'Desmayo'],
  ['cyanosis', 'Labios o cara azulados'], ['confusion', 'Confusión nueva'],
  ['dyspnea', 'Falta de aire'], ['cough', 'Tos'], ['fever', 'Fiebre'],
  ['wheeze', 'Silbidos al respirar'], ['orthopnea', 'Falta de aire al acostarte'],
  ['edema', 'Hinchazón de piernas o tobillos'],
];
const HISTORY: [keyof PatientContext['history'], string][] = [
  ['asthma', 'Asma diagnosticada'], ['copd', 'EPOC diagnosticada'], ['smoking', 'Tabaquismo actual o previo'],
];
const emptyContext = (): PatientContext => ({
  age_years: null, at_rest: null, altitude_m: null,
  symptoms: Object.fromEntries(SYMPTOMS.map(([key]) => [key, null])) as PatientContext['symptoms'],
  history: { asthma: null, copd: null, smoking: null },
});

export const ClinicalAssessmentPanel: React.FC = () => {
  const { currentSessionId, backendUrl } = useVitals();
  const [context, setContext] = useState<PatientContext>(emptyContext);
  const [age, setAge] = useState('');
  const [altitude, setAltitude] = useState('');
  const [assessment, setAssessment] = useState<ClinicalAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const requestGeneration = useRef(0);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    setContext(emptyContext());
    setAge(''); setAltitude(''); setAssessment(null); setError(null);
    setLoading(true); setLoaded(false); setSaving(false);
    apiService.getPatientContext(currentSessionId).then((saved) => {
      if (generation !== requestGeneration.current) return;
      const blank = emptyContext();
      setContext({ ...blank, ...saved, symptoms: { ...blank.symptoms, ...saved.symptoms }, history: { ...blank.history, ...saved.history } });
      setAge(saved.age_years == null ? '' : String(saved.age_years));
      setAltitude(saved.altitude_m == null ? '' : String(saved.altitude_m));
      setLoaded(true);
    }).catch((err) => {
      if (generation === requestGeneration.current) setError(`No se pudo cargar el contexto de esta sesión: ${err.message}`);
    }).finally(() => {
      if (generation === requestGeneration.current) setLoading(false);
    });
    return () => { requestGeneration.current++; };
  }, [currentSessionId, backendUrl, reload]);

  const edit = (next: PatientContext) => { setContext(next); setAssessment(null); };
  const evaluate = async () => {
    const ageValue = age.trim() === '' ? null : Number(age);
    const altitudeValue = altitude.trim() === '' ? null : Number(altitude);
    if (ageValue !== null && (!Number.isFinite(ageValue) || ageValue < 0 || ageValue > 120)) {
      setError('Ingresa una edad entre 0 y 120 años o deja el campo vacío si no la conoces.'); return;
    }
    if (altitudeValue !== null && (!Number.isFinite(altitudeValue) || altitudeValue < -500 || altitudeValue > 9000)) {
      setError('Ingresa una altitud entre −500 y 9000 metros o deja el campo vacío.'); return;
    }
    const generation = requestGeneration.current;
    const session = currentSessionId;
    setSaving(true); setError(null); setAssessment(null);
    try {
      await apiService.savePatientContext(session, { ...context, age_years: ageValue, altitude_m: altitudeValue });
      const result = await apiService.getClinicalAssessment(session);
      if (generation === requestGeneration.current) setAssessment(result);
    } catch (err: any) {
      if (generation === requestGeneration.current) setError(`No se pudo completar la valoración: ${err.message}`);
    } finally {
      if (generation === requestGeneration.current) setSaving(false);
    }
  };

  const hasDangerSymptom = ['severe_breathlessness', 'chest_pain', 'syncope', 'cyanosis', 'confusion']
    .some((key) => context.symptoms[key as keyof PatientContext['symptoms']] === true);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Valoración orientativa de esta sesión</Text>
      <Text style={styles.note}>Combina síntomas declarados, mediciones válidas y grabaciones reales. No identifica una enfermedad con certeza. “No sé” conserva el dato como desconocido.</Text>
      {loading ? <ActivityIndicator color={Colors.primary} /> : loaded && (
        <>
          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={styles.label}>Edad (años)</Text>
              <TextInput accessibilityLabel="Edad en años" style={styles.input} keyboardType="decimal-pad" value={age} editable={!saving}
                placeholder="Desconocida" onChangeText={(value) => { setAge(value); setAssessment(null); }} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Altitud (m, opcional)</Text>
              <TextInput accessibilityLabel="Altitud en metros" style={styles.input} keyboardType="numbers-and-punctuation" value={altitude} editable={!saving}
                placeholder="Desconocida" onChangeText={(value) => { setAltitude(value); setAssessment(null); }} />
            </View>
          </View>
          <Choice label="¿Medición en reposo?" value={context.at_rest} disabled={saving} onChange={(at_rest) => edit({ ...context, at_rest })} />
          <Text style={styles.subtitle}>Síntomas actuales</Text>
          {SYMPTOMS.map(([key, label]) => (
            <Choice key={key} label={label} value={context.symptoms[key]} disabled={saving}
              onChange={(value) => edit({ ...context, symptoms: { ...context.symptoms, [key]: value } })} />
          ))}
          {hasDangerSymptom && <Text accessibilityRole="alert" style={styles.urgent}>Los síntomas de alarma requieren atención médica inmediata. No esperes a completar la evaluación automática.</Text>}
          <Text style={styles.subtitle}>Antecedentes</Text>
          {HISTORY.map(([key, label]) => (
            <Choice key={key} label={label} value={context.history[key]} disabled={saving}
              onChange={(value) => edit({ ...context, history: { ...context.history, [key]: value } })} />
          ))}
          <TouchableOpacity accessibilityRole="button" style={[styles.button, saving && { opacity: 0.6 }]} disabled={saving} onPress={evaluate}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Guardar y evaluar esta sesión</Text>}
          </TouchableOpacity>
        </>
      )}
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!loading && !loaded && <TouchableOpacity accessibilityRole="button" onPress={() => setReload((n) => n + 1)}><Text style={styles.link}>Reintentar conexión</Text></TouchableOpacity>}
      {assessment && (
        <View style={styles.result}>
          <Text accessibilityRole={assessment.urgent ? 'alert' : undefined} style={assessment.urgent ? styles.urgent : styles.subtitle}>{assessment.summary}</Text>
          {assessment.findings.map((finding, index) => <View key={`${finding.code}-${index}`} style={styles.item}>
            <Text style={styles.label}>{finding.label}</Text>
            {finding.evidence.map((line, i) => <Text key={i} style={styles.note}>• {line}</Text>)}
          </View>)}
          {assessment.possibilities.length > 0 && <Text style={styles.subtitle}>Posibilidades para revisar con un profesional</Text>}
          {assessment.possibilities.map((possibility, i) => <View key={i} style={styles.item}>
            <Text style={styles.label}>{possibility.condition}</Text>
            {possibility.why.map((line, j) => <Text key={`why-${j}`} style={styles.note}>• {line}</Text>)}
            {possibility.confirmation.map((line, j) => <Text key={`confirm-${j}`} style={styles.note}>Para confirmar: {line}</Text>)}
          </View>)}
          <Lines title="Datos que faltan" lines={assessment.missing_data} />
          <Lines title="Próximos pasos" lines={assessment.next_steps} />
          <Lines title="Límites de esta valoración" lines={assessment.limitations} />
          {assessment.sources.length > 0 && <Text style={styles.subtitle}>Fuentes</Text>}
          {assessment.sources.filter((source) => /^https:\/\//i.test(source.url)).map((source) => (
            <TouchableOpacity key={source.id} accessibilityRole="link" onPress={() => Linking.openURL(source.url).catch(() => setError('No se pudo abrir la fuente.'))}>
              <Text style={styles.link}>{source.title}</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.note}>Resultado al pulsar evaluar. Si cambian los síntomas o las mediciones, vuelve a evaluarlos.</Text>
        </View>
      )}
    </View>
  );
};

const Choice = ({ label, value, onChange, disabled }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void; disabled: boolean }) => (
  <View style={styles.choice}>
    <Text style={styles.choiceLabel}>{label}</Text>
    <View style={styles.options}>
      {([{ label: 'Sí', value: true }, { label: 'No', value: false }, { label: 'No sé', value: null }] as const).map((option) => (
        <TouchableOpacity key={option.label} accessibilityRole="radio" accessibilityState={{ checked: value === option.value, disabled }}
          accessibilityLabel={`${label}: ${option.label}`} disabled={disabled} onPress={() => onChange(option.value)}
          style={[styles.option, value === option.value && styles.selected]}>
          <Text style={[styles.optionText, value === option.value && { color: '#fff' }]}>{option.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);
const Lines = ({ title, lines }: { title: string; lines: string[] }) => lines.length > 0 ? <>
  <Text style={styles.subtitle}>{title}</Text>
  {lines.map((line, i) => <Text key={i} style={styles.note}>• {line}</Text>)}
</> : null;

const styles = StyleSheet.create({
  card: { padding: 14, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, backgroundColor: Colors.card, marginBottom: 16 },
  title: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginTop: 14, marginBottom: 6 },
  note: { fontSize: 12, lineHeight: 18, color: Colors.textSecondary, marginBottom: 5 },
  fields: { flexDirection: 'row', gap: 10, marginVertical: 10 },
  field: { flex: 1 }, label: { fontSize: 12, fontWeight: '700', color: Colors.textPrimary, marginBottom: 5 },
  input: { borderWidth: 1, borderColor: Colors.border, padding: 10, borderRadius: 8, color: Colors.textPrimary },
  choice: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 6 },
  choiceLabel: { fontSize: 12, color: Colors.textPrimary }, options: { flexDirection: 'row', gap: 6 },
  option: { paddingVertical: 7, paddingHorizontal: 14, borderWidth: 1, borderColor: Colors.border, borderRadius: 8 },
  selected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  optionText: { fontSize: 12, color: Colors.textSecondary },
  button: { marginTop: 14, padding: 12, backgroundColor: Colors.primary, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  error: { color: Colors.danger, fontSize: 12, marginTop: 10 },
  urgent: { color: Colors.danger, fontWeight: '700', lineHeight: 20, marginVertical: 12 },
  result: { marginTop: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  item: { paddingVertical: 8 }, link: { color: Colors.primary, fontSize: 12, lineHeight: 18, paddingVertical: 6 },
});
