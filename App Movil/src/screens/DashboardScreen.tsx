import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDisplayedMeasurements } from '../hooks/useDisplayedMeasurements';
import { useVitals } from '../context/VitalsContext';
import { useClinical } from '../context/ClinicalContext';
import { measurementValidity } from '../services/measurementQuality';
import { Colors } from '../theme/colors';
import { color, font, radius, space, weight } from '../theme/tokens';
import { HospitalEcgMonitor } from '../components/HospitalEcgMonitor';
import { BloodOxygenReading, MicrophoneLevel } from '../components/SensorReadouts';
import { DeviceScanControls } from '../components/DeviceScanControls';
import { TriageCard } from '../components/TriageCard';
import { Centered, Columns } from '../components/ResponsiveContainer';
import { ConsultaBanner } from '../components/consulta/ConsultaBanner';
import { Banner, Button, SectionHeader } from '../components/ui';

interface DashboardScreenProps {
  onNavigateToAI: () => void;
  onNavigateToCharts: () => void;
  onOpenConsulta?: (step: number) => void;
}

/** Monitoreo: semáforo, pulso en vivo y todas las lecturas del dispositivo con su estado real. */
export const DashboardScreen: React.FC<DashboardScreenProps> = ({ onNavigateToAI, onNavigateToCharts, onOpenConsulta }) => {
  const { vitals, connectedType, currentSessionId } = useVitals();
  const { triage } = useClinical();
  const { now, readings } = useDisplayedMeasurements(vitals, `${currentSessionId}:${connectedType}`);
  const valid = measurementValidity(vitals, now);
  const pulse = readings.heartRate;
  const oxygen = readings.bloodOxygen;
  const prv = readings.hrv;
  const audio = readings.audio_rms;
  const stress = readings.experimentalStressScore;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Centered>
        {onOpenConsulta && <ConsultaBanner onOpen={onOpenConsulta} />}
        {connectedType === 'demo_icbhi' && (
          <Banner tone="ai" icon="flask-outline" title="Modo demostración"
                  text="Audio real de ICBHI 2017, de otra persona. Este modo no tiene pulso ni SpO2." />
        )}

        <DeviceScanControls onOpenPulmonary={onOpenConsulta ? () => onOpenConsulta(4) : undefined} />

        <Columns
          leftWeight={1.15}
          left={
            <View>
              <TriageCard triage={triage} />
              <HospitalEcgMonitor heartRate={valid.heartRate ? vitals.heartRate : 0} bloodOxygen={oxygen?.value ?? 0}
                                  bloodOxygenHint={oxygen ? `${oxygen.state === 'held' ? 'Última estimación; esperando señal' : 'Estimación del sensor'}; ${oxygen.calibrated ? 'calibrada' : 'sin calibrar, fuera del triaje'}` : undefined}
                                  audioDecibels={0} isAlert={false} />
              <Button label="Preguntar al asistente sobre esta sesión" icon="chatbubbles-outline" variant="secondary"
                      onPress={onNavigateToAI} full style={{ marginBottom: space.lg }} />
            </View>
          }
          right={
            <View>
              <SectionHeader title="Lecturas en vivo" subtitle="Solo se muestran valores válidos; el resto indica por qué no hay dato."
                             right={<Button label="Gráficas" icon="stats-chart-outline" variant="ghost" onPress={onNavigateToCharts} />} />
              <View style={styles.grid}>
                <BloodOxygenReading reading={oxygen} vitals={vitals} />
                <VitalTile icon="heart-pulse" tint={Colors.heartRate} label="Pulso" unit="BPM"
                           value={pulse ? String(Math.round(pulse.value)) : null}
                           hint={pulse?.state === 'held' ? 'Última lectura válida; esperando señal' : valid.heartRate ? 'Lectura válida; interpretar con edad y reposo' : 'Sin lectura válida'} source="MAX30102" />
                <VitalTile icon="heart-flash" tint={Colors.pressure} label="Variabilidad (PRV)" unit="ms" value={prv ? String(prv.value) : null}
                           hint={prv?.state === "held" ? "Última PRV válida; reuniendo intervalos" : prv ? "RMSSD de intervalos ópticos; no es ECG" : "Reuniendo intervalos de pulso válidos"} source="MAX30102" />
                <VitalTile icon="brain" tint={Colors.stress} label="Estrés experimental" unit={stress ? '/100' : ''}
                           value={stress ? String(stress.value) : null}
                           hint={stress?.state === 'held' ? 'Última estimación; no validada' : stress ? 'Regla por PRV; no mide estrés clínico' : 'Sin estimación: requiere PRV válida y valor del ESP32'}
                           source="Experimental; fuera del triaje" />
                <MicrophoneLevel reading={audio} />
              </View>
            </View>
          }
        />
      </Centered>
    </ScrollView>
  );
};

const VitalTile: React.FC<{
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  tint: string;
  label: string;
  value: string | null;
  unit: string;
  hint: string;
  source: string;
}> = ({ icon, tint, label, value, unit, hint, source }) => (
  <View style={styles.tile} accessibilityLabel={`${label}: ${value ? `${value} ${unit}` : 'sin dato'}. ${hint}`}>
    <View style={styles.tileHead}>
      <View style={[styles.tileIcon, { backgroundColor: `${tint}14` }]}>
        <MaterialCommunityIcons name={icon} size={18} color={tint} />
      </View>
      <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
    </View>
    <View style={styles.valueRow}>
      <Text style={[styles.value, !value && { color: color.textMuted }]}>{value ?? '--'}</Text>
      <Text style={styles.unit}>{unit}</Text>
    </View>
    <Text style={[styles.hint, !value && { color: color.textMuted }]} numberOfLines={2}>{hint}</Text>
    <Text style={styles.source}>{source}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.lg, paddingBottom: space.xxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    flexGrow: 1, flexBasis: 160, minHeight: 132, padding: space.lg, backgroundColor: color.surface,
    borderWidth: 1, borderColor: color.border, borderRadius: radius.lg,
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tileIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { flex: 1, fontSize: font.sm, fontWeight: weight.bold, color: color.text },
  valueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: space.md },
  value: { fontSize: font.xxl, lineHeight: 36, fontWeight: weight.heavy, color: color.text, letterSpacing: -0.5 },
  unit: { fontSize: font.sm, color: color.textSecondary, fontWeight: weight.bold, marginBottom: 4 },
  hint: { fontSize: font.xs, color: color.textSecondary, marginTop: space.xs, lineHeight: 16 },
  source: { fontSize: font.xs, color: color.textMuted, marginTop: space.xs },
});
