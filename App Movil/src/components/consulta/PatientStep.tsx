import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { useVitals } from '../../context/VitalsContext';
import { apiService } from '../../services/api';
import { isNamedPatient, patientLabel, relativeTime } from '../../services/consulta';
import { SessionOverview } from '../../types/vitals';
import { color, font, space, tabular, weight } from '../../theme/tokens';
import { Avatar, Button, Card, EmptyState, ListItem, SectionHeader, SkeletonList, StatusPill } from '../ui';
import { NewPatientModal } from '../NewPatientModal';
import { useStepAction } from './stepAction';

const LEVEL: Record<string, { label: string; tone: 'danger' | 'warning' | 'success' | 'neutral' }> = {
  rojo: { label: 'Rojo', tone: 'danger' }, amarillo: { label: 'Amarillo', tone: 'warning' },
  verde: { label: 'Verde', tone: 'success' }, gris: { label: 'Sin datos', tone: 'neutral' },
};

const summary = (r: SessionOverview) => {
  const parts = [relativeTime(r.last_seen)];
  if (r.external_readings) parts.push(`${r.external_readings} ${r.external_readings === 1 ? 'lectura externa' : 'lecturas externas'}`);
  if (r.recordings) parts.push(`${r.recordings} ${r.recordings === 1 ? 'grabación' : 'grabaciones'}${r.abnormal_recordings ? ` (${r.abnormal_recordings} anormal${r.abnormal_recordings === 1 ? '' : 'es'})` : ''}`);
  if (r.reports) parts.push(`${r.reports} ${r.reports === 1 ? 'informe' : 'informes'}`);
  return parts.filter(Boolean).join(' · ');
};

/** Paso 1: crear un paciente nuevo o continuar uno reciente. */
export const PatientStep: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const { currentSessionId, switchSession } = useVitals();
  const [showNew, setShowNew] = useState(false);
  const [rows, setRows] = useState<SessionOverview[] | null>(null);
  const named = isNamedPatient(currentSessionId);
  const code = patientLabel(currentSessionId);
  const mine = rows?.find((r) => r.session_id === currentSessionId) || null;
  const recent = rows?.filter((r) => r.session_id !== currentSessionId).slice(0, 8) || null;

  useEffect(() => {
    apiService.getHistory().then(setRows).catch(() => setRows([]));
  }, [currentSessionId]);

  useStepAction(named ? { label: `Continuar con ${code}`, icon: 'arrow-forward', onPress: onNext } : null);

  return (
    <View>
      <SectionHeader title="Paciente" subtitle="Cada paciente es una consulta aparte. El dispositivo registra en el paciente que esté abierto." />

      {named ? (
        <Card elevated>
          <View style={styles.currentRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.kicker}>Paciente abierto</Text>
              <Text style={styles.sid}>El dispositivo registra en {code} (sesión {currentSessionId}).</Text>
            </View>
            <StatusPill label="Identificado" tone="success" icon="checkmark-circle" />
          </View>
          {mine && (
            <View style={styles.stats}>
              <Stat value={mine.recordings} label="grabaciones" />
              <Stat value={mine.abnormal_recordings} label="posibles anormales" tone={mine.abnormal_recordings ? color.danger : undefined} />
              <Stat value={mine.reports} label="informes" />
              <Stat value={mine.active_alerts} label="alertas activas" tone={mine.active_alerts ? color.warning : undefined} />
            </View>
          )}
          <Button label="Nuevo paciente" icon="person-add-outline" variant="secondary" onPress={() => setShowNew(true)}
                  style={{ alignSelf: 'flex-start', marginTop: space.lg }} />
        </Card>
      ) : (
        <Card elevated>
          <EmptyState icon="account-plus-outline" title="Empieza una consulta"
                      text="Crea un paciente con un código o sus iniciales (no el nombre completo). El dispositivo registrará en ese paciente y podrás encontrarlo después en el historial."
                      action={<Button label="Nuevo paciente" icon="person-add" size="lg" onPress={() => setShowNew(true)} style={{ marginTop: space.md }} />} />
        </Card>
      )}

      <View style={styles.listHead}>
        <Text style={styles.listTitle}>Pacientes recientes</Text>
        {!!recent?.length && <Text style={styles.listHint}>Toca uno para continuar su consulta</Text>}
      </View>
      {recent === null && <SkeletonList rows={4} />}
      {recent?.length === 0 && (
        <EmptyState compact icon="account-clock-outline" tone="neutral" title="Todavía no hay otros pacientes" />
      )}
      <View style={styles.list}>
        {recent?.map((r) => {
          const lv = LEVEL[r.triaje] || LEVEL.gris;
          const label = isNamedPatient(r.session_id) ? patientLabel(r.session_id) : r.session_id;
          return (
            <ListItem key={r.session_id} title={label} subtitle={summary(r) || 'Sin registros'}
                      left={<Avatar label={label} size={40} muted={!isNamedPatient(r.session_id)} />}
                      right={<StatusPill label={lv.label} tone={lv.tone} dot />}
                      accessibilityLabel={`Continuar con ${label}. Semáforo ${lv.label}. ${summary(r)}`}
                      onPress={() => { switchSession(r.session_id); onNext(); }} />
          );
        })}
      </View>

      <NewPatientModal visible={showNew} onClose={() => setShowNew(false)} onCreated={onNext} />
    </View>
  );
};

const Stat: React.FC<{ value: number; label: string; tone?: string }> = ({ value, label, tone }) => (
  <View style={styles.stat}>
    <Text style={[styles.statValue, tabular, tone ? { color: tone } : null]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, flexWrap: 'wrap' },
  kicker: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  code: { fontSize: font.xxl, fontWeight: weight.heavy, color: color.text, letterSpacing: -0.8, lineHeight: 38 },
  sid: { fontSize: font.sm, color: color.textSecondary, marginTop: 2 },
  stats: {
    flexDirection: 'row', flexWrap: 'wrap', marginTop: space.lg,
    rowGap: space.md,
  },
  stat: { flexGrow: 1, flexBasis: 110 },
  statValue: { fontSize: font.xl, fontWeight: weight.heavy, color: color.text },
  statLabel: { fontSize: font.xs, color: color.textMuted, marginTop: 2 },
  listHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md, marginTop: space.sm, marginBottom: space.sm, flexWrap: 'wrap' },
  listTitle: { fontSize: font.md, fontWeight: weight.heavy, color: color.text },
  listHint: { fontSize: font.xs, color: color.textMuted },
  list: { gap: space.sm },
});
