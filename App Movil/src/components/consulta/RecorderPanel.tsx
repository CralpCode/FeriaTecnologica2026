import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useClinical } from '../../context/ClinicalContext';
import { apiService } from '../../services/api';
import { FOCUS_INFO, focusName } from '../../services/consulta';
import { AuscultationFocus, AuscultationMode, FocusGuide, RecordingResult } from '../../types/vitals';
import { color, font, radius, space, weight, toneColors, Tone } from '../../theme/tokens';
import { Banner, Button, Card, StatusPill } from '../ui';
import { PlayButton } from '../PlayButton';

const RECORDING_SECONDS = 15;
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`);

export const RESULT_STYLE: Record<string, { label: string; tone: Tone; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  normal: { label: 'Sin hallazgos', tone: 'success', icon: 'checkmark-circle' },
  anormal: { label: 'Posible sonido anormal', tone: 'danger', icon: 'alert-circle' },
  calidad_insuficiente: { label: 'Calidad insuficiente: repetir', tone: 'warning', icon: 'volume-mute' },
  indeterminado: { label: 'Indeterminado', tone: 'neutral', icon: 'help-circle' },
  modelo_no_disponible: { label: 'Modelo no disponible', tone: 'neutral', icon: 'time' },
  error: { label: 'Error al analizar', tone: 'neutral', icon: 'close-circle' },
};

/**
 * Grabación de un foco: guía de colocación, preparar, avance de 15 s y resultado.
 * La app no prepara sola: el médico toca "Preparar" y presiona el botón del estetoscopio.
 */
export const RecorderPanel: React.FC<{ mode: AuscultationMode; focus: AuscultationFocus }> = ({ mode, focus }) => {
  const { phase, armedLocation, lastResult, recordings, armRecording, recordingStartedAt } = useClinical();
  const [guide, setGuide] = useState<FocusGuide | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [showAsk, setShowAsk] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [arming, setArming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGuide(null); setAnswer(null); setError(null);
    apiService.getGuide(focus).then(setGuide).catch(() => setGuide(null));
  }, [focus]);

  // Resultado de ESTE foco: el que acaba de llegar o el último guardado
  const result: RecordingResult | null =
    lastResult && lastResult.location === focus ? lastResult
      : recordings.find((r) => r.location === focus && (r.mode === 'pulmon' ? 'pulmon' : 'corazon') === mode
          && !r.recording_id.startsWith('demo_')) || null;
  const armedHere = armedLocation === focus;

  const arm = async () => {
    setError(null); setArming(true);
    try {
      await armRecording(focus, mode);
    } catch (e: any) {
      setError(`No se pudo contactar al servidor: ${e?.message || e}`);
    } finally {
      setArming(false);
    }
  };

  const ask = async () => {
    if (!question.trim()) return;
    setAsking(true);
    try {
      setAnswer(await apiService.askGuide(question.trim(), focus));
    } catch {
      setAnswer('El asistente no está disponible. Revisa la guía de colocación.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <View>
      <Card>
        <View style={styles.headRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.focusCode}>{focus}</Text>
            <Text style={styles.focusTitle}>{FOCUS_INFO[focus].long}</Text>
          </View>
          {result && <StatusPill label={RESULT_STYLE[result.result]?.label || result.result}
                                 tone={RESULT_STYLE[result.result]?.tone || 'neutral'} />}
        </View>
        {guide && <Text style={styles.position}>{guide.posicion}</Text>}
        {guide && (
          <TouchableOpacity onPress={() => setShowSteps((v) => !v)} accessibilityRole="button"
                            accessibilityState={{ expanded: showSteps }} style={styles.linkRow}>
            <Ionicons name={showSteps ? 'chevron-up' : 'chevron-down'} size={16} color={color.primary} />
            <Text style={styles.link}>{showSteps ? 'Ocultar indicaciones' : 'Ver indicaciones para grabar'}</Text>
          </TouchableOpacity>
        )}
        {showSteps && guide?.pasos.map((p, i) => <Text key={i} style={styles.stepText}>• {p}</Text>)}

        <View style={styles.statusBox}>
          {phase === 'recording' && armedHere ? (
            <RecordingProgress startedAt={recordingStartedAt} focus={FOCUS_INFO[focus].short} />
          ) : phase === 'armed' && armedHere ? (
            <View style={styles.statusRow}>
              <Ionicons name="hand-left" size={22} color={color.primary} />
              <Text style={styles.statusText}>
                Listo. Coloca el estetoscopio en el foco y <Text style={styles.strong}>mantén presionado 1 s el botón del
                dispositivo</Text>. Los LED se llenan de azul mientras graba 15 s.
              </Text>
            </View>
          ) : (
            <Text style={styles.statusText}>
              Toca "Preparar grabación" y luego presiona 1 s el botón del estetoscopio.
            </Text>
          )}
        </View>
        <Button
          label={armedHere && phase === 'armed' ? 'Volver a preparar' : `Preparar grabación · ${FOCUS_INFO[focus].short}`}
          icon="radio-button-on" size="lg" full onPress={arm} loading={arming}
          disabled={phase === 'recording' && armedHere}
        />
        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity onPress={() => setShowAsk((v) => !v)} accessibilityRole="button" style={[styles.linkRow, { marginTop: space.md }]}>
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={color.ai} />
          <Text style={[styles.link, { color: color.ai }]}>¿Dudas al colocar el estetoscopio?</Text>
        </TouchableOpacity>
        {showAsk && (
          <View style={{ marginTop: space.sm }}>
            <View style={styles.askRow}>
              <TextInput style={styles.input} placeholder="Ej.: se escucha mucho ruido, ¿qué hago?"
                         placeholderTextColor={color.textMuted} value={question} onChangeText={setQuestion}
                         onSubmitEditing={ask} accessibilityLabel="Pregunta sobre cómo colocar el estetoscopio" />
              <TouchableOpacity style={styles.askBtn} onPress={ask} disabled={asking} accessibilityRole="button"
                                accessibilityLabel="Enviar pregunta">
                {asking ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="send" size={16} color="#FFFFFF" />}
              </TouchableOpacity>
            </View>
            {answer && <Text style={styles.answer}>{answer}</Text>}
          </View>
        )}
      </Card>
      {result && <ResultCard result={result} />}
    </View>
  );
};

/** Barra de avance de la grabación (15 s del ESP32) y luego "analizando". */
export const RecordingProgress: React.FC<{ startedAt: number | null; focus: string }> = ({ startedAt, focus }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;
  const analyzing = elapsed >= RECORDING_SECONDS;
  const frac = Math.min(1, elapsed / RECORDING_SECONDS);
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: RECORDING_SECONDS, now: Math.floor(elapsed) }}>
      <View style={styles.statusRow}>
        {analyzing ? <ActivityIndicator color={color.ai} /> : <Ionicons name="radio-button-on" size={22} color={color.danger} />}
        <Text style={styles.statusText}>
          {analyzing ? 'Analizando la grabación…'
            : `Grabando ${focus}: ${Math.max(0, Math.ceil(RECORDING_SECONDS - elapsed))} s. No muevas el estetoscopio.`}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${frac * 100}%`, backgroundColor: analyzing ? color.ai : color.primary }]} />
      </View>
    </View>
  );
};

/** Resultado de una grabación: salida del clasificador frente a su umbral y su descripción. */
export const ResultCard: React.FC<{ result: RecordingResult }> = ({ result }) => {
  const s = RESULT_STYLE[result.result] || RESULT_STYLE.error;
  const t = toneColors[s.tone];
  const prob = result.probability ?? 0;
  const thr = result.threshold ?? 0.5;
  return (
    <Card tone={s.tone}>
      <View style={styles.headRow}>
        <Ionicons name={s.icon} size={24} color={t.fg} />
        <Text style={[styles.resultTitle, { color: t.fg }]}>{s.label}</Text>
        {result.recording_id && !result.recording_id.startsWith('demo_') && result.has_audio !== false && (
          <PlayButton url={apiService.recordingAudioUrl(result.recording_id)} mode={result.mode} />
        )}
      </View>
      <Text style={styles.meta}>
        {focusName(result.location)} · {result.duration_s?.toFixed(1)} s
        {result.details?.ecualizacion ? ` · Ecualizado (perfil ${result.details.ecualizacion.perfil})` : ''}
      </Text>
      {result.probability !== null && result.probability !== undefined ? (
        <>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.min(100, prob * 100)}%`, backgroundColor: t.fg }]} />
            <View style={[styles.barThreshold, { left: `${thr * 100}%` }]} />
          </View>
          <Text style={styles.meta}>
            Salida del clasificador: {pct(prob)} · umbral: {pct(thr)}. No es probabilidad de enfermedad ni certeza clínica.
          </Text>
        </>
      ) : !!result.reason && <Text style={styles.meta}>{result.reason}</Text>}
      <DetailsView result={result} />
      {result.result === 'anormal' && (
        <Text style={[styles.meta, styles.strong, { marginTop: space.sm }]}>
          {result.mode === 'pulmon' ? 'Sugerencia: referir a evaluación médica.' : 'Sugerencia: referir a evaluación médica y ecocardiograma.'}
        </Text>
      )}
    </Card>
  );
};

const TRAIT_NAMES: Record<string, string> = { intensidad: 'Intensidad', forma: 'Forma', momento: 'Momento', tono: 'Tono', calidad: 'Calidad' };

/** Caracterización del soplo (corazón) o ruidos y patrón (pulmón): describe el sonido, no la causa. */
const DetailsView: React.FC<{ result: RecordingResult }> = ({ result }) => {
  const d = result.details || {};
  const traits = Object.entries(d.caracteristicas_soplo || {});
  const sounds = Object.entries(d.ruidos || {});
  if (!traits.length && !sounds.length && !d.patron && !d.modelo_base) return null;
  return (
    <View style={styles.details}>
      {traits.length > 0 && <Text style={styles.detailsTitle}>Cómo suena el soplo</Text>}
      {traits.map(([k, tr]) => (
        <Text key={k} style={styles.detailsLine}>
          • {TRAIT_NAMES[k] || k}: <Text style={styles.strong}>{tr.valor}</Text>
          <Text style={styles.meta}>  (salida {pct(tr.confianza)} · exactitud en prueba {pct(tr.exactitud_modelo)})</Text>
        </Text>
      ))}
      {sounds.length > 0 && <Text style={styles.detailsTitle}>Ruidos respiratorios</Text>}
      {sounds.map(([k, so]) => (
        <Text key={k} style={styles.detailsLine}>
          • {k.charAt(0).toUpperCase() + k.slice(1)}: <Text style={styles.strong}>{so.presente ? 'detectados' : 'no detectados'}</Text>
          <Text style={styles.meta}>  ({pct(so.probabilidad)})</Text>
        </Text>
      ))}
      {d.patron && (
        <Text style={styles.detailsLine}>
          • Patrón compatible con: <Text style={styles.strong}>{d.patron.compatible_con}</Text>
          <Text style={styles.meta}>  (descripción acústica; no identifica una enfermedad)</Text>
        </Text>
      )}
      {d.modelo_base && (
        <Text style={styles.detailsLine}>
          • Modelo base: <Text style={styles.strong}>{d.modelo_base.prediction}</Text>
          <Text style={styles.meta}>  ({pct(d.modelo_base.probability_abnormal)})</Text>
        </Text>
      )}
      {traits.length > 0 && <Text style={styles.meta}>Describe el sonido; no identifica la causa del soplo.</Text>}
    </View>
  );
};

/** Aviso cuando todavía no hay modelo de pulmón con qué analizar. */
export const LungModelNotice: React.FC = () => (
  <Banner tone="neutral" text="Los modelos de pulmón no están disponibles en el servidor. Puedes grabar igual: el audio queda guardado." />
);

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  focusCode: { fontSize: font.xs, fontWeight: weight.heavy, color: color.primary, letterSpacing: 0.5 },
  focusTitle: { fontSize: font.lg, fontWeight: weight.heavy, color: color.text },
  position: { fontSize: font.sm, color: color.text, lineHeight: 20, marginTop: space.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, cursor: 'pointer' as any },
  link: { fontSize: font.sm, fontWeight: weight.bold, color: color.primary },
  stepText: { fontSize: font.sm, color: color.textSecondary, lineHeight: 20 },
  statusBox: { backgroundColor: color.surfaceMuted, borderRadius: radius.md, padding: space.md, marginVertical: space.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  statusText: { flex: 1, fontSize: font.sm, color: color.textSecondary, lineHeight: 20 },
  strong: { fontWeight: weight.heavy, color: color.text },
  error: { color: color.danger, fontSize: font.sm, marginTop: space.sm },
  askRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: {
    flex: 1, minHeight: 44, borderWidth: 1, borderColor: color.border, borderRadius: radius.md,
    paddingHorizontal: space.md, fontSize: font.sm, color: color.text, backgroundColor: color.surface,
  },
  askBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.ai, alignItems: 'center', justifyContent: 'center' },
  answer: { fontSize: font.sm, color: color.text, lineHeight: 20, marginTop: space.sm },
  track: { height: 10, borderRadius: 5, backgroundColor: color.surface, marginTop: space.md, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5 },
  resultTitle: { flex: 1, fontSize: font.md, fontWeight: weight.heavy },
  meta: { fontSize: font.xs, color: color.textSecondary, lineHeight: 18, marginTop: 4 },
  barTrack: { height: 10, borderRadius: 5, backgroundColor: '#FFFFFF', marginTop: space.md, position: 'relative' },
  barFill: { height: 10, borderRadius: 5 },
  barThreshold: { position: 'absolute', top: -4, width: 2, height: 18, backgroundColor: color.text },
  details: { backgroundColor: '#FFFFFF', borderRadius: radius.sm, padding: space.md, marginTop: space.sm, gap: 2 },
  detailsTitle: { fontSize: font.xs, fontWeight: weight.heavy, color: color.text, marginTop: 2 },
  detailsLine: { fontSize: font.xs, color: color.text, lineHeight: 18 },
});
