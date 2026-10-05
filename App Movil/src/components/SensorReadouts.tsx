import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { DisplayReading } from '../services/measurementDisplay';
import type { VitalSigns } from '../types/vitals';
import { color, font, radius, space, weight } from '../theme/tokens';

export function BloodOxygenReading({ reading, vitals }: { reading?: DisplayReading; vitals: VitalSigns }) {
  const status = reading?.state === 'held' ? 'Última estimación; esperando señal'
    : reading ? (reading.calibrated ? 'Estimación calibrada' : 'Estimación sin calibrar')
    : vitals.device_connected === false ? 'Dispositivo sin conexión'
    : vitals.power === 'standby' || vitals.scan_mode === 'none' ? 'Inicia modo infinito o prueba cardíaca'
    : vitals.finger ? 'El sensor todavía no entrega una estimación válida'
    : 'Coloca el dedo quieto sobre el MAX30102';
  return (
    <View style={[styles.panel, styles.oxygen]}>
      <View style={styles.heading}>
        <MaterialCommunityIcons name="water-percent" size={22} color={color.info} />
        <Text style={styles.title}>Oxígeno en sangre (SpO₂)</Text>
      </View>
      <View style={styles.oxygenValue}>
        <Text style={[styles.number, !reading && styles.muted]}>{reading ? reading.value.toFixed(1) : '—'}</Text>
        {reading && <Text style={styles.unit}>%</Text>}
        {!reading && <Text style={styles.waiting}>Esperando lectura</Text>}
      </View>
      <Text style={styles.hint}>{status}</Text>
      <Text style={styles.caption}>{reading && !reading.calibrated ? 'MAX30102 · Fuera de la valoración clínica' : 'MAX30102'}</Text>
    </View>
  );
}

export function MicrophoneLevel({ reading }: { reading?: DisplayReading }) {
  const [details, setDetails] = useState(false);
  // A visual meter only. Keep the original reading and unit for telemetry/AI.
  const digital = reading?.unit === 'dBFS';
  const level = reading ? Math.max(0, Math.min(100, digital
    ? (reading.value + 90) / 60 * 100
    : (reading.value - 30) / 75 * 100)) : 0;
  const label = !reading ? 'Sin señal' : level < 35 ? 'Bajo' : level < 70 ? 'Medio' : 'Alto';
  return (
    <View style={styles.panel}>
      <View style={styles.heading}>
        <MaterialCommunityIcons name="microphone" size={22} color={color.primary} />
        <Text style={styles.title}>Nivel del micrófono</Text>
        <Text style={[styles.levelLabel, !reading && styles.muted]}>{label}</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel={`Nivel del micrófono: ${label}`}
        accessibilityValue={reading ? { min: 0, max: 100, now: Math.round(level) } : { text: 'Sin señal' }}
        style={styles.track}>
        <View style={[styles.fill, { width: `${level}%`, opacity: reading?.state === 'held' ? 0.5 : 1 }]} />
      </View>
      <View style={styles.legend}><Text style={styles.caption}>Suave</Text><Text style={styles.caption}>Fuerte</Text></View>
      <Text style={styles.hint}>{reading?.state === 'held' ? 'Último nivel recibido; esperando señal'
        : reading ? 'La barra sube cuando aumenta la señal del micrófono' : 'Esperando datos del micrófono'}</Text>
      <Pressable onPress={() => setDetails(!details)} accessibilityRole="button" accessibilityState={{ expanded: details }}
        style={styles.detailButton}>
        <Text style={styles.detailLink}>{details ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}</Text>
      </Pressable>
      {details && <Text style={styles.caption}>{reading ? `${reading.value.toFixed(1)} ${digital ? 'dBFS' : 'unidades relativas'}. ` : ''}
        {digital ? 'Escala visual de −90 a −30 dBFS; no mide decibeles ambientales.' : 'Escala visual relativa; micrófono sin calibración acústica.'}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flexGrow: 1, flexBasis: 220, padding: space.lg, borderRadius: radius.lg,
    borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  oxygen: { borderColor: '#BAE6FD', backgroundColor: color.infoSoft },
  heading: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  title: { flex: 1, fontSize: font.md, fontWeight: weight.bold, color: color.text },
  oxygenValue: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: space.md },
  number: { fontSize: 42, fontWeight: weight.heavy, color: color.info },
  unit: { fontSize: font.xl, fontWeight: weight.bold, color: color.info },
  waiting: { fontSize: font.sm, color: color.textSecondary },
  muted: { color: color.textMuted },
  hint: { fontSize: font.sm, lineHeight: 20, color: color.textSecondary, marginTop: space.sm },
  caption: { fontSize: font.xs, lineHeight: 18, color: color.textMuted },
  levelLabel: { fontSize: font.sm, fontWeight: weight.bold, color: color.primary },
  track: { height: 16, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: color.surfaceMuted, marginTop: space.lg },
  fill: { height: '100%', backgroundColor: color.primary, borderRadius: radius.pill },
  legend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
  detailButton: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44 },
  detailLink: { fontSize: font.xs, color: color.primary, fontWeight: weight.medium },
});
