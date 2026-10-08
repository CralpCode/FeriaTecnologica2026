import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Text } from '../ui/Text';
import { Ionicons } from '@expo/vector-icons';
import { useVitals } from '../../context/VitalsContext';
import { useClinical } from '../../context/ClinicalContext';
import { measurementValidity, ESTIMATED } from '../../services/measurementQuality';
import { Colors } from '../../theme/colors';
import { color, font, radius, space, tabular, weight } from '../../theme/tokens';
import { Banner, Button, Card, SectionHeader, StatusPill, useReducedMotion, VitalTile } from '../ui';
import { useStepAction } from './stepAction';
import { apiService } from '../../services/api';
import { CapturedPulse } from '../../types/vitals';

/**
 * Paso 3: pulso. Una toma de al menos 15 s con pulso válido queda guardada en el servidor y se sigue
 * mostrando al quitar el dedo; mientras el dedo está puesto se ve la lectura en vivo y el avance.
 */
export const PulseStep: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const { vitals, connectedType, connectViaServer, isBackendOnline, currentSessionId } = useVitals();
  const { triage } = useClinical();
  const [now, setNow] = useState(Date.now());
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [take, setTake] = useState<CapturedPulse | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let alive = true;
    setTake(null);
    const load = () => apiService.getCapturedPulse().then((c) => alive && setTake(c)).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [currentSessionId]);
  useStepAction({ label: 'Continuar a corazón', icon: 'arrow-forward', onPress: onNext });

  const valid = measurementValidity(vitals, now);
  const pulseUsed = triage?.datos_usados?.vitales_ultimo_minuto?.fc ?? null;
  const connected = connectedType !== 'none';
  const live = valid.heartRate ? Math.round(vitals.heartRate) : null;
  const saved = take?.captured ?? null;
  const minSeconds = take?.min_segundos ?? 15;
  const progress = live !== null ? Math.min(take?.en_curso?.segundos ?? 0, minSeconds) : 0;
  const measuring = live !== null && progress < minSeconds;
  const bpm = live ?? (saved ? Math.round(saved.heartRate) : null);
  const savedTime = saved ? new Date(saved.fin).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' }) : '';

  const waitingText = vitals.signalQuality === 'sensor_unavailable'
    ? 'El sensor de pulso no responde. Revisa la banda.'
    : ['no_contact', 'no_finger'].includes(vitals.signalQuality || '')
      ? `Coloca el dedo sobre el sensor y mantenlo al menos ${minSeconds} s.`
      : 'Esperando una lectura estable…';
  const status = measuring
    ? `Mantén el dedo quieto: ${progress} de ${minSeconds} s.`
    : live !== null
      ? 'Lectura guardada. Puedes retirar el dedo o dejarlo durante la consulta.'
      : saved
        ? `Lectura guardada a las ${savedTime} (${saved.segundos} s con el dedo). Se interpreta con la edad y el reposo.`
        : waitingText;
  const pill = measuring ? { label: 'Midiendo', tone: 'info' as const }
    : live !== null || saved ? { label: 'Lectura guardada', tone: 'success' as const }
      : { label: 'Esperando', tone: 'neutral' as const };

  // Fichas: lectura en vivo si el dedo está puesto; si no, la de la toma guardada.
  const oxygen = valid.bloodOxygen || valid.bloodOxygenEstimated ? vitals.bloodOxygen
    : saved?.bloodOxygen ?? null;
  const oxygenEstimated = valid.bloodOxygen ? false : valid.bloodOxygenEstimated || (saved?.spo2_estimated ?? true);
  const hrv = valid.hrv ? vitals.hrv : saved?.hrv ?? null;
  const stress = valid.stress ? vitals.stressLevel : saved?.stressLevel ?? null;

  const connect = async () => {
    setConnecting(true);
    const r = await connectViaServer();
    setMessage(r.success ? null : r.message);
    setConnecting(false);
  };

  return (
    <View>
      <SectionHeader title="Pulso" subtitle="Dedo índice sobre el sensor de la banda, sin presionar, con la mano quieta y apoyada." />

      <View style={[styles.device, connected ? styles.deviceOk : styles.deviceOff]}>
        <Ionicons name={connected ? 'radio' : 'radio-outline'} size={20} color={connected ? color.success : color.warning} />
        <Text style={styles.deviceText}>
          {connected ? 'Dispositivo conectado: los datos llegan a este paciente.' : 'El dispositivo no está conectado en esta pantalla.'}
        </Text>
        {!connected && <Button label="Conectar dispositivo" icon="wifi" size="sm" onPress={connect} loading={connecting} />}
      </View>
      {!isBackendOnline && <Banner tone="danger" text="Sin conexión con el servidor." />}
      {message && <Banner tone="danger" text={message} />}

      <Card elevated style={styles.hero}>
        <View style={styles.heroMain}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.heroHead}>
              <Text style={styles.kicker}>Pulso</Text>
              <StatusPill label={pill.label} tone={pill.tone} dot />
            </View>
            <View style={styles.bpmRow}>
              <Beat bpm={live} />
              <Text style={[styles.bpm, tabular, !bpm && { color: color.textMuted }]}>{bpm ?? '--'}</Text>
              <Text style={styles.unit}>BPM</Text>
            </View>
            <Text style={styles.status}>{status}</Text>
            {measuring && (
              <View style={styles.progress} accessibilityLabel={`${progress} de ${minSeconds} segundos`}>
                <View style={[styles.progressFill, { width: `${(progress / minSeconds) * 100}%` }]} />
              </View>
            )}
            {pulseUsed !== null && (
              <Text style={styles.used}>En uso para la valoración: {pulseUsed} BPM (mediana de la toma guardada)</Text>
            )}
          </View>
          <FingerGuide />
        </View>
      </Card>

      <Text style={styles.sectionTitle}>Otras lecturas</Text>
      <View style={styles.grid}>
        <VitalTile icon="water-percent" tint={Colors.oxygen} label="Oxígeno (SpO2)" unit="%"
                   value={oxygen !== null ? oxygen.toFixed(0) : null}
                   hint={oxygen === null ? 'Esperando señal estable' : oxygenEstimated ? ESTIMATED : 'Estimación calibrada'} />
        <VitalTile icon="heart-flash" tint={Colors.pressure} label="Variabilidad (HRV)" unit="ms"
                   value={hrv !== null ? String(Math.round(hrv)) : null}
                   hint={hrv !== null ? ESTIMATED : 'Esperando pulso estable'} />
        <VitalTile icon="brain" tint={Colors.stress} label="Índice de estrés" unit="/100"
                   value={stress !== null ? String(Math.round(stress)) : null}
                   hint={stress !== null ? ESTIMATED : 'Esperando pulso estable'} />
      </View>

      {pulseUsed === null && (
        <Banner tone="warning" text="Puedes continuar sin pulso válido; la valoración lo marcará como dato faltante." />
      )}
    </View>
  );
};

/** Corazón que late al ritmo medido; quieto si no hay una lectura válida (nunca se inventa un ritmo). */
const Beat: React.FC<{ bpm: number | null }> = ({ bpm }) => {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!bpm || reduced) { v.setValue(1); return; }
    const period = 60000 / bpm;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1.18, duration: Math.min(140, period * 0.2), easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.timing(v, { toValue: 1, duration: Math.min(220, period * 0.3), easing: Easing.in(Easing.quad), useNativeDriver: false }),
      Animated.delay(Math.max(0, period - Math.min(140, period * 0.2) - Math.min(220, period * 0.3))),
    ]));
    loop.start();
    return () => loop.stop();
  }, [bpm, reduced, v]);
  return (
    <Animated.View style={[styles.beat, !bpm && { backgroundColor: color.surfaceMuted }, { transform: [{ scale: v }] }]}>
      <Ionicons name="heart" size={26} color={bpm ? Colors.heartRate : color.textMuted} />
    </Animated.View>
  );
};

/** Cómo poner el dedo: yema sobre la luz roja del sensor, sin presionar. */
const FingerGuide: React.FC = () => (
  <View style={styles.finger} accessibilityLabel="Ilustración: la yema del dedo índice apoyada sobre la luz del sensor, sin presionar">
    <Svg width={150} height={120} viewBox="0 0 150 120">
      <Defs>
        <RadialGradient id="led" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#F43F5E" stopOpacity={0.9} />
          <Stop offset="1" stopColor="#F43F5E" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={14} y={78} width={122} height={26} rx={13} fill="#E5E9EF" stroke="#C3CCD7" />
      <Rect x={55} y={72} width={40} height={14} rx={5} fill="#2B3440" />
      <Circle cx={75} cy={79} r={14} fill="url(#led)" />
      <Circle cx={75} cy={79} r={3} fill="#FB7185" />
      <Path d="M30 14 C44 10 82 30 92 52 C96 60 94 70 86 72 L64 72 C58 72 54 68 52 62 C46 46 36 34 24 28 C18 25 20 16 30 14 Z"
            fill="#F3D9C6" stroke="#C9A48A" strokeWidth={1.2} />
      <Path d="M72 64 C78 66 84 66 88 62" fill="none" stroke="#C9A48A" strokeWidth={1} />
      <Path d="M76 40 C83 42 90 49 93 57 C89 60 82 58 77 52 C75 48 74 43 76 40 Z" fill="#FBEDE4" stroke="#C9A48A" strokeWidth={1} />
    </Svg>
    <Text style={styles.fingerText}>Yema sobre la luz, sin presionar</Text>
  </View>
);

const styles = StyleSheet.create({
  device: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingHorizontal: space.lg, borderRadius: radius.md,
    borderWidth: 1, marginBottom: space.lg, flexWrap: 'wrap',
  },
  deviceOk: { backgroundColor: color.successSoft, borderColor: '#A7F3D0' },
  deviceOff: { backgroundColor: color.warningSoft, borderColor: '#FDE68A' },
  deviceText: { flex: 1, minWidth: 180, fontSize: font.sm, color: color.text, lineHeight: 20 },
  hero: { padding: space.xl },
  heroMain: { flexDirection: 'row', alignItems: 'center', gap: space.xl, flexWrap: 'wrap' },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  kicker: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  bpmRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  beat: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.heartRateSoft, alignItems: 'center', justifyContent: 'center' },
  bpm: { fontSize: 64, lineHeight: 68, fontWeight: weight.heavy, color: color.text, letterSpacing: -2 },
  unit: { fontSize: font.lg, color: color.textSecondary, fontWeight: weight.bold, alignSelf: 'flex-end', marginBottom: 10 },
  status: { fontSize: font.sm, color: color.textSecondary, marginTop: space.xs },
  progress: { height: 8, borderRadius: 4, backgroundColor: color.surfaceMuted, marginTop: space.md, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: color.info },
  used: { fontSize: font.sm, color: color.success, fontWeight: weight.bold, marginTop: space.md },
  finger: { alignItems: 'center', gap: space.xs, marginHorizontal: 'auto' as any },
  fingerText: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.medium },
  sectionTitle: { fontSize: font.md, fontWeight: weight.heavy, color: color.text, marginBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginBottom: space.lg },
});
