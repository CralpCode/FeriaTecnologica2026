import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking, RefreshControl } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { apiService } from '../services/api';
import { useVitals } from '../context/VitalsContext';
import { PlayButton } from '../components/PlayButton';
import { RecordingResult, ReportItem, SessionOverview, TriageLevel } from '../types/vitals';

const TRIAGE_COLOR: Record<TriageLevel, string> = {
  rojo: Colors.danger, amarillo: Colors.warning, verde: Colors.success, gris: Colors.textMuted,
};

const RESULT_TEXT: Record<string, { label: string; color: string }> = {
  normal: { label: 'Normal', color: Colors.success },
  anormal: { label: 'Anormal', color: Colors.danger },
  calidad_insuficiente: { label: 'Calidad insuficiente', color: Colors.warning },
  modelo_no_disponible: { label: 'Sin analizar', color: Colors.textSecondary },
  error: { label: 'Error', color: Colors.textSecondary },
};

const FOCUS: Record<string, string> = {
  AV: 'Aórtico', PV: 'Pulmonar', TV: 'Tricuspídeo', MV: 'Mitral', TC: 'Tráquea', AL: 'Ant. izq.',
  AR: 'Ant. der.', PL: 'Espalda izq.', PR: 'Espalda der.', LL: 'Costado izq.', LR: 'Costado der.',
};

const when = (iso?: string | null) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
};

/** Historial por paciente (cada sesión es un paciente): grabaciones, informes y semáforo. */
export const HistoryScreen: React.FC = () => {
  const { currentSessionId, switchSession } = useVitals();
  const [sessions, setSessions] = useState<SessionOverview[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions(await apiService.getHistory());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Historial de pacientes</Text>
        <TouchableOpacity onPress={load} style={styles.iconBtn}>
          <Ionicons name="refresh" size={18} color={Colors.primary} />
        </TouchableOpacity>
      </View>
      <Text style={styles.note}>Cada sesión corresponde a un paciente. Toca una para ver sus grabaciones e informes.</Text>

      {sessions === null && !error && <ActivityIndicator color={Colors.primary} style={{ marginTop: 24 }} />}
      {error && <Text style={styles.error}>No se pudo cargar el historial del servidor.</Text>}
      {sessions?.length === 0 && <Text style={styles.note}>Todavía no hay sesiones registradas.</Text>}

      {sessions?.map((s) => (
        <View key={s.session_id} style={[styles.card, s.session_id === currentSessionId && styles.cardCurrent]}>
          <TouchableOpacity style={styles.cardHeader} onPress={() => setOpen(open === s.session_id ? null : s.session_id)}>
            <View style={[styles.triageDot, { backgroundColor: TRIAGE_COLOR[s.triaje] || Colors.textMuted }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.sessionId}>
                {s.session_id}
                {s.session_id === currentSessionId ? '  · sesión actual' : ''}
              </Text>
              <Text style={styles.meta}>Última actividad: {when(s.last_seen)}</Text>
              <Text style={styles.meta}>
                {s.readings} lecturas · {s.recordings} grabaciones ({s.abnormal_recordings} anormales) · {s.alerts} alertas ·{' '}
                {s.reports} informes
              </Text>
            </View>
            <Ionicons name={open === s.session_id ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
          {open === s.session_id && (
            <SessionDetail
              session={s}
              isCurrent={s.session_id === currentSessionId}
              onOpenSession={() => switchSession(s.session_id)}
              onChanged={load}
            />
          )}
        </View>
      ))}
    </ScrollView>
  );
};

const SessionDetail: React.FC<{
  session: SessionOverview;
  isCurrent: boolean;
  onOpenSession: () => void;
  onChanged: () => void;
}> = ({ session, isCurrent, onOpenSession, onChanged }) => {
  const [recordings, setRecordings] = useState<RecordingResult[] | null>(null);
  const [reports, setReports] = useState<ReportItem[] | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(() => {
    apiService.getSessionRecordings(session.session_id).then(setRecordings).catch(() => setRecordings([]));
    apiService.listReports(session.session_id).then(setReports).catch(() => setReports([]));
  }, [session.session_id]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await apiService.createReportFor(session.session_id);
      Linking.openURL(apiService.reportPdfUrl(r));
      load();
      onChanged();
    } finally {
      setGenerating(false);
    }
  };

  return (
    <View style={styles.detail}>
      <Text style={styles.detailTitle}>Grabaciones</Text>
      {recordings === null && <ActivityIndicator color={Colors.primary} />}
      {recordings?.length === 0 && <Text style={styles.meta}>Sin grabaciones.</Text>}
      {recordings?.map((r) => {
        const t = RESULT_TEXT[r.result] || RESULT_TEXT.error;
        return (
          <View key={r.recording_id} style={styles.recRow}>
            <MaterialCommunityIcons
              name={r.mode === 'pulmon' ? 'lungs' : 'heart-pulse'}
              size={16}
              color={r.mode === 'pulmon' ? Colors.oxygen : Colors.heartRate}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.recText}>
                {FOCUS[r.location] || 'Sin foco'} · <Text style={{ color: t.color, fontWeight: '700' }}>{t.label}</Text>
                {r.probability !== null && r.probability !== undefined ? ` (${Math.round(r.probability * 100)} %)` : ''}
              </Text>
              <Text style={styles.meta}>
                {when(r.created_at)}
                {r.recording_id.startsWith('demo_') ? ' · caso de demostración' : ''}
              </Text>
            </View>
            {r.has_audio && <PlayButton url={apiService.recordingAudioUrl(r.recording_id)} />}
          </View>
        );
      })}

      <Text style={[styles.detailTitle, { marginTop: 10 }]}>Informes PDF</Text>
      {reports === null && <ActivityIndicator color={Colors.primary} />}
      {reports?.length === 0 && <Text style={styles.meta}>Sin informes todavía.</Text>}
      {reports?.map((rep) => (
        <TouchableOpacity
          key={rep.report_id}
          style={styles.reportRow}
          disabled={!rep.has_pdf}
          onPress={() => Linking.openURL(apiService.absoluteUrl(rep.pdf_url))}
        >
          <MaterialCommunityIcons name="file-pdf-box" size={20} color={rep.has_pdf ? Colors.danger : Colors.textMuted} />
          <Text style={styles.recText}>Informe #{rep.report_id} · {when(rep.created_at)}</Text>
          {rep.has_pdf && <Ionicons name="open-outline" size={16} color={Colors.primary} />}
        </TouchableOpacity>
      ))}

      <View style={styles.actions}>
        {!isCurrent && (
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.primary }]} onPress={onOpenSession}>
            <Ionicons name="enter-outline" size={16} color="#FFFFFF" />
            <Text style={styles.actionText}>Abrir sesión</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: Colors.aiPurple }]}
          onPress={generate}
          disabled={generating}
        >
          {generating ? <ActivityIndicator color="#FFFFFF" size="small" /> : <MaterialCommunityIcons name="file-document-outline" size={16} color="#FFFFFF" />}
          <Text style={styles.actionText}>{generating ? 'Redactando…' : 'Nuevo informe'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  iconBtn: { padding: 6 },
  note: { fontSize: 12, color: Colors.textSecondary, marginVertical: 8 },
  error: { fontSize: 13, color: Colors.danger, marginTop: 12 },
  card: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  cardCurrent: { borderColor: Colors.primary, borderWidth: 1.5 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  triageDot: { width: 14, height: 14, borderRadius: 7 },
  sessionId: { fontSize: 14, fontWeight: '800', color: Colors.textPrimary },
  meta: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
  detail: { borderTopWidth: 1, borderTopColor: Colors.border, padding: 12 },
  detailTitle: { fontSize: 13, fontWeight: '800', color: Colors.textPrimary, marginBottom: 6 },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  recText: { flex: 1, fontSize: 13, color: Colors.textPrimary },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    paddingVertical: 10,
  },
  actionText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
});
