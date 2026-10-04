import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './ui/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TriageResult, TriageLevel } from '../types/vitals';
import { color, font, radius, shadow, space, weight } from '../theme/tokens';

const LEVEL_STYLE: Record<TriageLevel, { color: string; soft: string; border: string; label: string; icon: string }> = {
  rojo: { color: color.danger, soft: color.dangerSoft, border: '#FECACA', label: 'Rojo', icon: 'alert-octagon' },
  amarillo: { color: color.warning, soft: color.warningSoft, border: '#FDE68A', label: 'Amarillo', icon: 'alert' },
  verde: { color: color.success, soft: color.successSoft, border: '#A7F3D0', label: 'Verde', icon: 'check-circle' },
  gris: { color: color.textSecondary, soft: color.surface, border: color.border, label: 'Sin datos', icon: 'help-circle-outline' },
};
const LAMPS: { level: TriageLevel; on: string }[] = [
  { level: 'rojo', on: '#EF4444' }, { level: 'amarillo', on: '#F59E0B' }, { level: 'verde', on: '#10B981' },
];

/** Semáforo de triaje: síntomas, pulso, SpO2 calibrada y sonidos de corazón y pulmón, por reglas fijas del equipo. */
export const TriageCard: React.FC<{ triage: TriageResult | null }> = ({ triage }) => {
  const t: TriageResult = triage || { session_id: '', nivel: 'gris', titulo: 'Faltan datos para evaluar', motivos: [], aviso: '' };
  const s = LEVEL_STYLE[t.nivel];
  return (
    <View style={[styles.card, { borderColor: s.border, backgroundColor: s.soft }]}
          accessibilityLabel={`Semáforo ${s.label}. ${t.titulo}`}>
      <View style={styles.row}>
        <View style={styles.housing} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {LAMPS.map((l) => {
            const on = t.nivel === l.level;
            return (
              <View key={l.level} style={[styles.lamp, on
                ? { backgroundColor: l.on, boxShadow: `0px 0px 14px 2px ${l.on}99` }
                : { backgroundColor: '#3A4250' }]} />
            );
          })}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.levelRow}>
            <Text style={styles.kicker}>Semáforo</Text>
            <View style={[styles.levelPill, { backgroundColor: t.nivel === 'gris' ? color.surfaceMuted : s.color }]}>
              <MaterialCommunityIcons name={s.icon as any} size={14} color={t.nivel === 'gris' ? color.textSecondary : '#FFFFFF'} />
              <Text style={[styles.levelText, { color: t.nivel === 'gris' ? color.textSecondary : '#FFFFFF' }]}>{s.label}</Text>
            </View>
            {t.demo && (
              <View style={styles.demo}>
                <MaterialCommunityIcons name="flask-outline" size={13} color={color.ai} />
                <Text style={styles.demoText}>DEMO</Text>
              </View>
            )}
          </View>
          <Text style={[styles.title, t.nivel !== 'gris' && { color: s.color }]}>{t.titulo}</Text>
          {t.demo && <Text style={styles.demoNote}>Incluye un caso de demostración ICBHI que no es de esta persona.</Text>}
          {t.motivos.length > 0 && (
            <View style={styles.reasons}>
              {t.motivos.map((m, i) => (
                <View key={i} style={styles.reasonRow}>
                  <View style={[styles.bullet, { backgroundColor: t.nivel === 'gris' ? color.textMuted : s.color }]} />
                  <Text style={styles.reason}>{m}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
      <Text style={styles.note}>
        Combina síntomas, pulso, SpO2 (solo si está calibrada) y sonidos de corazón y pulmón con reglas fijas del equipo. No es un diagnóstico.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.xl, padding: space.lg, marginBottom: space.lg, ...shadow.md },
  row: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  housing: {
    width: 40, paddingVertical: 8, borderRadius: 14, backgroundColor: '#1F2630', alignItems: 'center', gap: 7,
    borderWidth: 1, borderColor: '#111827',
  },
  lamp: { width: 22, height: 22, borderRadius: 11 },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  kicker: { fontSize: font.xs, fontWeight: weight.bold, color: color.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' },
  levelPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  levelText: { fontSize: font.xs, fontWeight: weight.heavy, letterSpacing: 0.3, textTransform: 'uppercase' },
  title: { fontSize: 18, fontWeight: weight.heavy, color: color.text, marginTop: space.sm, letterSpacing: -0.3, lineHeight: 24 },
  reasons: { marginTop: space.sm, gap: 4 },
  reasonRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  reason: { flex: 1, fontSize: font.sm, color: color.text, lineHeight: 20 },
  note: { fontSize: font.xs, color: color.textMuted, marginTop: space.md, lineHeight: 17 },
  demo: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: color.aiSoft, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  demoText: { fontSize: font.xs, fontWeight: weight.heavy, color: color.ai },
  demoNote: { fontSize: font.xs, color: color.ai, marginTop: 4 },
});
