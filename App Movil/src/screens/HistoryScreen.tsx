import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../components/ui/Text';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { apiService } from '../services/api';
import { useDeviceConnection } from '../context/VitalsContext';
import { PlayButton } from '../components/PlayButton';
import { ListeningFilterBar } from '../components/ListeningFilterBar';
import { RecordingResult, ReportItem, SessionOverview, TriageLevel } from '../types/vitals';
import { Centered, Columns } from '../components/ResponsiveContainer';
import { useLayout } from '../hooks/useLayout';
import { focusName, isNamedPatient, patientLabel, relativeTime } from '../services/consulta';
import { RESULT_STYLE } from '../components/consulta/RecorderPanel';
import { color, font, radius, space, tabular, weight } from '../theme/tokens';
import {
  Avatar, Banner, Button, Card, EmptyState, IconButton, ListItem, SectionHeader, Skeleton, SkeletonList, StatusPill,
} from '../components/ui';

const LEVEL: Record<TriageLevel, { label: string; tone: 'danger' | 'warning' | 'success' | 'neutral'; dot: string }> = {
  rojo: { label: 'Rojo', tone: 'danger', dot: color.danger },
  amarillo: { label: 'Amarillo', tone: 'warning', dot: color.warning },
  verde: { label: 'Verde', tone: 'success', dot: color.success },
  gris: { label: 'Sin datos', tone: 'neutral', dot: color.textMuted },
};
const FILTERS: (TriageLevel | 'todos')[] = ['todos', 'rojo', 'amarillo', 'verde', 'gris'];

const when = (iso?: string | null) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
};
const nameOf = (sid: string) => (isNamedPatient(sid) ? patientLabel(sid) : sid);
const summary = (s: SessionOverview) => {
  const parts = [relativeTime(s.last_seen)];
  parts.push(`${s.recordings} ${s.recordings === 1 ? 'grabación' : 'grabaciones'}${s.abnormal_recordings ? ` (${s.abnormal_recordings} anormal${s.abnormal_recordings === 1 ? '' : 'es'})` : ''}`);
  if (s.reports) parts.push(`${s.reports} ${s.reports === 1 ? 'informe' : 'informes'}`);
  if (s.active_alerts) parts.push(`${s.active_alerts} ${s.active_alerts === 1 ? 'alerta' : 'alertas'}`);
  return parts.filter(Boolean).join(' · ');
};

/** Historial por paciente (cada sesión es un paciente): grabaciones, informes, semáforo y archivo. */
export const HistoryScreen: React.FC<{ onOpenConsulta?: () => void }> = ({ onOpenConsulta }) => {
  const { currentSessionId, switchSession } = useDeviceConnection();
  const [sessions, setSessions] = useState<SessionOverview[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<TriageLevel | 'todos'>('todos');
  const [archivedView, setArchivedView] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { twoColumns } = useLayout();
  const requestSequence = useRef(0);
  const currentArchivedView = useRef(archivedView);
  currentArchivedView.current = archivedView;

  const load = useCallback(async () => {
    // An archive action may finish after the user switches the list view.
    if (archivedView !== currentArchivedView.current) return;
    const request = ++requestSequence.current;
    try {
      const result = await apiService.getHistory(archivedView);
      if (request !== requestSequence.current || archivedView !== currentArchivedView.current) return;
      setSessions(result);
      setError(false);
    } catch {
      if (request === requestSequence.current && archivedView === currentArchivedView.current) setError(true);
    }
  }, [archivedView]);

  useEffect(() => {
    setSessions(null); setOpen(null); load();
    return () => { ++requestSequence.current; };
  }, [load]);

  const q = query.trim().toLowerCase();
  const visible = (sessions || []).filter((x) =>
    (level === 'todos' || x.triaje === level)
    && (!q || x.session_id.toLowerCase().includes(q) || patientLabel(x.session_id).toLowerCase().includes(q)));

  // En pantalla ancha siempre hay un paciente seleccionado para el panel de detalle
  useEffect(() => {
    if (twoColumns && visible.length && !visible.some((x) => x.session_id === open)) setOpen(visible[0].session_id);
  }, [twoColumns, open, visible]);

  const selected = sessions?.find((x) => x.session_id === open) || null;

  const toggleArchive = async (s: SessionOverview) => {
    try {
      if (s.archived) await apiService.unarchiveSession(s.session_id);
      else await apiService.archiveSession(s.session_id);
      setNotice(s.archived ? `${nameOf(s.session_id)} volvió a la lista.`
        : `${nameOf(s.session_id)} se archivó: ya no aparece en las listas. Sus datos no se borraron; puedes restaurarlo en "Archivados".`);
      setOpen(null);
      load();
    } catch (e: any) {
      setNotice(`No se pudo cambiar: ${e?.message || e}`);
    }
  };

  const detail = (s: SessionOverview) => (
    <SessionDetail
      key={s.session_id}
      session={s}
      isCurrent={s.session_id === currentSessionId}
      onOpenSession={() => { switchSession(s.session_id); onOpenConsulta?.(); }}
      onArchive={() => toggleArchive(s)}
      onChanged={load}
    />
  );

  const list = (
    <View>
      <SectionHeader title={archivedView ? 'Pacientes archivados' : 'Historial de pacientes'}
                     subtitle={archivedView ? 'Ocultos de las listas; sus datos siguen guardados.' : 'Cada sesión corresponde a un paciente.'}
                     right={<IconButton icon="refresh" accessibilityLabel="Actualizar" onPress={load} />} />
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={color.textMuted} />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Buscar por código (p. ej. P017)"
                   placeholderTextColor={color.textMuted} autoCapitalize="characters" accessibilityLabel="Buscar paciente por código" />
        {!!query && <IconButton icon="close" size={32} accessibilityLabel="Borrar búsqueda" onPress={() => setQuery('')} style={{ borderWidth: 0 }} />}
      </View>
      <View style={styles.filters}>
        {FILTERS.map((lv) => (
          <Chip key={lv} active={level === lv} onPress={() => setLevel(lv)} dot={lv === 'todos' ? undefined : LEVEL[lv].dot}
                label={lv === 'todos' ? 'Todos' : LEVEL[lv].label} />
        ))}
        <Chip active={archivedView} onPress={() => setArchivedView((v) => !v)} icon="archive-outline" label="Archivados" />
      </View>
      {notice && <Banner tone="info" text={notice} />}

      {sessions === null && !error && <SkeletonList rows={5} />}
      {error && <Banner tone="danger" text="No se pudo cargar el historial del servidor." />}
      {sessions?.length === 0 && (
        <EmptyState icon={archivedView ? 'archive-outline' : 'account-clock-outline'} tone="neutral"
                    title={archivedView ? 'No hay pacientes archivados' : 'Todavía no hay pacientes'}
                    text={archivedView ? undefined : 'Cuando registres una consulta aparecerá aquí.'} />
      )}
      {sessions && sessions.length > 0 && visible.length === 0 && (
        <EmptyState compact icon="magnify" tone="neutral" title="Ningún paciente coincide con la búsqueda" />
      )}

      <View style={{ gap: space.sm }}>
        {visible.map((s) => {
          const lv = LEVEL[s.triaje] || LEVEL.gris;
          const isOpen = open === s.session_id;
          const current = s.session_id === currentSessionId;
          return (
            <View key={s.session_id}>
              <ListItem
                title={nameOf(s.session_id)}
                subtitle={summary(s)}
                selected={isOpen}
                left={<Avatar label={nameOf(s.session_id)} size={40} muted={!isNamedPatient(s.session_id)} />}
                right={(
                  <View style={styles.rightPills}>
                    {current && <StatusPill label="Abierto" tone="primary" />}
                    <StatusPill label={lv.label} tone={lv.tone} dot />
                  </View>
                )}
                accessibilityLabel={`${nameOf(s.session_id)}. Semáforo ${lv.label}. ${summary(s)}`}
                onPress={() => setOpen(twoColumns ? s.session_id : isOpen ? null : s.session_id)}
              />
              {!twoColumns && isOpen && <Card style={styles.inlineDetail}>{detail(s)}</Card>}
            </View>
          );
        })}
      </View>
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Centered>
        <Columns
          left={list}
          right={twoColumns && selected ? <Card elevated style={styles.detailPanel}>{detail(selected)}</Card> : null}
        />
      </Centered>
    </ScrollView>
  );
};

const Chip: React.FC<{ label: string; active: boolean; onPress: () => void; dot?: string; icon?: React.ComponentProps<typeof Ionicons>['name'] }> = ({
  label, active, onPress, dot, icon,
}) => (
  <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}
             style={(s: any) => [styles.chip, s.hovered && !active && { backgroundColor: color.surfaceMuted }, active && styles.chipActive]}>
    {dot && <View style={[styles.chipDot, { backgroundColor: dot }]} />}
    {icon && <Ionicons name={icon} size={14} color={active ? color.primary : color.textSecondary} />}
    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
  </Pressable>
);

const SessionDetail: React.FC<{
  session: SessionOverview;
  isCurrent: boolean;
  onOpenSession: () => void;
  onArchive: () => void;
  onChanged: () => void;
}> = ({ session, isCurrent, onOpenSession, onArchive, onChanged }) => {
  const [recordings, setRecordings] = useState<RecordingResult[] | null>(null);
  const [reports, setReports] = useState<ReportItem[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const lv = LEVEL[session.triaje] || LEVEL.gris;

  const load = useCallback(() => {
    apiService.getSessionRecordings(session.session_id).then(setRecordings).catch(() => setRecordings([]));
    apiService.listReports(session.session_id).then(setReports).catch(() => setReports([]));
  }, [session.session_id]);

  useEffect(() => { load(); }, [load]);

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
    <View>
      <View style={styles.detailHead}>
        <Avatar label={nameOf(session.session_id)} size={48} muted={!isNamedPatient(session.session_id)} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.detailName} numberOfLines={1}>{nameOf(session.session_id)}</Text>
          <Text style={styles.meta}>Última actividad: {when(session.last_seen)}</Text>
        </View>
        <StatusPill label={lv.label} tone={lv.tone} dot />
      </View>

      <View style={styles.stats}>
        <Stat value={session.readings} label="lecturas" />
        <Stat value={session.recordings} label="grabaciones" />
        <Stat value={session.abnormal_recordings} label="anormales" tint={session.abnormal_recordings ? color.danger : undefined} />
        <Stat value={session.alerts} label="alertas" />
      </View>

      <View style={styles.actions}>
        {!isCurrent && !session.archived && <Button label="Abrir consulta" icon="enter-outline" onPress={onOpenSession} style={styles.action} />}
        <Button label={generating ? 'Redactando…' : 'Nuevo informe'} icon="document-text-outline" variant="ai" onPress={generate}
                loading={generating} style={styles.action} />
      </View>

      <Text style={styles.detailTitle}>Grabaciones</Text>
      {recordings === null && <View style={{ gap: space.sm }}><Skeleton height={44} /><Skeleton height={44} /></View>}
      {recordings?.length === 0 && <Text style={styles.meta}>Sin grabaciones.</Text>}
      {recordings?.map((r) => {
        const st = RESULT_STYLE[r.result] || RESULT_STYLE.error;
        return (
          <View key={r.recording_id} style={styles.recRow}>
            <View style={[styles.recIcon, { backgroundColor: r.mode === 'pulmon' ? Colors.oxygenSoft : Colors.heartRateSoft }]}>
              <MaterialCommunityIcons name={r.mode === 'pulmon' ? 'lungs' : 'heart-pulse'} size={16}
                                      color={r.mode === 'pulmon' ? Colors.oxygen : Colors.heartRate} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.recText} numberOfLines={1}>{focusName(r.location)}</Text>
              <Text style={styles.meta}>
                {when(r.created_at)}
                {r.probability !== null && r.probability !== undefined ? ` · salida ${Math.round(r.probability * 100)} %` : ''}
                {r.recording_id.startsWith('demo_') ? ' · caso de demostración' : ''}
              </Text>
            </View>
            <StatusPill label={st.label} tone={st.tone} />
            {r.has_audio && <PlayButton url={apiService.recordingAudioUrl(r.recording_id)} mode={r.mode} />}
          </View>
        );
      })}
      {recordings?.some((r) => r.has_audio) && <View style={{ marginTop: space.sm }}><ListeningFilterBar /></View>}

      <Text style={[styles.detailTitle, { marginTop: space.lg }]}>Informes PDF</Text>
      {reports === null && <Skeleton height={36} />}
      {reports?.length === 0 && <Text style={styles.meta}>Sin informes todavía.</Text>}
      {reports?.map((rep) => (
        <Pressable key={rep.report_id} disabled={!rep.has_pdf} accessibilityRole="link"
                   onPress={() => Linking.openURL(apiService.absoluteUrl(rep.pdf_url))}
                   style={(s: any) => [styles.reportRow, s.hovered && rep.has_pdf && { backgroundColor: color.surfaceMuted }]}>
          <MaterialCommunityIcons name="file-pdf-box" size={22} color={rep.has_pdf ? color.danger : color.textMuted} />
          <Text style={styles.recText}>Informe #{rep.report_id} · {when(rep.created_at)}</Text>
          {rep.has_pdf && <Ionicons name="open-outline" size={16} color={color.primary} />}
        </Pressable>
      ))}

      {!isCurrent && (
        <View style={styles.archiveRow}>
          <Button label={session.archived ? 'Restaurar a la lista' : 'Archivar'} variant="ghost"
                  icon={session.archived ? 'arrow-undo-outline' : 'archive-outline'} onPress={onArchive} size="sm" />
          {!session.archived && <Text style={styles.archiveHint}>Lo oculta de las listas; no borra nada.</Text>}
        </View>
      )}
    </View>
  );
};

const Stat: React.FC<{ value: number; label: string; tint?: string }> = ({ value, label, tint }) => (
  <View style={styles.stat}>
    <Text style={[styles.statValue, tabular, tint ? { color: tint } : null]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.lg, paddingBottom: space.xxl },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 46, paddingHorizontal: space.md,
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderStrong, borderRadius: radius.md,
  },
  searchInput: { flex: 1, fontSize: font.sm, color: color.text, minHeight: 42 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginVertical: space.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill,
    borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, cursor: 'pointer' as any,
  },
  chipActive: { backgroundColor: color.primarySoft, borderColor: color.primary },
  chipDot: { width: 10, height: 10, borderRadius: 5 },
  chipText: { fontSize: font.xs, fontWeight: weight.bold, color: color.textSecondary },
  chipTextActive: { color: color.primary },
  rightPills: { flexDirection: 'row', gap: space.xs, alignItems: 'center' },
  inlineDetail: { marginTop: space.sm, marginBottom: 0 },
  detailPanel: { marginTop: 0 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  detailName: { fontSize: font.lg, fontWeight: weight.heavy, color: color.text, letterSpacing: -0.3 },
  meta: { fontSize: font.xs, color: color.textSecondary, lineHeight: 17 },
  stats: { flexDirection: 'row', marginTop: space.lg, paddingVertical: space.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: color.border },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: font.lg, fontWeight: weight.heavy, color: color.text },
  statLabel: { fontSize: font.xs, color: color.textMuted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg, marginBottom: space.lg },
  action: { flexGrow: 1, flexBasis: 160 },
  detailTitle: { fontSize: font.xs, fontWeight: weight.heavy, color: color.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: space.sm },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.surfaceMuted },
  recIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  recText: { flex: 1, fontSize: font.sm, color: color.text, fontWeight: weight.medium },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, borderRadius: radius.sm, paddingHorizontal: 4, cursor: 'pointer' as any },
  archiveRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg, paddingTop: space.md, borderTopWidth: 1, borderTopColor: color.border, flexWrap: 'wrap' },
  archiveHint: { fontSize: font.xs, color: color.textMuted },
});
