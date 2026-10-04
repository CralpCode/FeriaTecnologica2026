import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useVitals } from '../context/VitalsContext';
import { useConsultaProgress } from '../hooks/useConsultaProgress';
import { useLayout } from '../hooks/useLayout';
import { patientLabel } from '../services/consulta';
import { color, font, space, weight } from '../theme/tokens';
import { Button, Stepper, StatusPill } from '../components/ui';
import { Centered } from '../components/ResponsiveContainer';
import { PatientStep } from '../components/consulta/PatientStep';
import { DataStep } from '../components/consulta/DataStep';
import { PulseStep } from '../components/consulta/PulseStep';
import { AuscultationStep } from '../components/consulta/AuscultationStep';
import { ResultStep } from '../components/consulta/ResultStep';

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
  const go = (i: number) => onStepChange(Math.max(0, Math.min(progress.steps.length - 1, i)));
  const next = () => go(step + 1);

  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [step]);

  const current = progress.steps[step];
  return (
    <ScrollView ref={scroll} style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Centered>
        <View style={styles.top}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.kicker}>Consulta</Text>
            <Text style={styles.patient} numberOfLines={1}>{patientLabel(currentSessionId)}</Text>
          </View>
          <StatusPill label={`${progress.completed}/5 pasos`} tone={progress.completed === 5 ? 'success' : 'primary'} />
        </View>

        <Stepper steps={progress.steps} current={step} onSelect={go} compact={isPhone} />
        {isPhone && (
          <Text style={styles.phoneStep}>Paso {step + 1} de {progress.steps.length} · {current.label}
            <Text style={styles.phoneDetail}>  {current.detail}</Text></Text>
        )}

        {step === 0 && <PatientStep onNext={next} />}
        {step === 1 && <DataStep onSaved={progress.reloadContext} onNext={next} />}
        {step === 2 && <PulseStep onNext={next} />}
        {step === 3 && <AuscultationStep key="corazon" mode="corazon" onNext={next} nextLabel="Continuar a pulmón" />}
        {step === 4 && <AuscultationStep key="pulmon" mode="pulmon" onNext={next} nextLabel="Ver resultado" />}
        {step === 5 && <ResultStep onOpenAssistant={onOpenAssistant} onNewPatient={() => go(1)} />}

        <View style={styles.footer}>
          {step > 0 ? <Button label="Anterior" icon="arrow-back" variant="ghost" onPress={() => go(step - 1)} /> : <View />}
          {step < progress.steps.length - 1 && step > 0 && (
            <Button label="Saltar este paso" variant="ghost" onPress={next} />
          )}
        </View>
        <Text style={styles.disclaimer}>
          SpiroScan es un prototipo de tamizaje: sugiere a quién referir, no diagnostica.
        </Text>
      </Centered>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.lg, paddingBottom: space.xxl },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg },
  kicker: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.bold, letterSpacing: 0.4, textTransform: 'uppercase' },
  patient: { fontSize: font.xl, fontWeight: weight.heavy, color: color.text, letterSpacing: -0.4 },
  phoneStep: { fontSize: font.sm, fontWeight: weight.heavy, color: color.text, marginTop: -space.sm, marginBottom: space.lg },
  phoneDetail: { fontWeight: weight.regular, color: color.textMuted },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.md },
  disclaimer: { fontSize: font.xs, color: color.textMuted, textAlign: 'center', marginTop: space.lg },
});
