import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDeviceConnection } from '../../context/VitalsContext';
import { apiService } from '../../services/api';
import {
  ALARM_SYMPTOMS, HISTORY, OTHER_SYMPTOMS, TOTAL_QUESTIONS, answeredCount, emptyContext, hasAlarm, mergeContext,
} from '../../services/questions';
import { PatientContext } from '../../types/vitals';
import { color, font, radius, space, weight } from '../../theme/tokens';
import { Banner, Button, Card, SectionHeader, SegmentedControl, StatusPill, YES_NO_UNKNOWN } from '../ui';

type Group = 'basicos' | 'alarma' | 'otros' | 'antecedentes';

/** Paso 2: edad, reposo, altitud, síntomas y antecedentes. "No sé" se guarda como desconocido. */
export const DataStep: React.FC<{ onSaved: () => void; onNext: () => void }> = ({ onSaved, onNext }) => {
  const { currentSessionId } = useDeviceConnection();
  const [ctx, setCtx] = useState<PatientContext>(emptyContext);
  const [age, setAge] = useState('');
  const [altitude, setAltitude] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<Group, boolean>>({ basicos: true, alarma: true, otros: false, antecedentes: false });
  const generation = useRef(0);

  useEffect(() => {
    const g = ++generation.current;
    setLoading(true); setError(null);
    apiService.getPatientContext(currentSessionId).then((saved) => {
      if (g !== generation.current) return;
      const c = mergeContext(saved);
      setCtx(c);
      setAge(c.age_years == null ? '' : String(c.age_years));
      setAltitude(c.altitude_m == null ? '' : String(c.altitude_m));
    }).catch((e) => g === generation.current && setError(`No se pudieron cargar los datos: ${e.message}`))
      .finally(() => g === generation.current && setLoading(false));
    return () => { generation.current++; };
  }, [currentSessionId]);

  const ageValue = age.trim() === '' ? null : Number(age.replace(',', '.'));
  const altValue = altitude.trim() === '' ? null : Number(altitude.replace(',', '.'));
  const current: PatientContext = { ...ctx, age_years: ageValue, altitude_m: altValue };
  const answered = answeredCount({ ...current,
    age_years: ageValue !== null && Number.isFinite(ageValue) ? ageValue : null,
    altitude_m: altValue !== null && Number.isFinite(altValue) ? altValue : null });

  const save = async () => {
    if (ageValue !== null && (!Number.isFinite(ageValue) || ageValue < 0 || ageValue > 120)) {
      setError('Ingresa una edad entre 0 y 120 años, o déjala vacía si no la conoces.'); return;
    }
    if (altValue !== null && (!Number.isFinite(altValue) || altValue < -500 || altValue > 9000)) {
      setError('Ingresa una altitud entre −500 y 9000 metros, o déjala vacía.'); return;
    }
    const g = generation.current;
    setSaving(true); setError(null);
    try {
      await apiService.savePatientContext(currentSessionId, current);
      if (g !== generation.current) return;
      onSaved();
      onNext();
    } catch (e: any) {
      if (g === generation.current) setError(`No se pudo guardar: ${e?.message || e}`);
    } finally {
      if (g === generation.current) setSaving(false);
    }
  };

  const setSymptom = (k: keyof PatientContext['symptoms'], v: boolean | null) =>
    setCtx((c) => ({ ...c, symptoms: { ...c.symptoms, [k]: v } }));
  const setHistory = (k: keyof PatientContext['history'], v: boolean | null) =>
    setCtx((c) => ({ ...c, history: { ...c.history, [k]: v } }));
  const count = (keys: string[], src: Record<string, boolean | null>) => keys.filter((k) => src[k] !== null).length;

  if (loading) return <ActivityIndicator color={color.primary} style={{ marginTop: space.xl }} />;

  return (
    <View>
      <SectionHeader title="Datos y síntomas"
                     subtitle={'Pregunta a la persona. Si no sabe o no quiere responder, deja "No sé": queda como desconocido, nunca como "No".'}
                     right={<StatusPill label={`${answered}/${TOTAL_QUESTIONS}`} tone={answered === TOTAL_QUESTIONS ? 'success' : 'primary'} />} />

      {hasAlarm(ctx) && (
        <Banner tone="danger" title="Síntoma de alarma"
                text="Busca atención médica urgente ahora. No esperes al resultado de la IA ni a terminar la consulta." />
      )}

      <Group title="Datos básicos" count={`${[ageValue, ctx.at_rest, altValue].filter((v) => v !== null).length}/3`}
             open={open.basicos} onToggle={() => setOpen((o) => ({ ...o, basicos: !o.basicos }))}>
        <View style={styles.fields}>
          <Field label="Edad (años)">
            <TextInput style={styles.input} value={age} onChangeText={setAge} keyboardType="decimal-pad"
                       placeholder="Desconocida" placeholderTextColor={color.textMuted} accessibilityLabel="Edad en años" />
          </Field>
          <Field label="Altitud del lugar (m, opcional)">
            <TextInput style={styles.input} value={altitude} onChangeText={setAltitude} keyboardType="numbers-and-punctuation"
                       placeholder="Desconocida" placeholderTextColor={color.textMuted} accessibilityLabel="Altitud en metros" />
          </Field>
        </View>
        <Question label="¿Está en reposo (sentado y tranquilo al menos 5 minutos)?" value={ctx.at_rest}
                  onChange={(v) => setCtx((c) => ({ ...c, at_rest: v }))} />
      </Group>

      <Group title="Síntomas de alarma" tone="danger" count={`${count(ALARM_SYMPTOMS.map(([k]) => k), ctx.symptoms)}/${ALARM_SYMPTOMS.length}`}
             open={open.alarma} onToggle={() => setOpen((o) => ({ ...o, alarma: !o.alarma }))}>
        {ALARM_SYMPTOMS.map(([k, label]) => (
          <Question key={k} label={label} value={ctx.symptoms[k]} onChange={(v) => setSymptom(k, v)} />
        ))}
      </Group>

      <Group title="Otros síntomas" count={`${count(OTHER_SYMPTOMS.map(([k]) => k), ctx.symptoms)}/${OTHER_SYMPTOMS.length}`}
             open={open.otros} onToggle={() => setOpen((o) => ({ ...o, otros: !o.otros }))}>
        {OTHER_SYMPTOMS.map(([k, label]) => (
          <Question key={k} label={label} value={ctx.symptoms[k]} onChange={(v) => setSymptom(k, v)} />
        ))}
      </Group>

      <Group title="Antecedentes" count={`${count(HISTORY.map(([k]) => k), ctx.history)}/${HISTORY.length}`}
             open={open.antecedentes} onToggle={() => setOpen((o) => ({ ...o, antecedentes: !o.antecedentes }))}>
        {HISTORY.map(([k, label]) => (
          <Question key={k} label={label} value={ctx.history[k]} onChange={(v) => setHistory(k, v)} />
        ))}
      </Group>

      {error && <Banner tone="danger" text={error} />}
      <Button label="Guardar y continuar" icon="checkmark" size="lg" full loading={saving} onPress={save} />
    </View>
  );
};

const Group: React.FC<{ title: string; count: string; open: boolean; onToggle: () => void; tone?: 'danger'; children: React.ReactNode }> = ({
  title, count, open, onToggle, tone, children,
}) => (
  <Card padded={false}>
    <TouchableOpacity style={styles.groupHead} onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      {tone === 'danger' && <Ionicons name="alert-circle" size={18} color={color.danger} />}
      <Text style={styles.groupTitle}>{title}</Text>
      <Text style={styles.groupCount}>{count}</Text>
      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={color.textMuted} />
    </TouchableOpacity>
    {open && <View style={styles.groupBody}>{children}</View>}
  </Card>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    {children}
  </View>
);

const Question: React.FC<{ label: string; value: boolean | null; onChange: (v: boolean | null) => void }> = ({ label, value, onChange }) => (
  <View style={styles.question}>
    <Text style={styles.qLabel}>{label}</Text>
    <SegmentedControl options={YES_NO_UNKNOWN} value={value} onChange={onChange} accessibilityLabel={label} />
  </View>
);

const styles = StyleSheet.create({
  groupHead: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.lg,
    cursor: 'pointer' as any,
  },
  groupTitle: { flex: 1, fontSize: font.md, fontWeight: weight.heavy, color: color.text },
  groupCount: { fontSize: font.sm, color: color.textMuted, fontWeight: weight.bold },
  groupBody: { paddingHorizontal: space.lg, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: color.border },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md },
  field: { flexGrow: 1, flexBasis: 200 },
  label: { fontSize: font.sm, fontWeight: weight.bold, color: color.text, marginBottom: 6 },
  input: {
    minHeight: 44, borderWidth: 1, borderColor: color.borderStrong, borderRadius: radius.md, paddingHorizontal: space.md,
    fontSize: font.md, color: color.text, backgroundColor: color.surface,
  },
  question: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.sm,
    paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: color.border,
  },
  qLabel: { flexGrow: 1, flexBasis: 220, fontSize: font.sm, color: color.text, lineHeight: 20 },
});
