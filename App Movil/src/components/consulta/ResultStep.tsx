import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { Ionicons } from '@expo/vector-icons';
import { useVitals } from '../../context/VitalsContext';
import { useClinical } from '../../context/ClinicalContext';
import { apiService } from '../../services/api';
import { focusName, focusStates } from '../../services/consulta';
import { AuscultationFocus, AuscultationMode, ClinicalAssessment, RecordingResult } from '../../types/vitals';
import { useLayout } from '../../hooks/useLayout';
import { color, font, radius, space, weight } from '../../theme/tokens';
import { Banner, Button, Card, EmptyState, SectionHeader, Skeleton, StatusPill } from '../ui';
import { TriageCard } from '../TriageCard';
import { BodyMap } from '../BodyMap';
import { AssessmentView } from './AssessmentView';
import { RESULT_STYLE, ResultCard } from './RecorderPanel';
import { PlayButton } from '../PlayButton';
import { ListeningFilterBar } from '../ListeningFilterBar';
import { NewPatientModal } from '../NewPatientModal';
import { useStepAction } from './stepAction';
import { NotesCard } from './NotesCard';

const SEVERITY = { critical: { label: 'Crítica', tone: 'danger' }, caution: { label: 'Precaución', tone: 'warning' }, info: { label: 'Informativa', tone: 'info' } } as const;
const modeOf = (r: RecordingResult): AuscultationMode => (r.mode === 'pulmon' ? 'pulmon' : 'corazon');

/** Paso 6: semáforo, mapa de hallazgos, valoración, alertas, grabaciones e informe. */
export const ResultStep: React.FC<{
  onOpenAssistant: () => void; onNewPatient: () => void; onGoToStep?: (step: number) => void;
}> = ({ onOpenAssistant, onNewPatient, onGoToStep }) => {
  const { currentSessionId } = useVitals();
  const { triage, recordings, alerts, lastResult } = useClinical();
  const { isPhone } = useLayout();
  const [assessment, setAssessment] = useState<ClinicalAssessment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<{ focus: AuscultationFocus; mode: AuscultationMode } | null>(null);
  const triageKey = `${triage?.nivel}|${triage?.motivos?.join('|')}|${recordings.length}`;

  useEffect(() => {
    setLoadError(null);
    apiService.getClinicalAssessment(currentSessionId).then(setAssessment)
      .catch((e) => setLoadError(`No se pudo obtener la valoración: ${e?.message || e}`));
  }, [currentSessionId, triageKey]);

  const all = useMemo(() => [lastResult, ...recordings], [lastResult, recordings]);
  const heart = useMemo(() => focusStates(all, 'corazon'), [all]);
  const lung = useMemo(() => focusStates(all, 'pulmon'), [all]);
  const own = recordings.filter((r) => !r.recording_id.startsWith('demo_') && r.location);
  const pickedRec = picked
    ? all.find((r) => r && r.location === picked.focus && modeOf(r) === picked.mode && !r.recording_id.startsWith('demo_')) || null
    : null;

  const report = async () => {
    setGenerating(true); setReportError(null);
    try {
      const r = await apiService.createReportFor(currentSessionId);
      const url = apiService.reportPdfUrl(r);
      setPdfUrl(url);
      Linking.openURL(url);
    } catch (e: any) {
      setReportError(`No se pudo generar el informe: ${e?.message || e}`);
    } finally {
      setGenerating(false);
    }
  };
  // En celular el informe va en la barra fija de abajo; en pantallas grandes, arriba junto a las demás acciones
  useStepAction(isPhone ? { label: 'Informe PDF', icon: 'document-text-outline', onPress: report, loading: generating } : null);

  return (
    <View>
      <SectionHeader title="Resultado" subtitle="Orientación para decidir a quién referir. No es un diagnóstico." />
      <TriageCard triage={triage} />

      <View style={styles.actions}>
        {!isPhone && <Button label="Informe PDF" icon="document-text-outline" onPress={report} loading={generating} style={styles.action} />}
        <Button label="Preguntar al asistente" icon="chatbubbles-outline" variant="secondary" onPress={onOpenAssistant} style={styles.action} />
        <Button label="Terminar y nuevo paciente" icon="person-add-outline" variant="secondary" onPress={() => setShowNew(true)} style={styles.action} />
      </View>
      {reportError && <Banner tone="danger" text={reportError} />}
      {pdfUrl && (
        <Banner tone="success" title="Informe listo" text="Si no se abrió solo (el navegador puede bloquearlo), ábrelo aquí."
                action={<Button label="Abrir informe PDF" icon="open-outline" variant="ghost" onPress={() => Linking.openURL(pdfUrl)}
                                style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />} />
      )}

      {/* Mapa de hallazgos: cada foco con el color de su último resultado */}
      <Card elevated>
        <View style={styles.mapHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>Mapa de hallazgos</Text>
            <Text style={styles.sub}>Toca un foco grabado para ver y escuchar su resultado.</Text>
          </View>
        </View>
        {own.length === 0 ? (
          <EmptyState compact icon="stethoscope" title="Todavía no hay grabaciones de esta persona"
                      text="Graba los focos del corazón y al menos una zona del pulmón."
                      action={onGoToStep && (
                        <View style={styles.emptyActions}>
                          <Button label="Ir a corazón" size="sm" variant="secondary" onPress={() => onGoToStep(3)} />
                          <Button label="Ir a pulmón" size="sm" variant="secondary" onPress={() => onGoToStep(4)} />
                        </View>
                      )} />
        ) : (
          <View style={styles.maps}>
            <MiniMap title="Corazón" mode="corazon" view="front" states={heart} picked={picked} onPick={setPicked} />
            <MiniMap title="Pulmón · frente" mode="pulmon" view="front" states={lung} picked={picked} onPick={setPicked} />
            <MiniMap title="Pulmón · espalda" mode="pulmon" view="back" states={lung} picked={picked} onPick={setPicked} />
          </View>
        )}
        {picked && !pickedRec && (
          <Text style={styles.sub}>{focusName(picked.focus)}: sin grabación en los últimos 30 minutos.</Text>
        )}
      </Card>
      {pickedRec && <ResultCard result={pickedRec} />}

      {loadError && <Banner tone="danger" text={loadError} />}
      {!assessment && !loadError && (
        <View style={{ gap: space.sm, marginBottom: space.lg }}>
          <Skeleton height={60} radius={radius.lg} /><Skeleton height={60} radius={radius.lg} />
        </View>
      )}
      {assessment && <AssessmentView assessment={assessment} showSummary={false} onGoToStep={onGoToStep} />}

      <NotesCard sessionId={currentSessionId} />

      {alerts.length > 0 && (
        <Card>
          <Text style={styles.title}>Alertas de esta consulta</Text>
          {alerts.slice(0, 8).map((a) => {
            const s = SEVERITY[a.severity] || SEVERITY.info;
            return (
              <View key={a.id} style={styles.row}>
                <StatusPill label={s.label} tone={s.tone} dot />
                <Text style={styles.rowText} numberOfLines={2}>{a.title}</Text>
              </View>
            );
          })}
        </Card>
      )}

      {recordings.length > 0 && (
        <Card padded={false}>
          <Pressable onPress={() => setShowAll((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showAll }}
                     style={(s: any) => [styles.allHead, s.hovered && { backgroundColor: color.surfaceMuted }]}>
            <Ionicons name="musical-notes-outline" size={18} color={color.primary} />
            <Text style={[styles.title, { flex: 1, marginBottom: 0 }]}>Todas las grabaciones ({recordings.length})</Text>
            <Ionicons name={showAll ? 'chevron-up' : 'chevron-down'} size={18} color={color.textMuted} />
          </Pressable>
          {showAll && (
            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
              {recordings.map((r) => {
                const s = RESULT_STYLE[r.result] || RESULT_STYLE.error;
                return (
                  <View key={r.recording_id} style={styles.row}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowText} numberOfLines={1}>{focusName(r.location)}</Text>
                      <Text style={styles.rowMeta}>{r.mode === 'pulmon' ? 'Pulmón' : 'Corazón'}
                        {r.recording_id.startsWith('demo_') ? ' · caso de demostración' : ''}</Text>
                    </View>
                    <StatusPill label={s.label} tone={s.tone} />
                    {r.has_audio && <PlayButton url={apiService.recordingAudioUrl(r.recording_id)} mode={r.mode} />}
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      )}
      {recordings.some((r) => r.has_audio) && <ListeningFilterBar />}

      <NewPatientModal visible={showNew} onClose={() => setShowNew(false)} onCreated={onNewPatient} />
    </View>
  );
};

const MiniMap: React.FC<{
  title: string; mode: AuscultationMode; view: 'front' | 'back'; states: Record<string, any>;
  picked: { focus: AuscultationFocus; mode: AuscultationMode } | null;
  onPick: (p: { focus: AuscultationFocus; mode: AuscultationMode }) => void;
}> = ({ title, mode, view, states, picked, onPick }) => (
  <View style={styles.mini}>
    <Text style={styles.miniTitle}>{title}</Text>
    <BodyMap mode={mode} view={view} states={states} selected={picked?.mode === mode ? picked.focus : null}
             onSelect={(f) => onPick({ focus: f, mode })} maxWidth={300} showLandmarks={false} />
  </View>
);

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginBottom: space.lg },
  action: { flexGrow: 1, flexBasis: 200 },
  mapHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  title: { fontSize: font.md, fontWeight: weight.heavy, color: color.text, marginBottom: space.sm },
  sub: { fontSize: font.xs, color: color.textMuted, marginTop: -4 },
  maps: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'center' },
  mini: { flexGrow: 1, flexBasis: 240, maxWidth: 300 },
  miniTitle: { fontSize: font.xs, fontWeight: weight.heavy, color: color.textMuted, textAlign: 'center', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: space.xs },
  emptyActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  allHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.lg, borderRadius: radius.lg, cursor: 'pointer' as any },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm,
    borderTopWidth: 1, borderTopColor: color.border, minHeight: 52,
  },
  rowText: { flex: 1, fontSize: font.sm, color: color.text, fontWeight: weight.medium },
  rowMeta: { fontSize: font.xs, color: color.textMuted },
});
