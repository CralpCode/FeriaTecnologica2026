import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../ui/Text';
import { Ionicons } from '@expo/vector-icons';
import { useClinical } from '../../context/ClinicalContext';
import { apiService } from '../../services/api';
import { doneCount, focusStates, FOCUS_INFO, FOCUS_ORDER, nextFocus } from '../../services/consulta';
import { AuscultationFocus, AuscultationMode, HeartModelInfo } from '../../types/vitals';
import { color, font, radius, space, weight } from '../../theme/tokens';
import { Button, Card, FadeIn, ProgressRing, SectionHeader, SegmentedControl } from '../ui';
import { BodyMap, BodyView, FocusChips, HEART_FOCI, LANDMARKS, LUNG_FOCI, RecordingMark, STATE_STYLE, viewOf } from '../BodyMap';
import { RecorderPanel, LungModelNotice, ResultCard } from './RecorderPanel';
import { ListeningFilterBar } from '../ListeningFilterBar';
import { AIExplainerModal } from '../AIExplainerModal';
import { Columns } from '../ResponsiveContainer';
import { useStepAction } from './stepAction';

const pct = (v?: number | null) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`);
const DATASET_NAMES: Record<string, string> = { both: 'CirCor 2022 + PhysioNet 2016', circor: 'CirCor 2022', physionet: 'PhysioNet 2016' };

const LEGEND: { label: string; key: keyof typeof STATE_STYLE }[] = [
  { label: 'Pendiente', key: 'pendiente' }, { label: 'Sin hallazgos', key: 'normal' },
  { label: 'Posible anormal', key: 'anormal' }, { label: 'Repetir', key: 'repetir' },
];

/** Pasos 4 y 5: dónde colocar el estetoscopio (dibujo del torso) y grabar cada foco. */
export const AuscultationStep: React.FC<{ mode: AuscultationMode; onNext: () => void; nextLabel: string }> = ({
  mode, onNext, nextLabel,
}) => {
  const { lastResult, recordings, phase, armedLocation, recordingStartedAt } = useClinical();
  const [mapW, setMapW] = useState(0);
  const states = useMemo(() => focusStates([lastResult, ...recordings], mode), [lastResult, recordings, mode]);
  const [focus, setFocus] = useState<AuscultationFocus>(() => nextFocus(mode, states) || FOCUS_ORDER[mode][0]);
  const [view, setView] = useState<BodyView>(() => viewOf(focus));
  const [model, setModel] = useState<HeartModelInfo | null>(null);
  const [lungReady, setLungReady] = useState<boolean | null>(null);
  const [showModel, setShowModel] = useState(false);
  const [showExplainer, setShowExplainer] = useState(false);
  const done = doneCount(mode, states);

  useEffect(() => {
    if (mode === 'corazon') apiService.getHeartModelInfo().then(setModel).catch(() => setModel(null));
    else apiService.getModelsInfo().then((m) => {
      const p = m.pulmon || {};
      setLungReady(!!(p.lung_sounds_cnn?.loaded || p.lung_disease_cnn?.loaded || (p.modelo_base?.loaded && p.modelo_base?.extractor_listo)));
    }).catch(() => setLungReady(null));
  }, [mode]);

  // Al llegar un resultado de este modo se selecciona el siguiente foco pendiente (o el mismo si hay que repetir).
  // No se graba solo: el médico confirma con "Grabar" (el estetoscopio recibe la orden del servidor).
  const lastSeen = useRef(lastResult?.recording_id);
  useEffect(() => {
    if (phase === 'armed' || phase === 'recording' || !lastResult || lastResult.recording_id === lastSeen.current) return;
    lastSeen.current = lastResult.recording_id;
    if (lastResult.recording_id.startsWith('demo_') || !lastResult.location) return;
    if ((lastResult.mode === 'pulmon' ? 'pulmon' : 'corazon') !== mode) return;
    const ok = (lastResult.result === 'normal' || lastResult.result === 'anormal')
      && (lastResult.details as any)?.colocacion?.ok !== false;   // sin latidos claros: se queda para repetir
    const next = ok ? nextFocus(mode, focusStates([lastResult, ...recordings], mode)) : (lastResult.location as AuscultationFocus);
    if (next) { setFocus(next); setView(viewOf(next)); }
  }, [lastResult, recordings, mode]);

  const select = (f: AuscultationFocus) => { setFocus(f); setView(viewOf(f)); };
  useStepAction({ label: nextLabel, icon: 'arrow-forward', onPress: onNext });
  const showLast = !!lastResult && !!lastResult.location && lastResult.location !== focus
    && !lastResult.recording_id.startsWith('demo_') && (lastResult.mode === 'pulmon' ? 'pulmon' : 'corazon') === mode;
  const isHeart = mode === 'corazon';

  const mark: RecordingMark = armedLocation && (phase === 'armed' || phase === 'recording')
    ? { focus: armedLocation, phase, startedAt: recordingStartedAt } : null;
  const total = isHeart ? 4 : 7;
  const dual = !isHeart && mapW >= 520; // frente y espalda lado a lado si cabe
  const map = (v: BodyView) => (
    <BodyMap mode={mode} view={v} states={states} selected={focus} onSelect={select} recording={mark}
             maxWidth={dual ? 300 : 400} />
  );

  const mapCard = (
    <Card elevated>
      <View style={styles.mapHead}>
        <ProgressRing value={done / (isHeart ? 4 : 1)} size={40} tint={color.success}
                      accessibilityLabel={isHeart ? `${done} de 4 focos grabados` : `${done} zonas grabadas`}>
          <Text style={styles.ringText}>{done}</Text>
        </ProgressRing>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.mapTitle}>{isHeart ? 'Focos del corazón' : 'Zonas del pulmón'}</Text>
          <Text style={styles.mapSub}>
            {isHeart ? `${done} de 4 grabados` : `${done} de ${total} zonas · mínimo 1, mejor izquierda y derecha`}
          </Text>
        </View>
        {!isHeart && !dual && (
          <SegmentedControl options={[{ label: 'Frente', value: 'front' as BodyView }, { label: 'Espalda', value: 'back' as BodyView }]}
                            value={view} onChange={setView} accessibilityLabel="Vista del torso" />
        )}
      </View>
      <View onLayout={(e) => setMapW(e.nativeEvent.layout.width)}>
        {dual ? (
          <View style={styles.dual}>
            <View style={{ flex: 1 }}><Text style={styles.viewTitle}>Frente</Text>{map('front')}</View>
            <View style={{ flex: 1 }}><Text style={styles.viewTitle}>Espalda</Text>{map('back')}</View>
          </View>
        ) : (
          <FadeIn trigger={view}>{map(isHeart ? 'front' : view)}</FadeIn>
        )}
      </View>
      <View style={styles.landmark}>
        <Ionicons name="locate" size={18} color={color.primary} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.landmarkTitle}>{focus} · {FOCUS_INFO[focus].long}</Text>
          <Text style={styles.landmarkText}>{LANDMARKS[focus].text}</Text>
        </View>
      </View>
      <FocusChips foci={isHeart ? HEART_FOCI : LUNG_FOCI} states={states} selected={focus} onSelect={select} />
      <View style={styles.legend}>
        {LEGEND.map((l) => (
          <View key={l.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: STATE_STYLE[l.key].bg, borderColor: STATE_STYLE[l.key].border }]} />
            <Text style={styles.legendText}>{l.label}</Text>
          </View>
        ))}
      </View>
    </Card>
  );

  return (
    <View>
      <SectionHeader title={isHeart ? 'Corazón' : 'Pulmón'}
                     subtitle={isHeart ? 'Estetoscopio sobre la piel, en silencio; la persona no habla durante los 15 s.'
                       : 'La persona respira hondo por la boca durante toda la grabación.'} />
      {!isHeart && lungReady === false && <LungModelNotice />}
      <Columns leftWeight={isHeart ? 0.95 : 1.15} left={mapCard} right={
        <View>
          {/* La grabación recién hecha sigue a la vista aunque ya se haya elegido el siguiente foco */}
          {showLast && lastResult && (
            <View>
              <Text style={styles.lastLabel}>Último resultado · {FOCUS_INFO[lastResult.location as AuscultationFocus]?.long}</Text>
              <ResultCard result={lastResult} />
            </View>
          )}
          <RecorderPanel mode={mode} focus={focus} />
        </View>
      } />

      {recordings.some((r) => r.has_audio) && <ListeningFilterBar mode={mode} />}

      {isHeart && model?.loaded && model.metricas_prueba && (
        <Card>
          <TouchableOpacity style={styles.modelHead} onPress={() => setShowModel((v) => !v)} accessibilityRole="button"
                            accessibilityState={{ expanded: showModel }}>
            <Ionicons name="analytics-outline" size={18} color={color.ai} />
            <Text style={styles.modelTitle}>¿Qué tan confiable es la IA del corazón?</Text>
            <Ionicons name={showModel ? 'chevron-up' : 'chevron-down'} size={18} color={color.textMuted} />
          </TouchableOpacity>
          {showModel && (
            <View style={{ marginTop: space.md }}>
              <View style={styles.metrics}>
                <Metric label="Sensibilidad" value={pct(model.metricas_prueba.sensibilidad)} />
                <Metric label="Especificidad" value={pct(model.metricas_prueba.especificidad)} />
                <Metric label="AUC" value={model.metricas_prueba.auc.toFixed(2)} />
              </View>
              <Text style={styles.note}>
                Red entrenada con {DATASET_NAMES[model.dataset || ''] || model.dataset} · {model.metricas_prueba.n} grabaciones de prueba no vistas al entrenar.
              </Text>
              {model.limitaciones?.map((l, i) => <Text key={i} style={styles.note}>• {l}</Text>)}
              <Button label="¿Cómo funciona la IA?" variant="ghost" icon="information-circle-outline" onPress={() => setShowExplainer(true)}
                      style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
            </View>
          )}
        </Card>
      )}

      <AIExplainerModal visible={showExplainer} onClose={() => setShowExplainer(false)} />
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
  mapHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md, flexWrap: 'wrap' },
  mapTitle: { fontSize: font.md, fontWeight: weight.heavy, color: color.text },
  mapSub: { fontSize: font.xs, color: color.textMuted, marginTop: 2 },
  ringText: { fontSize: font.sm, fontWeight: weight.heavy, color: color.text },
  dual: { flexDirection: 'row', gap: space.md },
  viewTitle: { fontSize: font.xs, fontWeight: weight.heavy, color: color.textMuted, textAlign: 'center', letterSpacing: 0.6,
    textTransform: 'uppercase', marginBottom: space.xs },
  landmark: {
    flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: color.primarySoft, borderRadius: radius.md,
    borderWidth: 1, borderColor: color.primaryBorder, padding: space.md, marginTop: space.sm,
  },
  landmarkTitle: { fontSize: font.sm, fontWeight: weight.heavy, color: color.primary },
  landmarkText: { fontSize: font.sm, color: color.text, lineHeight: 20, marginTop: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  legendText: { fontSize: font.xs, color: color.textSecondary },
  modelHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36, cursor: 'pointer' as any },
  modelTitle: { flex: 1, fontSize: font.sm, fontWeight: weight.bold, color: color.text },
  metrics: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: space.sm },
  metric: { alignItems: 'center' },
  metricValue: { fontSize: font.lg, fontWeight: weight.heavy, color: color.ai },
  metricLabel: { fontSize: font.xs, color: color.textSecondary },
  note: { fontSize: font.xs, color: color.textSecondary, lineHeight: 18 },
  lastLabel: { fontSize: font.xs, fontWeight: weight.heavy, color: color.textMuted, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: space.sm },
});
