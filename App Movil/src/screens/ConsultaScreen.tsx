import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/ui/Text';
import { Ionicons } from '@expo/vector-icons';
import { useVitals } from '../context/VitalsContext';
import { useConsultaProgress } from '../hooks/useConsultaProgress';
import { useLayout } from '../hooks/useLayout';
import { patientLabel } from '../services/consulta';
import { color, font, shadow, space, weight } from '../theme/tokens';
import { Avatar, Button, FadeIn, IconButton, ProgressRing, Stepper } from '../components/ui';
import { Centered } from '../components/ResponsiveContainer';
import { PatientStep } from '../components/consulta/PatientStep';
import { DataStep } from '../components/consulta/DataStep';
import { PulseStep } from '../components/consulta/PulseStep';
import { AuscultationStep } from '../components/consulta/AuscultationStep';
import { ResultStep } from '../components/consulta/ResultStep';
import { StepAction, StepActionContext } from '../components/consulta/stepAction';

/**
 * Consulta guiada de un paciente: paciente → datos y síntomas → pulso → corazón → pulmón → resultado.
 * Se puede ir a cualquier paso desde la barra (no obliga a un orden rígido).
 */
export const ConsultaScreen: React.FC<{
  step: number;
  onStepChange: (step: number) => void;
  onOpenAssistant: () => void;
}> = ({ step, onStepChange, onOpenAssistant }) => {
  const { currentSessionId } = useVitals();
  const progress = useConsultaProgress();
  const { isPhone } = useLayout();
  const scroll = useRef<any>(null); // ScrollView (RN 0.88: componente de función)
  const [action, setAction] = useState<StepAction>(null);
  const register = useCallback((a: StepAction) => setAction(a), []);
  const go = (i: number) => onStepChange(Math.max(0, Math.min(progress.steps.length - 1, i)));
  const next = () => go(step + 1);

  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [step]);

  const current = progress.steps[step];
  const pending = progress.steps.slice(1, 5).filter((s) => s.state !== 'done').map((s) => s.label);
  const canSkip = step > 0 && step < progress.steps.length - 1;

  const nav = (
    <View style={[styles.nav, isPhone && styles.navPhone]}>
      {step > 0 && (
        isPhone
          ? <IconButton icon="arrow-back" onPress={() => go(step - 1)} accessibilityLabel="Paso anterior" size={52} />
          : <Button label="Anterior" icon="arrow-back" variant="ghost" onPress={() => go(step - 1)} />
      )}
      {!isPhone && <View style={{ flex: 1 }} />}
      {canSkip && !isPhone && <Button label="Saltar este paso" variant="ghost" onPress={next} />}
      {action && (
        <Button label={action.label} icon={action.icon} onPress={action.onPress} loading={action.loading} disabled={action.disabled}
                variant={action.variant || 'primary'} size="lg" style={isPhone ? { flex: 1 } : { minWidth: 260 }} />
      )}
    </View>
  );

  return (
    <StepActionContext.Provider value={register}>
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <ScrollView ref={scroll} style={styles.container} contentContainerStyle={[styles.content, isPhone && { paddingBottom: 120 }]}
                    keyboardShouldPersistTaps="handled" stickyHeaderIndices={[1]}>
          <Centered>
            <PatientHeader sessionId={currentSessionId} named={progress.named} completed={progress.completed}
                           pending={pending} compact={isPhone} />
          </Centered>

          <View style={styles.stickyBar}>
            <Centered>
              <Stepper steps={progress.steps} current={step} onSelect={go} compact={isPhone} />
              {isPhone && (
                <View style={styles.phoneStep}>
                  <Text style={styles.phoneStepText}>Paso {step + 1} de {progress.steps.length} · {current.label}</Text>
                  <Text style={styles.phoneDetail} numberOfLines={1}>{current.detail}</Text>
                </View>
              )}
            </Centered>
          </View>

          <Centered>
            <FadeIn trigger={step}>
              {step === 0 && <PatientStep onNext={next} />}
              {step === 1 && <DataStep onSaved={progress.reloadContext} onNext={next} />}
              {step === 2 && <PulseStep onNext={next} />}
              {step === 3 && <AuscultationStep key="corazon" mode="corazon" onNext={next} nextLabel="Continuar a pulmón" />}
              {step === 4 && <AuscultationStep key="pulmon" mode="pulmon" onNext={next} nextLabel="Ver resultado" />}
              {step === 5 && <ResultStep onOpenAssistant={onOpenAssistant} onNewPatient={() => go(1)} onGoToStep={go} />}
            </FadeIn>

            {!isPhone && nav}
            {isPhone && canSkip && (
              <Button label="Saltar este paso" variant="ghost" onPress={next} style={{ alignSelf: 'center' }} />
            )}
            <Text style={styles.disclaimer}>SpiroScan es un prototipo de tamizaje: sugiere a quién referir, no diagnostica.</Text>
          </Centered>
        </ScrollView>

        {isPhone && (step > 0 || action) && <View style={styles.footer}>{nav}</View>}
      </View>
    </StepActionContext.Provider>
  );
};

/** Encabezado del paciente: avatar, código y avance de la consulta (pasos de registro completos). */
const PatientHeader: React.FC<{ sessionId: string; named: boolean; completed: number; pending: string[]; compact: boolean }> = ({
  sessionId, named, completed, pending, compact,
}) => {
  if (!named) {
    return (
      <View style={styles.header}>
        <View style={[styles.newIcon, compact && { width: 44, height: 44 }]}>
          <Ionicons name="person-add-outline" size={compact ? 20 : 24} color={color.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.kicker}>Consulta</Text>
          <Text style={[styles.title, compact && { fontSize: font.lg }]}>Nueva consulta</Text>
          <Text style={styles.meta}>Crea un paciente o continúa uno reciente para empezar.</Text>
        </View>
      </View>
    );
  }
  const code = patientLabel(sessionId);
  return (
    <View style={styles.header}>
      <Avatar label={code} size={compact ? 44 : 56} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.kicker}>Consulta</Text>
        <Text style={[styles.title, compact && { fontSize: font.lg }]} numberOfLines={1}>{code}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {pending.length ? `Falta: ${pending.join(', ')}` : 'Registro completo · revisa el resultado'}
        </Text>
      </View>
      <View style={styles.ringBox}>
        <ProgressRing value={completed / 5} size={compact ? 48 : 56} stroke={5} tint={completed === 5 ? color.success : color.primary}
                      accessibilityLabel={`${completed} de 5 pasos completos`}>
          <Text style={styles.ringText}>{completed}<Text style={styles.ringOf}>/5</Text></Text>
        </ProgressRing>
        {!compact && <Text style={styles.ringLabel}>pasos completos</Text>}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.lg, paddingBottom: space.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg },
  newIcon: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: color.primarySoft, borderWidth: 1, borderColor: color.primaryBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  kicker: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { fontSize: font.xxl, fontWeight: weight.heavy, color: color.text, letterSpacing: -0.8, lineHeight: 38 },
  meta: { fontSize: font.sm, color: color.textSecondary, marginTop: 2 },
  ringBox: { alignItems: 'center', gap: 4 },
  ringText: { fontSize: font.md, fontWeight: weight.heavy, color: color.text },
  ringOf: { fontSize: font.xs, fontWeight: weight.bold, color: color.textMuted },
  ringLabel: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.medium },
  stickyBar: {
    backgroundColor: color.bg, marginHorizontal: -space.lg, paddingHorizontal: space.lg, paddingTop: space.xs,
    marginBottom: space.md, borderBottomWidth: 1, borderBottomColor: color.border,
  },
  phoneStep: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: -space.sm, marginBottom: space.sm },
  phoneStepText: { fontSize: font.sm, fontWeight: weight.heavy, color: color.text },
  phoneDetail: { flex: 1, fontSize: font.xs, color: color.textMuted },
  nav: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  navPhone: { marginTop: 0 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md,
    backgroundColor: 'rgba(255, 255, 255, 0.96)', borderTopWidth: 1, borderTopColor: color.border, ...shadow.lg,
  },
  disclaimer: { fontSize: font.xs, color: color.textMuted, textAlign: 'center', marginTop: space.xl },
});
