import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useClinical } from '../../context/ClinicalContext';
import { apiService } from '../../services/api';
import { doneCount, focusStates, FOCUS_INFO, FOCUS_ORDER, nextFocus } from '../../services/consulta';
import { AuscultationFocus, AuscultationMode, HeartModelInfo } from '../../types/vitals';
import { color, font, space, weight } from '../../theme/tokens';
import { Button, Card, SectionHeader, SegmentedControl, StatusPill } from '../ui';
import { BodyMap, BodyView, viewOf } from '../BodyMap';
import { RecorderPanel, LungModelNotice, ResultCard } from './RecorderPanel';
import { ListeningFilterBar } from '../ListeningFilterBar';
import { AIExplainerModal } from '../AIExplainerModal';
import { Columns } from '../ResponsiveContainer';

const pct = (v?: number | null) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`);
const DATASET_NAMES: Record<string, string> = { both: 'CirCor 2022 + PhysioNet 2016', circor: 'CirCor 2022', physionet: 'PhysioNet 2016' };

const LEGEND: { label: string; bg: string; border: string }[] = [
  { label: 'Pendiente', bg: '#FFFFFF', border: color.primary },
  { label: 'Sin hallazgos', bg: color.success, border: color.success },
  { label: 'Posible anormal', bg: color.danger, border: color.danger },
  { label: 'Repetir', bg: color.warning, border: color.warning },
];

/** Pasos 4 y 5: dónde colocar el estetoscopio (dibujo del torso) y grabar cada foco. */
export const AuscultationStep: React.FC<{ mode: AuscultationMode; onNext: () => void; nextLabel: string }> = ({
  mode, onNext, nextLabel,
}) => {
  const { lastResult, recordings } = useClinical();
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
  // No se prepara solo: el médico confirma con "Preparar".
  const lastSeen = useRef(lastResult?.recording_id);
  useEffect(() => {
    if (!lastResult || lastResult.recording_id === lastSeen.current) return;
    lastSeen.current = lastResult.recording_id;
    if (lastResult.recording_id.startsWith('demo_') || !lastResult.location) return;
    if ((lastResult.mode === 'pulmon' ? 'pulmon' : 'corazon') !== mode) return;
    const ok = lastResult.result === 'normal' || lastResult.result === 'anormal';
    const next = ok ? nextFocus(mode, focusStates([lastResult, ...recordings], mode)) : (lastResult.location as AuscultationFocus);
    if (next) { setFocus(next); setView(viewOf(next)); }
  }, [lastResult, recordings, mode]);

  const select = (f: AuscultationFocus) => { setFocus(f); setView(viewOf(f)); };
  const showLast = !!lastResult && !!lastResult.location && lastResult.location !== focus
    && !lastResult.recording_id.startsWith('demo_') && (lastResult.mode === 'pulmon' ? 'pulmon' : 'corazon') === mode;
  const isHeart = mode === 'corazon';

  const mapCard = (
    <Card>
      <View style={styles.mapHead}>
        <Text style={styles.mapTitle}>{isHeart ? 'Focos del corazón' : 'Zonas del pulmón'}</Text>
        <StatusPill label={isHeart ? `${done}/4 grabados` : `${done} ${done === 1 ? 'zona' : 'zonas'}`}
                    tone={isHeart ? (done === 4 ? 'success' : 'primary') : done >= 1 ? 'success' : 'primary'} />
      </View>
      {!isHeart && (
        <View style={{ marginBottom: space.md }}>
          <SegmentedControl options={[{ label: 'Frente', value: 'front' as BodyView }, { label: 'Espalda', value: 'back' as BodyView }]}
                            value={view} onChange={setView} accessibilityLabel="Vista del torso" />
        </View>
      )}
      <BodyMap mode={mode} view={isHeart ? 'front' : view} states={states} selected={focus} onSelect={select} />
      <View style={styles.legend}>
        {LEGEND.map((l) => (
          <View key={l.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: l.bg, borderColor: l.border }]} />
            <Text style={styles.legendText}>{l.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.hint}>
        {isHeart ? 'Graba los 4 focos. ' : 'Graba al menos 1 zona; mejor izquierda y derecha. '}
        Toca un punto para elegirlo; al terminar cada grabación se elige el siguiente.
      </Text>
    </Card>
  );

  return (
    <View>
      <SectionHeader title={isHeart ? 'Corazón' : 'Pulmón'}
                     subtitle={isHeart ? 'Estetoscopio sobre la piel, en silencio; la persona no habla durante los 15 s.'
                       : 'La persona respira hondo por la boca durante toda la grabación.'} />
      {!isHeart && lungReady === false && <LungModelNotice />}
      <Columns leftWeight={0.85} left={mapCard} right={
        <View>
          {/* La grabación recién hecha sigue a la vista aunque ya se haya elegido el siguiente foco */}
          {showLast && lastResult && (
            <View>
              <Text style={styles.lastLabel}>Último resultado · {FOCUS_INFO[lastResult.location as AuscultationFocus]?.long}</Text>
              <ResultCard result={lastResult} />
            </View>
          )}
          <RecorderPanel key={focus} mode={mode} focus={focus} />
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

      <Button label={nextLabel} icon="arrow-forward" size="lg" full onPress={onNext} />
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
  mapHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  mapTitle: { flex: 1, fontSize: font.md, fontWeight: weight.heavy, color: color.text },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  legendText: { fontSize: font.xs, color: color.textSecondary },
  hint: { fontSize: font.xs, color: color.textMuted, marginTop: space.sm, lineHeight: 18 },
  modelHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36, cursor: 'pointer' as any },
  modelTitle: { flex: 1, fontSize: font.sm, fontWeight: weight.bold, color: color.text },
  metrics: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: space.sm },
  metric: { alignItems: 'center' },
  metricValue: { fontSize: font.lg, fontWeight: weight.heavy, color: color.ai },
  metricLabel: { fontSize: font.xs, color: color.textSecondary },
  note: { fontSize: font.xs, color: color.textSecondary, lineHeight: 18 },
  lastLabel: { fontSize: font.xs, fontWeight: weight.heavy, color: color.textMuted, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: space.sm },
});
