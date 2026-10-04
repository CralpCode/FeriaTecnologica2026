import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { TriageResult, TriageLevel } from '../types/vitals';

const LEVEL_STYLE: Record<TriageLevel, { color: string; soft: string; label: string; icon: string }> = {
  rojo: { color: Colors.danger, soft: Colors.dangerSoft, label: 'ROJO', icon: 'alert-octagon' },
  amarillo: { color: Colors.warning, soft: Colors.warningSoft, label: 'AMARILLO', icon: 'alert' },
  verde: { color: Colors.success, soft: Colors.successSoft, label: 'VERDE', icon: 'check-circle' },
  gris: { color: Colors.textSecondary, soft: Colors.backgroundSecondary, label: 'SIN DATOS', icon: 'help-circle-outline' },
};

/** Semáforo de triaje: síntomas, pulso, SpO2 calibrada y sonidos de corazón y pulmón, por reglas fijas del equipo. */
export const TriageCard: React.FC<{ triage: TriageResult | null }> = ({ triage }) => {
  const t: TriageResult = triage || { session_id: '', nivel: 'gris', titulo: 'Faltan datos para evaluar', motivos: [], aviso: '' };
  const s = LEVEL_STYLE[t.nivel];
  return (
    <View style={[styles.card, { borderColor: s.color, backgroundColor: s.soft }]}>
      <View style={styles.header}>
        <View style={styles.lights}>
          {(['rojo', 'amarillo', 'verde'] as TriageLevel[]).map((l) => (
            <View
              key={l}
              style={[styles.light, { backgroundColor: LEVEL_STYLE[l].color, opacity: t.nivel === l ? 1 : 0.18 }]}
            />
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>SEMÁFORO · {s.label}</Text>
          <Text style={[styles.title, { color: s.color }]}>{t.titulo}</Text>
        </View>
        <MaterialCommunityIcons name={s.icon as any} size={24} color={s.color} />
      </View>
      {t.demo && (
        <View style={styles.demo}>
          <MaterialCommunityIcons name="flask-outline" size={14} color="#6B21A8" />
          <Text style={styles.demoText}>DEMO · caso de demostración ICBHI, no es de esta persona</Text>
        </View>
      )}
      {t.motivos.map((m, i) => (
        <Text key={i} style={styles.reason}>• {m}</Text>
      ))}
      <Text style={styles.note}>
        Combina síntomas, pulso, SpO2 (solo si está calibrada) y sonidos de corazón y pulmón con reglas fijas del equipo. No es un diagnóstico.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 16, padding: 14, marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  lights: { gap: 4 },
  light: { width: 12, height: 12, borderRadius: 6 },
  kicker: { fontSize: 12, fontWeight: '800', color: Colors.textSecondary, letterSpacing: 0.5 },
  title: { fontSize: 15, fontWeight: '800' },
  reason: { fontSize: 13, color: Colors.textPrimary, lineHeight: 19 },
  note: { fontSize: 12, color: Colors.textSecondary, marginTop: 6 },
  demo: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: '#F3E8FF',
          borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6 },
  demoText: { fontSize: 12, fontWeight: '800', color: '#6B21A8' },
});
