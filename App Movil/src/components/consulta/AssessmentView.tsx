import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { Ionicons } from '@expo/vector-icons';
import { ClinicalAssessment } from '../../types/vitals';
import { color, font, radius, space, weight } from '../../theme/tokens';
import { Banner, Button, Card } from '../ui';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const STATUS_TONE = { urgent: 'danger', findings: 'warning', insufficient_data: 'neutral', no_specific_findings: 'success' } as const;

/**
 * Paso de la consulta donde se completa cada dato faltante (según el texto del servidor,
 * Backend/clinical_assessment.py). La SpO2 no tiene paso: requiere calibrar el sensor.
 */
const MISSING_STEP: { re: RegExp; step: number; label: string }[] = [
  { re: /^(Completar preguntas|Edad|Confirmar medición en reposo|Altitud)/i, step: 1, label: 'Datos' },
  { re: /^Pulso real/i, step: 2, label: 'Pulso' },
  { re: /^Auscultación cardíaca/i, step: 3, label: 'Corazón' },
  { re: /^Grabación pulmonar/i, step: 4, label: 'Pulmón' },
];

/** Valoración orientativa del servidor (Backend/clinical_assessment.py): no es un diagnóstico. */
/** showSummary: falso cuando el semáforo ya muestra el mismo resumen arriba. */
export const AssessmentView: React.FC<{
  assessment: ClinicalAssessment; showSummary?: boolean; onGoToStep?: (step: number) => void;
}> = ({ assessment: a, showSummary = true, onGoToStep }) => (
  <View>
    {showSummary && <Banner tone={STATUS_TONE[a.status]} title={a.urgent ? 'Atención urgente' : 'Valoración orientativa'} text={a.summary} />}

    {a.findings.length > 0 && (
      <Section icon="search-outline" title="Hallazgos" count={a.findings.length} tone={color.danger} initiallyOpen>
        {a.findings.map((f, i) => (
          <View key={`${f.code}-${i}`} style={styles.item}>
            <Text style={styles.label}>{f.label}</Text>
            {f.evidence.map((line, j) => <Text key={j} style={styles.text}>• {line}</Text>)}
          </View>
        ))}
      </Section>
    )}

    {a.missing_data.length > 0 && (
      <Section icon="clipboard-outline" title="Datos que faltan" count={a.missing_data.length} tone={color.warning} initiallyOpen>
        {a.missing_data.map((line, i) => {
          const target = MISSING_STEP.find((m) => m.re.test(line));
          return (
            <View key={i} style={styles.todo}>
              <View style={styles.todoBox} />
              <Text style={[styles.text, { flex: 1, minWidth: 180 }]}>{line}</Text>
              {target && onGoToStep && (
                <Button label={`Ir a ${target.label}`} size="sm" variant="secondary" iconRight="arrow-forward"
                        onPress={() => onGoToStep(target.step)} />
              )}
            </View>
          );
        })}
      </Section>
    )}

    {a.possibilities.length > 0 && (
      <Section icon="git-branch-outline" title="Posibilidades para revisar con un profesional" count={a.possibilities.length} tone={color.ai}
               note="No son diagnósticos ni están ordenadas por probabilidad.">
        {a.possibilities.map((p, i) => (
          <View key={i} style={styles.item}>
            <Text style={styles.label}>{p.condition}</Text>
            {p.why.map((line, j) => <Text key={`w${j}`} style={styles.text}>• {line}</Text>)}
            {p.confirmation.map((line, j) => <Text key={`c${j}`} style={styles.text}>Para confirmar: {line}</Text>)}
          </View>
        ))}
      </Section>
    )}

    {a.next_steps.length > 0 && (
      <Section icon="footsteps-outline" title="Próximos pasos" count={a.next_steps.length} tone={color.primary} initiallyOpen>
        {a.next_steps.map((line, i) => <Text key={i} style={[styles.text, styles.line]}>• {line}</Text>)}
      </Section>
    )}

    {a.limitations.length > 0 && (
      <Section icon="information-circle-outline" title="Límites de esta valoración" count={a.limitations.length} tone={color.textMuted}>
        {a.limitations.map((line, i) => <Text key={i} style={[styles.text, styles.line, { color: color.textMuted }]}>• {line}</Text>)}
      </Section>
    )}

    {a.sources.length > 0 && (
      <Section icon="library-outline" title="Fuentes" count={a.sources.length} tone={color.textMuted}>
        {a.sources.filter((s) => /^https:\/\//i.test(s.url)).map((s) => (
          <Pressable key={s.id} accessibilityRole="link" onPress={() => Linking.openURL(s.url).catch(() => {})} style={styles.sourceRow}>
            <Ionicons name="open-outline" size={14} color={color.primary} />
            <Text style={styles.link}>{s.title}</Text>
          </Pressable>
        ))}
      </Section>
    )}
  </View>
);

/** Sección plegable con ícono, título y conteo. */
const Section: React.FC<{
  icon: IconName; title: string; count: number; tone: string; note?: string; initiallyOpen?: boolean; children: React.ReactNode;
}> = ({ icon, title, count, tone, note, initiallyOpen, children }) => {
  const [open, setOpen] = useState(!!initiallyOpen);
  return (
    <Card padded={false}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }}
                 style={(s: any) => [styles.head, s.hovered && { backgroundColor: color.surfaceMuted }]}>
        <View style={[styles.icon, { backgroundColor: `${tone}14` }]}><Ionicons name={icon} size={18} color={tone} /></View>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.count}><Text style={styles.countText}>{count}</Text></View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={color.textMuted} />
      </Pressable>
      {open && (
        <View style={styles.body}>
          {!!note && <Text style={styles.note}>{note}</Text>}
          {children}
        </View>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingHorizontal: space.lg, borderRadius: radius.lg, cursor: 'pointer' as any },
  icon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: font.md, fontWeight: weight.heavy, color: color.text },
  count: { minWidth: 26, height: 22, borderRadius: 11, paddingHorizontal: 7, backgroundColor: color.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: font.xs, fontWeight: weight.heavy, color: color.textSecondary },
  body: { paddingHorizontal: space.lg, paddingBottom: space.lg, borderTopWidth: 1, borderTopColor: color.border, paddingTop: space.sm },
  note: { fontSize: font.xs, color: color.textMuted, marginBottom: space.xs },
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.surfaceMuted },
  label: { fontSize: font.sm, fontWeight: weight.heavy, color: color.text, marginBottom: 2 },
  text: { fontSize: font.sm, color: color.textSecondary, lineHeight: 20 },
  line: { paddingVertical: 3 },
  todo: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.surfaceMuted, flexWrap: 'wrap' },
  todoBox: { width: 16, height: 16, borderRadius: 5, borderWidth: 2, borderColor: color.borderStrong },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, cursor: 'pointer' as any },
  link: { fontSize: font.sm, color: color.primary, fontWeight: weight.medium },
});
