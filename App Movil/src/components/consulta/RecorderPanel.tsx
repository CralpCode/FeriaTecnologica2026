import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../ui/Text';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Line, Path } from 'react-native-svg';
import { useClinical } from '../../context/ClinicalContext';
import { useVitals } from '../../context/VitalsContext';
import { apiService } from '../../services/api';
import { FOCUS_INFO, focusName } from '../../services/consulta';
import { AuscultationFocus, AuscultationMode, FocusGuide, RecordingResult } from '../../types/vitals';
import { color, font, radius, space, tabular, weight, toneColors, Tone } from '../../theme/tokens';
import { Banner, Button, Card, ProgressRing, StatusPill, useReducedMotion } from '../ui';
import { Waveform } from '../Waveform';

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

const STAGES = ['Grabar', 'Estetoscopio', 'Grabando', 'Analizando', 'Resultado'];

/**
 * Grabación de un foco: etapas, orden de grabar, cuenta regresiva de 15 s y resultado.
 * El estetoscopio no tiene botón: el médico toca "Grabar" y el ESP32 recibe la orden del servidor
 * (GET /api/device/comando). La zona la pone el servidor según la orden.
 */
export const RecorderPanel: React.FC<{ mode: AuscultationMode; focus: AuscultationFocus }> = ({ mode, focus }) => {
  const { phase, armedLocation, lastResult, recordings, armRecording, recordingStartedAt, commandDelivered, armedAt } = useClinical();
  const [guide, setGuide] = useState<FocusGuide | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [showAsk, setShowAsk] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [arming, setArming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setGuide(null); setAnswer(null); setError(null); setShowSteps(false);
    apiService.getGuide(focus).then(setGuide).catch(() => setGuide(null));
  }, [focus]);

  const armedHere = armedLocation === focus;
  const recordingHere = armedHere && phase === 'recording';
  useEffect(() => {
    if (!recordingHere) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [recordingHere]);

  // Resultado de ESTE foco: el que acaba de llegar o el último guardado
  const result: RecordingResult | null =
    lastResult && lastResult.location === focus ? lastResult
      : recordings.find((r) => r.location === focus && (r.mode === 'pulmon' ? 'pulmon' : 'corazon') === mode
          && !r.recording_id.startsWith('demo_')) || null;
  const elapsed = recordingHere && recordingStartedAt ? (now - recordingStartedAt) / 1000 : 0;
  const analyzing = recordingHere && elapsed >= RECORDING_SECONDS;
  const stage = armedHere && phase === 'armed' ? 1 : recordingHere ? (analyzing ? 3 : 2) : result ? 4 : 0;
  const retry = result?.result === 'calidad_insuficiente' || result?.details?.colocacion?.ok === false;

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

  const status = result ? RESULT_STYLE[result.result] : null;

  return (
    <View>
      <Card elevated>
        <View style={styles.headRow}>
          <View style={[styles.codeBadge, status && { backgroundColor: toneColors[status.tone].bg, borderColor: toneColors[status.tone].border }]}>
            <Text style={[styles.codeText, status && { color: toneColors[status.tone].fg }]}>{focus}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.kicker}>{mode === 'corazon' ? 'Foco del corazón' : 'Zona del pulmón'}</Text>
            <Text style={styles.focusTitle} numberOfLines={1}>{FOCUS_INFO[focus].long}</Text>
          </View>
          {status && <StatusPill label={status.label} tone={status.tone} dot />}
        </View>

        <StageTrack stage={stage} />

        <View style={styles.stageBox}>
          {stage === 2 || stage === 3 ? (
            <RecordingCountdown elapsed={elapsed} analyzing={analyzing} focus={FOCUS_INFO[focus].short} />
          ) : stage === 1 ? (
            <Armed delivered={commandDelivered} armedAt={armedAt} focus={FOCUS_INFO[focus].short} />
          ) : (
            <View style={styles.idleRow}>
              <View style={styles.idleIcon}><MaterialCommunityIcons name="stethoscope" size={26} color={color.primary} /></View>
              <Text style={styles.stageText}>
                {retry ? 'La grabación anterior no sirvió (ruido o poco contacto). Revisa el contacto con la piel y repite.'
                  : result ? 'Este foco ya tiene resultado. Puedes repetirlo si dudas de la grabación.'
                  : <>Coloca el estetoscopio en <Text style={styles.strong}>{FOCUS_INFO[focus].short.toLowerCase()}</Text> y toca
                    "Grabar". El estetoscopio empieza solo; no hay que presionar nada.</>}
              </Text>
            </View>
          )}
        </View>

        <Button
          label={stage === 1 ? 'Volver a enviar la orden' : retry ? 'Repetir este foco' : result ? `Repetir · ${FOCUS_INFO[focus].short}`
            : `Grabar · ${FOCUS_INFO[focus].short}`}
          icon={retry || result ? 'refresh' : 'mic'} size="lg" full onPress={arm} loading={arming}
          variant={result && !retry && stage !== 1 ? 'secondary' : 'primary'}
          disabled={recordingHere}
        />
        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.links}>
          {guide && (
            <Pressable onPress={() => setShowSteps((v) => !v)} accessibilityRole="button"
                       accessibilityState={{ expanded: showSteps }} style={styles.linkRow}>
              <Ionicons name="list-outline" size={16} color={color.primary} />
              <Text style={styles.link}>{showSteps ? 'Ocultar indicaciones' : 'Indicaciones para grabar'}</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setShowAsk((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showAsk }}
                     style={styles.linkRow}>
            <Ionicons name="sparkles-outline" size={16} color={color.ai} />
            <Text style={[styles.link, { color: color.ai }]}>¿Dudas al colocarlo?</Text>
          </Pressable>
        </View>
        {showSteps && guide && (
          <View style={styles.steps}>
            {guide.posicion ? <Text style={[styles.stepText, styles.strong]}>{guide.posicion}</Text> : null}
            {guide.pasos.map((p, i) => (
              <View key={i} style={styles.stepRow}>
                <Text style={styles.stepNum}>{i + 1}</Text>
                <Text style={styles.stepText}>{p}</Text>
              </View>
            ))}
          </View>
        )}
        {showAsk && (
          <View style={{ marginTop: space.sm }}>
            <View style={styles.askRow}>
              <TextInput style={styles.input} placeholder="Ej.: se escucha mucho ruido, ¿qué hago?"
                         placeholderTextColor={color.textMuted} value={question} onChangeText={setQuestion}
                         onSubmitEditing={ask} accessibilityLabel="Pregunta sobre cómo colocar el estetoscopio" />
              <Pressable style={styles.askBtn} onPress={ask} disabled={asking} accessibilityRole="button" accessibilityLabel="Enviar pregunta">
                {asking ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="send" size={16} color="#FFFFFF" />}
              </Pressable>
            </View>
            {answer && <Text style={styles.answer}>{answer}</Text>}
          </View>
        )}
      </Card>
      {result && <ResultCard result={result} />}
    </View>
  );
};

/** Etapas de la grabación: la actual resaltada, las anteriores completas. */
const StageTrack: React.FC<{ stage: number }> = ({ stage }) => (
  <View style={styles.track} accessibilityLabel={`Etapa: ${STAGES[stage]}`}>
    {STAGES.map((s, i) => {
      const done = i < stage || stage === 4;
      const active = i === stage && stage !== 4;
      return (
        <View key={s} style={styles.trackItem}>
          {i < STAGES.length - 1 && <View style={[styles.trackLine, i < stage && { backgroundColor: color.success }]} />}
          <View style={[styles.trackDot, done && styles.trackDotDone, active && styles.trackDotActive]}>
            {done ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
          </View>
          <Text style={[styles.trackText, (done || active) && { color: active ? color.primary : color.text }]} numberOfLines={1}>{s}</Text>
        </View>
      );
    })}
  </View>
);

/** Orden enviada: espera a que el estetoscopio la reciba y empiece a grabar (sin botón). */
const Armed: React.FC<{ delivered: boolean; armedAt: number | null; focus: string }> = ({ delivered, armedAt, focus }) => {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(v, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, v]);
  const waited = armedAt ? (now - armedAt) / 1000 : 0;
  const slow = !delivered && waited > 15;   // el ESP32 pregunta cada segundo: 15 s sin respuesta es raro
  return (
    <View>
      <View style={styles.idleRow}>
        <Animated.View style={[styles.idleIcon, styles.armedIcon, { transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }] }]}>
          <Ionicons name={delivered ? 'checkmark' : 'radio-outline'} size={26} color="#FFFFFF" />
        </Animated.View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.stageText, styles.strong]}>
            {delivered ? 'El estetoscopio recibió la orden: empieza a grabar en un momento.' : 'Enviando la orden al estetoscopio…'}
          </Text>
          <Text style={styles.stageText}>Mantén el estetoscopio en {focus.toLowerCase()}, sin moverlo, y pide silencio.</Text>
        </View>
      </View>
      {slow && (
        <Banner tone="warning" style={{ marginTop: space.md, marginBottom: 0 }} title="El estetoscopio no ha respondido"
                text="Revisa que esté encendido y con internet. La orden sigue vigente 2 minutos; puedes volver a enviarla." />
      )}
    </View>
  );
};

/** Cuenta regresiva real de la grabación y, si hay dato válido, el nivel del micrófono en vivo. */
const RecordingCountdown: React.FC<{ elapsed: number; analyzing: boolean; focus: string }> = ({ elapsed, analyzing, focus }) => {
  const { vitals } = useVitals();
  const fresh = Date.now() - Date.parse(vitals.timestamp) < 5000;
  const level = vitals.source === 'real' && vitals.audioUnit === 'dBFS' && Number.isFinite(vitals.audio_rms)
    && vitals.audio_rms < 0 && fresh ? vitals.audio_rms : null;
  const left = Math.max(0, Math.ceil(RECORDING_SECONDS - elapsed));
  return (
    <View style={styles.idleRow} accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: RECORDING_SECONDS, now: Math.min(RECORDING_SECONDS, Math.floor(elapsed)) }}>
      <ProgressRing value={analyzing ? 1 : elapsed / RECORDING_SECONDS} size={84} stroke={6}
                    tint={analyzing ? color.ai : color.danger} track={analyzing ? color.aiSoft : color.dangerSoft}>
        {analyzing ? <ActivityIndicator color={color.ai} />
          : <Text style={[styles.countdown, tabular]}>{left}<Text style={styles.countdownUnit}> s</Text></Text>}
      </ProgressRing>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.stageText, styles.strong]}>
          {analyzing ? 'Analizando la grabación…' : `Grabando ${focus.toLowerCase()}`}
        </Text>
        <Text style={styles.stageText}>
          {analyzing ? 'La red neuronal revisa el sonido; tarda unos segundos.' : 'No muevas el estetoscopio y pide silencio.'}
        </Text>
        {!analyzing && level !== null && (
          <View style={styles.levelRow}>
            <View style={styles.levelTrack}>
              <View style={[styles.levelFill, { width: `${Math.max(2, Math.min(100, ((level + 60) / 60) * 100))}%` }]} />
            </View>
            <Text style={[styles.levelText, tabular]}>{level.toFixed(1)} dBFS</Text>
          </View>
        )}
      </View>
    </View>
  );
};

/** Medidor semicircular: salida del clasificador frente a su umbral (no es probabilidad de enfermedad). */
const Gauge: React.FC<{ value: number; threshold: number; tint: string }> = ({ value, threshold, tint }) => {
  const W = 132, H = 74, cx = W / 2, cy = 68, r = 56;
  const pt = (f: number) => {
    const a = Math.PI * (1 - Math.max(0, Math.min(1, f)));
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  };
  const arc = (f: number) => {
    const p = pt(f);
    return `M${cx - r} ${cy} A${r} ${r} 0 0 1 ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  };
  const t1 = pt(threshold);
  const a = Math.PI * (1 - threshold);
  const t2 = { x: cx + (r - 13) * Math.cos(a), y: cy - (r - 13) * Math.sin(a) };
  return (
    <View style={{ width: W, height: H + 4, alignItems: 'center' }}>
      <Svg width={W} height={H}>
        <Path d={arc(1)} stroke={color.surfaceMuted} strokeWidth={10} fill="none" strokeLinecap="round" />
        {value > 0.005 && <Path d={arc(value)} stroke={tint} strokeWidth={10} fill="none" strokeLinecap="round" />}
        <Line x1={t1.x + (t1.x - cx) * 0.12} y1={t1.y + (t1.y - cy) * 0.12} x2={t2.x} y2={t2.y} stroke={color.text} strokeWidth={2.5} strokeLinecap="round" />
      </Svg>
      <Text style={[styles.gaugeValue, tabular, { color: tint }]}>{pct(value)}</Text>
    </View>
  );
};

/** Resultado de una grabación: onda real, salida del clasificador frente a su umbral y descripción. */
export const ResultCard: React.FC<{ result: RecordingResult }> = ({ result }) => {
  const s = RESULT_STYLE[result.result] || RESULT_STYLE.error;
  const t = toneColors[s.tone];
  const hasProb = result.probability !== null && result.probability !== undefined;
  const prob = result.probability ?? 0;
  const thr = result.threshold ?? 0.5;
  const playable = !!result.recording_id && !result.recording_id.startsWith('demo_') && result.has_audio !== false;
  return (
    <Card tone={s.tone}>
      <View style={styles.headRow}>
        <Ionicons name={s.icon} size={26} color={t.fg} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.resultTitle, { color: t.fg }]}>{s.label}</Text>
          <Text style={styles.meta}>
            {focusName(result.location)}{result.duration_s ? ` · ${result.duration_s.toFixed(1)} s` : ''}
            {result.details?.ecualizacion ? ` · ecualizado (perfil ${result.details.ecualizacion.perfil})` : ''}
          </Text>
        </View>
      </View>

      {playable && (
        <View style={styles.waveBox}>
          <Waveform url={apiService.recordingAudioUrl(result.recording_id)} mode={result.mode} tint={t.fg} seconds={result.duration_s} />
        </View>
      )}

      {result.details?.colocacion?.ok === false && (
        <Banner tone="warning" icon="locate-outline" style={{ marginTop: space.md, marginBottom: 0 }}
                title={`No se detectaron ${result.details.colocacion.que} claros`}
                text="¿El estetoscopio está en el foco correcto y con buen contacto? Conviene repetir esta grabación." />
      )}

      {hasProb ? (
        <View style={styles.gaugeRow}>
          <Gauge value={prob} threshold={thr} tint={t.fg} />
          <View style={{ flex: 1, minWidth: 160 }}>
            <Text style={styles.gaugeLabel}>Salida del clasificador</Text>
            <Text style={styles.meta}>
              <Text style={styles.strong}>{pct(prob)}</Text> frente al umbral de <Text style={styles.strong}>{pct(thr)}</Text>
              {' '}(la raya negra). Por encima del umbral se marca como posible anormal.
            </Text>
            <Text style={styles.meta}>No es probabilidad de enfermedad ni certeza clínica.</Text>
          </View>
        </View>
      ) : !!result.reason && <Text style={[styles.meta, { marginTop: space.sm }]}>{result.reason}</Text>}

      <DetailsView result={result} />
      {result.result === 'anormal' && (
        <View style={styles.suggest}>
          <Ionicons name="arrow-forward-circle" size={18} color={color.danger} />
          <Text style={[styles.meta, styles.strong, { marginTop: 0, flex: 1 }]}>
            {result.mode === 'pulmon' ? 'Sugerencia: referir a evaluación médica.' : 'Sugerencia: referir a evaluación médica y ecocardiograma.'}
          </Text>
        </View>
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
        <DetailRow key={k} label={TRAIT_NAMES[k] || k} value={tr.valor}
                   note={`salida ${pct(tr.confianza)} · exactitud en prueba ${pct(tr.exactitud_modelo)}`} />
      ))}
      {sounds.length > 0 && <Text style={styles.detailsTitle}>Ruidos respiratorios</Text>}
      {sounds.map(([k, so]) => (
        <DetailRow key={k} label={k.charAt(0).toUpperCase() + k.slice(1)} value={so.presente ? 'detectados' : 'no detectados'}
                   note={pct(so.probabilidad)} />
      ))}
      {d.patron && <DetailRow label="Patrón compatible con" value={d.patron.compatible_con} note="descripción acústica; no identifica una enfermedad" />}
      {d.modelo_base && <DetailRow label="Modelo base" value={d.modelo_base.prediction} note={pct(d.modelo_base.probability_abnormal)} />}
      {traits.length > 0 && <Text style={styles.meta}>Describe el sonido; no identifica la causa del soplo.</Text>}
    </View>
  );
};

const DetailRow: React.FC<{ label: string; value: string; note?: string }> = ({ label, value, note }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end' }}>
      <Text style={styles.detailValue}>{value}</Text>
      {!!note && <Text style={styles.detailNote}>{note}</Text>}
    </View>
  </View>
);

/** Aviso cuando todavía no hay modelo de pulmón con qué analizar. */
export const LungModelNotice: React.FC = () => (
  <Banner tone="neutral" text="Los modelos de pulmón no están disponibles en el servidor. Puedes grabar igual: el audio queda guardado." />
);

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  codeBadge: {
    width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.primarySoft, borderWidth: 1, borderColor: color.primaryBorder,
  },
  codeText: { fontSize: font.md, fontWeight: weight.heavy, color: color.primary },
  kicker: { fontSize: font.xs, fontWeight: weight.bold, color: color.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' },
  focusTitle: { fontSize: font.lg, fontWeight: weight.heavy, color: color.text, letterSpacing: -0.3 },
  track: { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.lg },
  trackItem: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4 },
  trackDot: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: color.borderStrong, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  trackDotDone: { backgroundColor: color.success, borderColor: color.success },
  trackDotActive: { borderColor: color.primary, backgroundColor: color.primary, boxShadow: `0px 0px 0px 4px ${color.primarySoft}` },
  trackText: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.bold },
  trackLine: { position: 'absolute', top: 8, left: '50%', width: '100%', height: 2, backgroundColor: color.border },
  stageBox: {
    backgroundColor: color.surfaceMuted, borderRadius: radius.lg, padding: space.lg, marginVertical: space.lg,
    borderWidth: 1, borderColor: color.border, minHeight: 104, justifyContent: 'center',
  },
  idleRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  idleIcon: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: color.primaryBorder,
  },
  armedIcon: { backgroundColor: color.primary, borderColor: color.primary },
  stageText: { flex: 1, fontSize: font.sm, color: color.textSecondary, lineHeight: 20 },
  strong: { fontWeight: weight.heavy, color: color.text },
  countdown: { fontSize: 26, fontWeight: weight.heavy, color: color.danger },
  countdownUnit: { fontSize: font.sm, fontWeight: weight.bold, color: color.danger },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  levelTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: color.border, overflow: 'hidden' },
  levelFill: { height: 6, borderRadius: 3, backgroundColor: color.info },
  levelText: { fontSize: font.xs, color: color.textSecondary, fontWeight: weight.bold },
  error: { color: color.danger, fontSize: font.sm, marginTop: space.sm },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: space.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, cursor: 'pointer' as any },
  link: { fontSize: font.sm, fontWeight: weight.bold, color: color.primary },
  steps: { backgroundColor: color.surfaceMuted, borderRadius: radius.md, padding: space.md, gap: space.sm },
  stepRow: { flexDirection: 'row', gap: space.sm },
  stepNum: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: color.surface, textAlign: 'center', lineHeight: 20,
    fontSize: font.xs, fontWeight: weight.heavy, color: color.primary, overflow: 'hidden',
  },
  stepText: { flex: 1, fontSize: font.sm, color: color.textSecondary, lineHeight: 20 },
  askRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: {
    flex: 1, minHeight: 44, borderWidth: 1, borderColor: color.borderStrong, borderRadius: radius.md,
    paddingHorizontal: space.md, fontSize: font.sm, color: color.text, backgroundColor: color.surface,
  },
  askBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.ai, alignItems: 'center', justifyContent: 'center' },
  answer: { fontSize: font.sm, color: color.text, lineHeight: 20, marginTop: space.sm, backgroundColor: color.aiSoft,
    borderRadius: radius.md, padding: space.md },
  resultTitle: { fontSize: font.lg, fontWeight: weight.heavy, letterSpacing: -0.3 },
  meta: { fontSize: font.xs, color: color.textSecondary, lineHeight: 18, marginTop: 4 },
  waveBox: { backgroundColor: '#FFFFFF', borderRadius: radius.md, padding: space.md, marginTop: space.md },
  gaugeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.lg, marginTop: space.md },
  gaugeValue: { fontSize: font.lg, fontWeight: weight.heavy, marginTop: -30 },
  gaugeLabel: { fontSize: font.sm, fontWeight: weight.heavy, color: color.text },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  details: { backgroundColor: '#FFFFFF', borderRadius: radius.md, padding: space.md, marginTop: space.md, gap: 2 },
  detailsTitle: { fontSize: font.xs, fontWeight: weight.heavy, color: color.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4 },
  detailRow: { flexDirection: 'row', gap: space.md, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: color.surfaceMuted },
  detailLabel: { fontSize: font.sm, color: color.textSecondary },
  detailValue: { fontSize: font.sm, fontWeight: weight.heavy, color: color.text, textAlign: 'right' },
  detailNote: { fontSize: font.xs, color: color.textMuted, textAlign: 'right' },
});
