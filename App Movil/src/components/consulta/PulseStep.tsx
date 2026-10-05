import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDisplayedMeasurements } from '../../hooks/useDisplayedMeasurements';
import { useVitals } from '../../context/VitalsContext';
import { DeviceScanControls } from '../DeviceScanControls';
import { BloodOxygenReading, MicrophoneLevel } from '../SensorReadouts';
import { useClinical } from '../../context/ClinicalContext';
import { measurementValidity } from '../../services/measurementQuality';
import { color, font, radius, space, weight } from '../../theme/tokens';
import { Banner, Button, Card, KeyValue, SectionHeader, StatusPill } from '../ui';

/** Paso 3: pulso validado y el resto de lecturas del dispositivo (con su estado real, sin rellenar). */
export const PulseStep: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const { vitals, connectedType, connectViaServer, isBackendOnline, currentSessionId } = useVitals();
  const { triage } = useClinical();
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { now, readings: display } = useDisplayedMeasurements(vitals, `${currentSessionId}:${connectedType}`);
  const valid = measurementValidity(vitals, now);
  const pulse = display.heartRate;
  const oxygen = display.bloodOxygen;
  const prv = display.hrv;
  const audio = display.audio_rms;
  const stress = display.experimentalStressScore;
  const used = triage?.datos_usados?.vitales_ultimo_minuto;
  const readings = used?.lecturas ?? 0;
  const pulseUsed = used?.fc ?? null;
  const connected = connectedType !== 'none';

  const connect = async () => {
    setConnecting(true);
    const r = await connectViaServer();
    setMessage(r.success ? null : r.message);
    setConnecting(false);
  };

  return (
    <View>
      <SectionHeader title="Pulso" subtitle="Dedo índice sobre el sensor de la banda, sin presionar, con la mano quieta y apoyada." />

      <Card>
        <View style={styles.row}>
          <Ionicons name={connected ? 'radio' : 'radio-outline'} size={22} color={connected ? color.success : color.textMuted} />
          <Text style={styles.deviceText}>
            {connected ? 'Dispositivo conectado: los datos llegan a este paciente.' : 'El dispositivo no está conectado en esta pantalla.'}
          </Text>
          <StatusPill label={connected ? 'Conectado' : 'Sin conectar'} tone={connected ? 'success' : 'warning'} />
        </View>
        {!connected && (
          <View style={{ marginTop: space.md }}>
            <Button label="Conectar ESP32 (WiFi)" icon="wifi" onPress={connect} loading={connecting} />
            <Text style={styles.hint}>Para Bluetooth u otras opciones, usa "Conectar" en el encabezado.</Text>
          </View>
        )}
        {!isBackendOnline && <Banner tone="danger" style={{ marginTop: space.md, marginBottom: 0 }} text="Sin conexión con el servidor." />}
        {message && <Text style={styles.error}>{message}</Text>}
      </Card>

      <DeviceScanControls />

      <Card tone={valid.heartRate ? 'success' : undefined}>
        <Text style={styles.kicker}>Pulso (MAX30102)</Text>
        <View style={styles.bpmRow}>
          <Text style={[styles.bpm, !pulse && { color: color.textMuted }]}>
            {pulse ? Math.round(pulse.value) : '--'}
          </Text>
          <Text style={styles.unit}>BPM</Text>
        </View>
        <Text style={styles.status}>
          {pulse?.state === 'held' ? 'Última lectura válida; esperando una señal estable.' : valid.heartRate ? 'Lectura válida. Se interpreta con la edad y el reposo.' : 'Esperando una lectura estable del sensor…'}
        </Text>
        <View style={styles.progressRow}>
          <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(1, readings / 3) * 100}%` }]} /></View>
          <Text style={styles.progressText}>{Math.min(readings, 3)}/3 lecturas válidas</Text>
        </View>
        {pulseUsed !== null && (
          <Text style={styles.used}>En uso para la valoración: {pulseUsed} BPM (mediana del último minuto)</Text>
        )}
      </Card>

      <View style={{ marginBottom: space.lg }}><BloodOxygenReading reading={oxygen} vitals={vitals} /></View>
      <Card>
        <Text style={styles.cardTitle}>Otras lecturas del dispositivo</Text>
        <View style={styles.grid}>
          <KeyValue label="Variabilidad de pulso (PRV)" value={prv ? `${prv.value} ms` : "--"}
                    hint={prv?.state === "held" ? "Última PRV válida; reuniendo intervalos" : prv ? "RMSSD de intervalos ópticos; no es ECG" : "Reuniendo intervalos de pulso válidos"} />
          <KeyValue label="Estrés experimental" value={stress ? `${stress.value}/100` : 'Sin estimación'}
                    hint={stress?.state === 'held' ? 'Última estimación; no validada' : 'Regla por PRV del firmware; fuera del triaje'} />
        </View>
      </Card>
      <View style={{ marginBottom: space.lg }}><MicrophoneLevel reading={audio} /></View>

      {pulseUsed === null && (
        <Banner tone="warning" text="Puedes continuar sin pulso válido; la valoración lo marcará como dato faltante." />
      )}
      <Button label="Continuar a corazón" icon="arrow-forward" size="lg" full onPress={onNext} />
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  deviceText: { flex: 1, minWidth: 180, fontSize: font.sm, color: color.text, lineHeight: 20 },
  hint: { fontSize: font.xs, color: color.textMuted, marginTop: space.sm },
  error: { fontSize: font.sm, color: color.danger, marginTop: space.sm },
  kicker: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.bold, letterSpacing: 0.4, textTransform: 'uppercase' },
  bpmRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginTop: space.xs },
  bpm: { fontSize: 56, lineHeight: 60, fontWeight: weight.heavy, color: color.text, letterSpacing: -1 },
  unit: { fontSize: font.md, color: color.textSecondary, fontWeight: weight.bold, marginBottom: 10 },
  status: { fontSize: font.sm, color: color.textSecondary, marginTop: space.xs },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: color.surfaceMuted, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: color.success },
  progressText: { fontSize: font.xs, color: color.textSecondary, fontWeight: weight.bold },
  used: { fontSize: font.sm, color: color.success, fontWeight: weight.bold, marginTop: space.sm },
  cardTitle: { fontSize: font.md, fontWeight: weight.heavy, color: color.text, marginBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, rowGap: space.lg },
});
