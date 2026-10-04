import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useClinical } from '../context/ClinicalContext';
import { ClinicalAssessmentPanel } from '../components/ClinicalAssessmentPanel';
import { apiService } from '../services/api';
import { AuscultationFocus, AuscultationMode, FocusGuide, HeartModelInfo, RecordingResult } from '../types/vitals';

const FOCI: Record<AuscultationMode, { id: AuscultationFocus; label: string }[]> = {
  corazon: [
    { id: 'AV', label: 'Aórtico' },
    { id: 'PV', label: 'Pulmonar' },
    { id: 'TV', label: 'Tricuspídeo' },
    { id: 'MV', label: 'Mitral' },
  ],
  pulmon: [
    { id: 'TC', label: 'Tráquea' },
    { id: 'AL', label: 'Ant. izq.' },
    { id: 'AR', label: 'Ant. der.' },
    { id: 'PL', label: 'Espalda izq.' },
    { id: 'PR', label: 'Espalda der.' },
    { id: 'LL', label: 'Costado izq.' },
    { id: 'LR', label: 'Costado der.' },
  ],
};

const focusName = (id?: string) =>
  [...FOCI.corazon, ...FOCI.pulmon].find((f) => f.id === id)?.label || 'Sin foco';

const RESULT_STYLE: Record<RecordingResult['result'], { label: string; color: string; soft: string; icon: string }> = {
  normal: { label: 'Sin hallazgos', color: Colors.success, soft: Colors.successSoft, icon: 'check-circle' },
  anormal: { label: 'Posible sonido anormal', color: Colors.danger, soft: Colors.dangerSoft, icon: 'alert-circle' },
  calidad_insuficiente: { label: 'Calidad insuficiente', color: Colors.warning, soft: Colors.warningSoft, icon: 'volume-off' },
  modelo_no_disponible: { label: 'Modelo aún no entrenado', color: Colors.textSecondary, soft: Colors.backgroundSecondary, icon: 'progress-clock' },
  error: { label: 'Error al analizar', color: Colors.textSecondary, soft: Colors.backgroundSecondary, icon: 'close-circle' },
};

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`);

export const AuscultationScreen: React.FC = () => {
  const { phase, armedLocation, lastResult, recordings, armRecording } = useClinical();
  const [mode, setMode] = useState<AuscultationMode>('corazon');
  const [focus, setFocus] = useState<AuscultationFocus>('MV');
  const [guide, setGuide] = useState<FocusGuide | null>(null);
  const [model, setModel] = useState<HeartModelInfo | null>(null);
  const [lungReady, setLungReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    apiService.getGuide(focus).then(setGuide).catch(() => setGuide(null));
    setAnswer(null);
  }, [focus]);

  useEffect(() => {
    apiService.getHeartModelInfo().then(setModel).catch(() => setModel(null));
    apiService
      .getModelsInfo()
      .then((m) => setLungReady(Object.values(m.pulmon || {}).some((x) => x.loaded)))
      .catch(() => setLungReady(null));
  }, []);

  const handleArm = async () => {
    setError(null);
    try {
      await armRecording(focus, mode);
    } catch (e: any) {
      setError(`No se pudo contactar al servidor: ${e?.message || e}`);
    }
  };

  const handleAsk = async () => {
    if (!question.trim()) return;
    setAsking(true);
    try {
      setAnswer(await apiService.askGuide(question.trim(), focus));
    } catch {
      setAnswer('El asistente no está disponible. Revisa la guía de colocación de arriba.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.disclaimer}>
        <Ionicons name="information-circle" size={16} color="#92400E" />
        <Text style={styles.disclaimerText}>
          Tamizaje con IA: detecta posibles sonidos cardíacos o pulmonares anormales para sugerir una referencia médica. No es un diagnóstico.
        </Text>
      </View>

      <ClinicalAssessmentPanel />

      {/* 0. Corazón o pulmones */}
      <View style={styles.modeRow}>
        {(['corazon', 'pulmon'] as AuscultationMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
            onPress={() => {
              setMode(m);
              setFocus(m === 'corazon' ? 'MV' : 'PL');
            }}
          >
            <MaterialCommunityIcons
              name={m === 'corazon' ? 'heart-pulse' : 'lungs'}
              size={18}
              color={mode === m ? '#FFFFFF' : Colors.textSecondary}
            />
            <Text style={[styles.modeText, mode === m && { color: '#FFFFFF' }]}>
              {m === 'corazon' ? 'Corazón' : 'Pulmones'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'pulmon' && lungReady === false && (
        <View style={[styles.disclaimer, { backgroundColor: Colors.backgroundSecondary, borderColor: Colors.border }]}>
          <MaterialCommunityIcons name="progress-clock" size={16} color={Colors.textSecondary} />
          <Text style={[styles.disclaimerText, { color: Colors.textSecondary }]}>
            Los modelos de pulmón aún no están entrenados (faltan los audios de ICBHI). Puedes grabar igual: el audio queda
            guardado, pero todavía no se analiza.
          </Text>
        </View>
      )}

      {/* 1. Selección de foco */}
      <Text style={styles.sectionTitle}>
        1. Elige {mode === 'corazon' ? 'el foco cardíaco' : 'la zona del tórax'}
      </Text>
      <View style={[styles.focusRow, mode === 'pulmon' && { flexWrap: 'wrap' }]}>
        {FOCI[mode].map((f) => {
          const active = focus === f.id;
          return (
            <TouchableOpacity
              key={f.id}
              style={[styles.focusBtn, mode === 'pulmon' && styles.focusBtnLung, active && styles.focusBtnActive]}
              onPress={() => setFocus(f.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.focusId, active && { color: '#FFFFFF' }]}>{f.id}</Text>
              <Text style={[styles.focusLabel, active && { color: '#DBEAFE' }]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {guide && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="stethoscope" size={18} color={Colors.primary} />
            <Text style={styles.cardTitle}>{guide.nombre}</Text>
          </View>
          <Text style={styles.guidePosition}>{guide.posicion}</Text>
          {guide.pasos.map((p, i) => (
            <Text key={i} style={styles.guideStep}>• {p}</Text>
          ))}
        </View>
      )}

      {/* 2. Grabación */}
      <Text style={styles.sectionTitle}>2. Graba 15 segundos</Text>
      <View style={styles.card}>
        {phase === 'recording' ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.statusText}>Grabando foco {focusName(armedLocation || undefined)}… no muevas el estetoscopio.</Text>
          </View>
        ) : phase === 'armed' ? (
          <View style={styles.statusRow}>
            <MaterialCommunityIcons name="gesture-tap-hold" size={22} color={Colors.primary} />
            <Text style={styles.statusText}>
              Listo para el foco {focusName(armedLocation || undefined)}. Mantén presionado el botón del dispositivo 1 segundo.
            </Text>
          </View>
        ) : (
          <Text style={styles.statusText}>
            Presiona "Preparar" y luego mantén presionado 1 s el botón del estetoscopio. Los LEDs se llenan de azul mientras graba.
          </Text>
        )}
        <TouchableOpacity style={styles.primaryBtn} onPress={handleArm} activeOpacity={0.8}>
          <MaterialCommunityIcons name="record-circle-outline" size={18} color="#FFFFFF" />
          <Text style={styles.primaryBtnText}>Preparar grabación · {focusName(focus)}</Text>
        </TouchableOpacity>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      {/* 3. Resultado */}
      {lastResult && <ResultCard result={lastResult} />}

      {/* Preguntas al asistente de uso */}
      <Text style={styles.sectionTitle}>¿Dudas al colocar el estetoscopio?</Text>
      <View style={styles.card}>
        <View style={styles.askRow}>
          <TextInput
            style={styles.input}
            placeholder="Ej.: se escucha mucho ruido, ¿qué hago?"
            placeholderTextColor={Colors.textMuted}
            value={question}
            onChangeText={setQuestion}
            onSubmitEditing={handleAsk}
          />
          <TouchableOpacity style={styles.askBtn} onPress={handleAsk} disabled={asking}>
            {asking ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="send" size={16} color="#FFFFFF" />}
          </TouchableOpacity>
        </View>
        {answer && <Text style={styles.answerText}>{answer}</Text>}
      </View>

      {/* Historial */}
      {recordings.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Grabaciones de esta sesión</Text>
          {recordings.map((r) => {
            const s = RESULT_STYLE[r.result] || RESULT_STYLE.error;
            return (
              <View key={r.recording_id} style={styles.historyRow}>
                <MaterialCommunityIcons name={s.icon as any} size={18} color={s.color} />
                <Text style={styles.historyFocus}>{focusName(r.location)}</Text>
                <Text style={[styles.historyResult, { color: s.color }]}>{s.label}</Text>
                <Text style={styles.historyProb}>{pct(r.probability)}</Text>
              </View>
            );
          })}
        </>
      )}

      {/* Transparencia del modelo */}
      {model?.loaded && model.metricas_prueba && (
        <View style={[styles.card, { marginTop: 16 }]}>
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="chart-box-outline" size={18} color={Colors.aiPurple} />
            <Text style={styles.cardTitle}>Desempeño del modelo (datos de prueba)</Text>
          </View>
          <View style={styles.metricsRow}>
            <Metric label="Sensibilidad" value={pct(model.metricas_prueba.sensibilidad)} />
            <Metric label="Especificidad" value={pct(model.metricas_prueba.especificidad)} />
            <Metric label="AUC" value={model.metricas_prueba.auc.toFixed(2)} />
          </View>
          <Text style={styles.modelNote}>
            CNN entrenada con {model.dataset} · {model.metricas_prueba.n} grabaciones de prueba no vistas en entrenamiento.
          </Text>
          {model.limitaciones?.map((l, i) => (
            <Text key={i} style={styles.modelNote}>• {l}</Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const ResultCard: React.FC<{ result: RecordingResult }> = ({ result }) => {
  const s = RESULT_STYLE[result.result] || RESULT_STYLE.error;
  const prob = result.probability ?? 0;
  const thr = result.threshold ?? 0.5;
  return (
    <View style={[styles.card, { borderColor: s.color, backgroundColor: s.soft }]}>
      <View style={styles.cardHeader}>
        <MaterialCommunityIcons name={s.icon as any} size={22} color={s.color} />
        <Text style={[styles.resultTitle, { color: s.color }]}>{s.label}</Text>
      </View>
      <Text style={styles.statusText}>Foco {focusName(result.location)} · {result.duration_s?.toFixed(1)} s</Text>
      {result.probability !== null ? (
        <>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.min(100, prob * 100)}%`, backgroundColor: s.color }]} />
            <View style={[styles.barThreshold, { left: `${thr * 100}%` }]} />
          </View>
          <Text style={styles.modelNote}>
            Salida del clasificador de sonido: {pct(prob)} · umbral: {pct(thr)}. No es probabilidad de enfermedad ni certeza clínica.
          </Text>
        </>
      ) : (
        <Text style={styles.statusText}>{result.reason}</Text>
      )}
      <DetailsView result={result} />
      {result.result === 'anormal' && (
        <Text style={[styles.statusText, { fontWeight: '700', marginTop: 6 }]}>
          {result.mode === 'pulmon'
            ? 'Sugerencia: referir a evaluación médica.'
            : 'Sugerencia: referir a evaluación médica y ecocardiograma.'}
        </Text>
      )}
    </View>
  );
};

const TRAIT_NAMES: Record<string, string> = {
  intensidad: 'Intensidad', forma: 'Forma', momento: 'Momento', tono: 'Tono', calidad: 'Calidad',
};

/** Caracterización del soplo (corazón) o ruidos y patrón (pulmón). Siempre como descripción, no como causa. */
const DetailsView: React.FC<{ result: RecordingResult }> = ({ result }) => {
  const d = result.details || {};
  const traits = Object.entries(d.caracteristicas_soplo || {});
  const sounds = Object.entries(d.ruidos || {});
  if (!traits.length && !sounds.length && !d.patron && !d.modelo_base) return null;
  return (
    <View style={styles.detailsBox}>
      {traits.length > 0 && <Text style={styles.detailsTitle}>Cómo suena el soplo</Text>}
      {traits.map(([k, t]) => (
        <Text key={k} style={styles.detailsLine}>
          • {TRAIT_NAMES[k] || k}: <Text style={{ fontWeight: '700' }}>{t.valor}</Text>
          <Text style={styles.detailsMeta}>  (salida del modelo {pct(t.confianza)} · exactitud en su conjunto de prueba {pct(t.exactitud_modelo)})</Text>
        </Text>
      ))}
      {sounds.length > 0 && <Text style={styles.detailsTitle}>Ruidos respiratorios</Text>}
      {sounds.map(([k, s]) => (
        <Text key={k} style={styles.detailsLine}>
          • {k.charAt(0).toUpperCase() + k.slice(1)}:{' '}
          <Text style={{ fontWeight: '700' }}>{s.presente ? 'detectados' : 'no detectados'}</Text>
          <Text style={styles.detailsMeta}>  ({pct(s.probabilidad)})</Text>
        </Text>
      ))}
      {d.patron && (
        <Text style={styles.detailsLine}>
          • Patrón compatible con: <Text style={{ fontWeight: '700' }}>{d.patron.compatible_con}</Text>
          <Text style={styles.detailsMeta}>  (descripción acústica; no identifica una enfermedad)</Text>
        </Text>
      )}
      {d.modelo_base && (
        <Text style={styles.detailsLine}>
          • Modelo base (regresión logística): <Text style={{ fontWeight: '700' }}>{d.modelo_base.prediction}</Text>
          <Text style={styles.detailsMeta}>
            {'  '}({pct(d.modelo_base.probability_abnormal)} · puntaje ICBHI {d.modelo_base.score_icbhi} %)
          </Text>
        </Text>
      )}
      {traits.length > 0 && (
        <Text style={styles.detailsMeta}>Describe el sonido; no identifica la causa del soplo.</Text>
      )}
    </View>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.metric}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },
  disclaimer: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 14,
  },
  disclaimerText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 17 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary, marginTop: 6, marginBottom: 10 },
  focusRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  focusBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  focusBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  focusBtnLung: { flex: 0, minWidth: '22%', flexGrow: 1 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modeBtnActive: { backgroundColor: Colors.aiPurple, borderColor: Colors.aiPurple },
  modeText: { fontSize: 14, fontWeight: '800', color: Colors.textSecondary },
  detailsBox: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 10, marginTop: 8, gap: 2 },
  detailsTitle: { fontSize: 12, fontWeight: '800', color: Colors.textPrimary, marginTop: 2 },
  detailsLine: { fontSize: 12, color: Colors.textPrimary, lineHeight: 18 },
  detailsMeta: { fontSize: 11, color: Colors.textSecondary },
  focusId: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary },
  focusLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: Colors.textPrimary, flexShrink: 1 },
  guidePosition: { fontSize: 13, color: Colors.textPrimary, fontWeight: '600', marginBottom: 8, lineHeight: 19 },
  guideStep: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 12,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  errorText: { color: Colors.danger, fontSize: 12, marginTop: 8 },
  resultTitle: { fontSize: 17, fontWeight: '800' },
  barTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    marginTop: 10,
    marginBottom: 6,
    overflow: 'visible',
    position: 'relative',
  },
  barFill: { height: 10, borderRadius: 5 },
  barThreshold: { position: 'absolute', top: -4, width: 2, height: 18, backgroundColor: Colors.textPrimary },
  askRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  askBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.aiPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerText: { fontSize: 13, color: Colors.textPrimary, lineHeight: 19, marginTop: 10 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    marginBottom: 6,
  },
  historyFocus: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, width: 90 },
  historyResult: { flex: 1, fontSize: 12, fontWeight: '700' },
  historyProb: { fontSize: 12, color: Colors.textSecondary },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 6 },
  metric: { alignItems: 'center', flex: 1 },
  metricValue: { fontSize: 18, fontWeight: '800', color: Colors.aiPurple },
  metricLabel: { fontSize: 11, color: Colors.textSecondary },
  modelNote: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
});
