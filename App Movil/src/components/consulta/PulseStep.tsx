import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Text } from '../ui/Text';
import { Ionicons } from '@expo/vector-icons';
import { useVitals } from '../../context/VitalsContext';
import { useClinical } from '../../context/ClinicalContext';
import { measurementValidity } from '../../services/measurementQuality';
import { Colors } from '../../theme/colors';
import { color, font, radius, space, tabular, weight } from '../../theme/tokens';
import { Banner, Button, Card, SectionHeader, StatusPill, useReducedMotion, VitalTile } from '../ui';
import { useStepAction } from './stepAction';

/** Paso 3: pulso validado y el resto de lecturas del dispositivo (con su estado real, sin rellenar). */
export const PulseStep: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const { vitals, connectedType, connectViaServer, isBackendOnline } = useVitals();
  const { triage } = useClinical();
  const [now, setNow] = useState(Date.now());
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useStepAction({ label: 'Continuar a corazón', icon: 'arrow-forward', onPress: onNext });

  const valid = measurementValidity(vitals, now);
  const used = triage?.datos_usados?.vitales_ultimo_minuto;
  const readings = Math.min(3, used?.lecturas ?? 0);
  const pulseUsed = used?.fc ?? null;
  const connected = connectedType !== 'none';
  const bpm = valid.heartRate ? Math.round(vitals.heartRate) : null;
  const audioAvailable = vitals.source === 'real' && vitals.audioUnit === 'dBFS'
    && Number.isFinite(vitals.audio_rms) && vitals.audio_rms < 0 && now - Date.parse(vitals.timestamp) < 10000;

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
        {!connected && <Button label="Conectar ESP32" icon="wifi" size="sm" onPress={connect} loading={connecting} />}
      </View>
      {!isBackendOnline && <Banner tone="danger" text="Sin conexión con el servidor." />}
      {message && <Banner tone="danger" text={message} />}

      <Card elevated style={styles.hero}>
        <View style={styles.heroMain}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.heroHead}>
              <Text style={styles.kicker}>Pulso · MAX30102</Text>
              <StatusPill label={bpm ? 'Lectura válida' : 'Esperando'} tone={bpm ? 'success' : 'neutral'} dot />
            </View>
            <View style={styles.bpmRow}>
              <Beat bpm={bpm} />
              <Text style={[styles.bpm, tabular, !bpm && { color: color.textMuted }]}>{bpm ?? '--'}</Text>
              <Text style={styles.unit}>BPM</Text>
            </View>
            <Text style={styles.status}>
              {bpm ? 'Se interpreta con la edad y el reposo.' : 'Esperando una lectura estable del sensor…'}
            </Text>
            <View style={styles.readings} accessibilityLabel={`${readings} de 3 lecturas válidas`}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.readingDot, i < readings && styles.readingDotOn]}>
                  {i < readings && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
                </View>
              ))}
              <Text style={styles.readingsText}>{readings}/3 lecturas válidas en el último minuto</Text>
            </View>
            {pulseUsed !== null && (
              <Text style={styles.used}>En uso para la valoración: {pulseUsed} BPM (mediana del último minuto)</Text>
            )}
          </View>
          <FingerGuide />
        </View>
      </Card>

      <Text style={styles.sectionTitle}>Otras lecturas del dispositivo</Text>
      <View style={styles.grid}>
        <VitalTile icon="water-percent" tint={Colors.oxygen} label="Oxígeno (SpO2)" unit="%"
                   value={valid.bloodOxygen ? vitals.bloodOxygen.toFixed(1) : null}
                   hint={valid.bloodOxygen ? 'Estimación calibrada' : 'No disponible: sin calibración'} source="MAX30102" />
        <VitalTile icon="heart-flash" tint={Colors.pressure} label="Variabilidad (HRV)" unit="ms" value={null}
                   hint="No disponible: no validada" source="MAX30102" />
        <VitalTile icon="brain" tint={Colors.stress} label="Índice de estrés" unit="/100" value={null}
                   hint="No disponible: experimental" source="Estimación" />
        <VitalTile icon="microphone" tint={Colors.audio} label="Micrófono" unit="dBFS"
                   value={audioAvailable ? vitals.audio_rms.toFixed(1) : null}
                   hint={audioAvailable ? 'Nivel digital, no presión sonora' : 'Sin lectura de audio'} source="INMP441" />
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
  readings: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg, flexWrap: 'wrap' },
  readingDot: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: color.borderStrong, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  readingDotOn: { backgroundColor: color.success, borderColor: color.success },
  readingsText: { fontSize: font.xs, color: color.textSecondary, fontWeight: weight.bold, marginLeft: space.xs },
  used: { fontSize: font.sm, color: color.success, fontWeight: weight.bold, marginTop: space.md },
  finger: { alignItems: 'center', gap: space.xs, marginHorizontal: 'auto' as any },
  fingerText: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.medium },
  sectionTitle: { fontSize: font.md, fontWeight: weight.heavy, color: color.text, marginBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginBottom: space.lg },
});
