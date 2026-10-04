import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { useDeviceConnection } from '../../context/VitalsContext';
import { useClinical } from '../../context/ClinicalContext';
import { apiService } from '../../services/api';
import { focusName } from '../../services/consulta';
import { ClinicalAssessment } from '../../types/vitals';
import { color, font, space, weight } from '../../theme/tokens';
import { Banner, Button, Card, SectionHeader, StatusPill } from '../ui';
import { TriageCard } from '../TriageCard';
import { AssessmentView } from './AssessmentView';
import { RESULT_STYLE } from './RecorderPanel';
import { PlayButton } from '../PlayButton';
import { ListeningFilterBar } from '../ListeningFilterBar';
import { NewPatientModal } from '../NewPatientModal';

const SEVERITY = { critical: { label: 'Crítica', tone: 'danger' }, caution: { label: 'Precaución', tone: 'warning' }, info: { label: 'Informativa', tone: 'info' } } as const;

/** Paso 6: semáforo, valoración, alertas, grabaciones e informe. */
export const ResultStep: React.FC<{ onOpenAssistant: () => void; onNewPatient: () => void }> = ({ onOpenAssistant, onNewPatient }) => {
  const { currentSessionId } = useDeviceConnection();
  const { triage, recordings, alerts } = useClinical();
  const [assessment, setAssessment] = useState<ClinicalAssessment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const triageKey = `${triage?.nivel}|${triage?.motivos?.join('|')}|${recordings.length}`;

  useEffect(() => {
    let active = true;
    setAssessment(null); setLoadError(null);
    apiService.getClinicalAssessment(currentSessionId).then((value) => { if (active) setAssessment(value); })
      .catch((e) => { if (active) setLoadError(`No se pudo obtener la valoración: ${e?.message || e}`); });
    return () => { active = false; };
  }, [currentSessionId, triageKey]);

  const report = async () => {
    setGenerating(true); setReportError(null);
    try {
      const r = await apiService.createReportFor(currentSessionId);
      if (!mounted.current) return;
      const url = apiService.reportPdfUrl(r);
      setPdfUrl(url);
      Linking.openURL(url);
    } catch (e: any) {
      if (mounted.current) setReportError(`No se pudo generar el informe: ${e?.message || e}`);
    } finally {
      if (mounted.current) setGenerating(false);
    }
  };

  return (
    <View>
      <SectionHeader title="Resultado" subtitle="Orientación para decidir a quién referir. No es un diagnóstico." />
      <TriageCard triage={triage} />

      <View style={styles.actions}>
        <Button label="Informe PDF" icon="document-text-outline" onPress={report} loading={generating} style={styles.action} />
        <Button label="Preguntar al asistente" icon="chatbubbles-outline" variant="secondary" onPress={onOpenAssistant} style={styles.action} />
        <Button label="Terminar y nuevo paciente" icon="person-add-outline" variant="secondary" onPress={() => setShowNew(true)} style={styles.action} />
      </View>
      {reportError && <Banner tone="danger" text={reportError} />}
      {pdfUrl && (
        <Banner tone="success" title="Informe listo" text="Si no se abrió solo (el navegador puede bloquearlo), ábrelo aquí."
                action={<Button label="Abrir informe PDF" icon="open-outline" variant="ghost" onPress={() => Linking.openURL(pdfUrl)}
                                style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />} />
      )}

      {loadError && <Banner tone="danger" text={loadError} />}
      {!assessment && !loadError && <ActivityIndicator color={color.primary} style={{ marginVertical: space.lg }} />}
      {assessment && <AssessmentView assessment={assessment} showSummary={false} />}

      {alerts.length > 0 && (
        <Card>
          <Text style={styles.title}>Alertas de esta consulta</Text>
          {alerts.slice(0, 8).map((a) => {
            const s = SEVERITY[a.severity] || SEVERITY.info;
            return (
              <View key={a.id} style={styles.row}>
                <StatusPill label={s.label} tone={s.tone} />
                <Text style={styles.rowText} numberOfLines={2}>{a.title}</Text>
              </View>
            );
          })}
        </Card>
      )}

      {recordings.length > 0 && (
        <Card>
          <Text style={styles.title}>Grabaciones</Text>
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
        </Card>
      )}
      {recordings.some((r) => r.has_audio) && <ListeningFilterBar />}

      <NewPatientModal visible={showNew} onClose={() => setShowNew(false)} onCreated={onNewPatient} />
    </View>
  );
};

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginBottom: space.lg },
  action: { flexGrow: 1, flexBasis: 180 },
  title: { fontSize: font.md, fontWeight: weight.heavy, color: color.text, marginBottom: space.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm,
    borderTopWidth: 1, borderTopColor: color.border, minHeight: 52,
  },
  rowText: { flex: 1, fontSize: font.sm, color: color.text, fontWeight: weight.medium },
  rowMeta: { fontSize: font.xs, color: color.textMuted },
});
