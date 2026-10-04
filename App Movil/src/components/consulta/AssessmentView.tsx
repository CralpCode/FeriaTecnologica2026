import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ClinicalAssessment } from '../../types/vitals';
import { color, font, space, weight } from '../../theme/tokens';
import { Banner, Card } from '../ui';

const STATUS_TONE = { urgent: 'danger', findings: 'warning', insufficient_data: 'neutral', no_specific_findings: 'success' } as const;

/** Valoración orientativa del servidor (Backend/clinical_assessment.py): no es un diagnóstico. */
/** showSummary: falso cuando el semáforo ya muestra el mismo resumen arriba. */
export const AssessmentView: React.FC<{ assessment: ClinicalAssessment; showSummary?: boolean }> = ({ assessment: a, showSummary = true }) => (
  <View>
    {showSummary && <Banner tone={STATUS_TONE[a.status]} title={a.urgent ? 'Atención urgente' : 'Valoración orientativa'} text={a.summary} />}

    {a.findings.length > 0 && (
      <Card>
        <Text style={styles.title}>Hallazgos</Text>
        {a.findings.map((f, i) => (
          <View key={`${f.code}-${i}`} style={styles.item}>
            <Text style={styles.label}>{f.label}</Text>
            {f.evidence.map((line, j) => <Text key={j} style={styles.text}>• {line}</Text>)}
          </View>
        ))}
      </Card>
    )}

    {a.possibilities.length > 0 && (
      <Card>
        <Text style={styles.title}>Posibilidades para revisar con un profesional</Text>
        <Text style={styles.note}>No son diagnósticos ni están ordenadas por probabilidad.</Text>
        {a.possibilities.map((p, i) => (
          <View key={i} style={styles.item}>
            <Text style={styles.label}>{p.condition}</Text>
            {p.why.map((line, j) => <Text key={`w${j}`} style={styles.text}>• {line}</Text>)}
            {p.confirmation.map((line, j) => <Text key={`c${j}`} style={styles.text}>Para confirmar: {line}</Text>)}
          </View>
        ))}
      </Card>
    )}

    <Lines title="Próximos pasos" lines={a.next_steps} />
    <Lines title="Datos que faltan" lines={a.missing_data} />
    <Lines title="Límites de esta valoración" lines={a.limitations} muted />

    {a.sources.length > 0 && (
      <Card>
        <Text style={styles.title}>Fuentes</Text>
        {a.sources.filter((s) => /^https:\/\//i.test(s.url)).map((s) => (
          <TouchableOpacity key={s.id} accessibilityRole="link" onPress={() => Linking.openURL(s.url).catch(() => {})}
                            style={styles.sourceRow}>
            <Text style={styles.link}>{s.title}</Text>
          </TouchableOpacity>
        ))}
      </Card>
    )}
  </View>
);

const Lines: React.FC<{ title: string; lines: string[]; muted?: boolean }> = ({ title, lines, muted }) =>
  lines.length > 0 ? (
    <Card>
      <Text style={styles.title}>{title}</Text>
      {lines.map((line, i) => <Text key={i} style={[styles.text, muted && { color: color.textMuted }]}>• {line}</Text>)}
    </Card>
  ) : null;

const styles = StyleSheet.create({
  title: { fontSize: font.md, fontWeight: weight.heavy, color: color.text, marginBottom: space.sm },
  note: { fontSize: font.xs, color: color.textMuted, marginBottom: space.sm },
  item: { paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: color.border },
  label: { fontSize: font.sm, fontWeight: weight.bold, color: color.text, marginBottom: 2 },
  text: { fontSize: font.sm, color: color.textSecondary, lineHeight: 20 },
  sourceRow: { minHeight: 36, justifyContent: 'center' },
  link: { fontSize: font.sm, color: color.primary, fontWeight: weight.medium },
});
