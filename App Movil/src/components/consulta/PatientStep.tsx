import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVitals } from '../../context/VitalsContext';
import { apiService } from '../../services/api';
import { isNamedPatient, patientLabel } from '../../services/consulta';
import { SessionOverview } from '../../types/vitals';
import { color, font, radius, space, weight } from '../../theme/tokens';
import { Button, Card, SectionHeader, StatusPill } from '../ui';
import { NewPatientModal } from '../NewPatientModal';

const LEVEL: Record<string, { label: string; tone: 'danger' | 'warning' | 'success' | 'neutral' }> = {
  rojo: { label: 'Rojo', tone: 'danger' }, amarillo: { label: 'Amarillo', tone: 'warning' },
  verde: { label: 'Verde', tone: 'success' }, gris: { label: 'Sin datos', tone: 'neutral' },
};

const when = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** Paso 1: crear un paciente nuevo o continuar uno reciente. */
export const PatientStep: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const { currentSessionId, switchSession } = useVitals();
  const [showNew, setShowNew] = useState(false);
  const [recent, setRecent] = useState<SessionOverview[] | null>(null);
  const named = isNamedPatient(currentSessionId);

  useEffect(() => {
    apiService.getHistory().then((rows) => setRecent(rows.filter((r) => r.session_id !== currentSessionId).slice(0, 8)))
      .catch(() => setRecent([]));
  }, [currentSessionId]);

  return (
    <View>
      <SectionHeader title="Paciente" subtitle="Cada paciente es una consulta aparte. El dispositivo registra en el paciente que esté abierto." />

      <Card>
        <Text style={styles.kicker}>Paciente actual</Text>
        <View style={styles.currentRow}>
          <Text style={styles.code}>{patientLabel(currentSessionId)}</Text>
          <StatusPill label={named ? 'Identificado' : 'Sin identificar'} tone={named ? 'success' : 'warning'} />
        </View>
        <Text style={styles.sid}>Sesión {currentSessionId}</Text>
        <View style={styles.actions}>
          <Button label="Nuevo paciente" icon="person-add" size="lg" onPress={() => setShowNew(true)} style={{ flexGrow: 1 }} />
          {named && <Button label={`Continuar con ${patientLabel(currentSessionId)}`} variant="secondary" size="lg"
                            icon="arrow-forward" onPress={onNext} style={{ flexGrow: 1 }} />}
        </View>
        {!named && (
          <Text style={styles.hint}>
            Crea un paciente con un código o sus iniciales (no el nombre completo) para encontrarlo después en el historial.
          </Text>
        )}
      </Card>

      <Text style={styles.listTitle}>Pacientes recientes</Text>
      {recent === null && <ActivityIndicator color={color.primary} />}
      {recent?.length === 0 && <Text style={styles.hint}>Todavía no hay otros pacientes.</Text>}
      <View style={styles.list}>
        {recent?.map((r) => {
          const lv = LEVEL[r.triaje] || LEVEL.gris;
          return (
            <TouchableOpacity key={r.session_id} style={styles.row} accessibilityRole="button"
                              accessibilityLabel={`Continuar con ${patientLabel(r.session_id)}`}
                              onPress={() => { switchSession(r.session_id); onNext(); }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowCode} numberOfLines={1}>
                  {isNamedPatient(r.session_id) ? patientLabel(r.session_id) : r.session_id}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {when(r.last_seen)} · {r.recordings} grabaciones · {r.reports} informes
                </Text>
              </View>
              <StatusPill label={lv.label} tone={lv.tone} />
              <Ionicons name="chevron-forward" size={18} color={color.textMuted} />
            </TouchableOpacity>
          );
        })}
      </View>

      <NewPatientModal visible={showNew} onClose={() => setShowNew(false)} onCreated={onNext} />
    </View>
  );
};

const styles = StyleSheet.create({
  kicker: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.bold, letterSpacing: 0.4, textTransform: 'uppercase' },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs, flexWrap: 'wrap' },
  code: { fontSize: font.xxl, fontWeight: weight.heavy, color: color.text, letterSpacing: -0.5 },
  sid: { fontSize: font.xs, color: color.textMuted, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.lg },
  hint: { fontSize: font.sm, color: color.textSecondary, lineHeight: 20, marginTop: space.md },
  listTitle: { fontSize: font.md, fontWeight: weight.heavy, color: color.text, marginBottom: space.sm, marginTop: space.sm },
  list: { gap: space.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.lg,
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.md,
    cursor: 'pointer' as any,
  },
  rowCode: { fontSize: font.md, fontWeight: weight.bold, color: color.text },
  rowMeta: { fontSize: font.xs, color: color.textMuted, marginTop: 2 },
});
