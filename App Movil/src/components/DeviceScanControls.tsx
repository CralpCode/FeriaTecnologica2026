import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useVitals } from '../context/VitalsContext';
import { Colors } from '../theme/colors';

/** Controles BLE de main: el tiempo y el estado proceden del ESP32. */
export const DeviceScanControls: React.FC<{ onOpenPulmonary?: () => void }> = ({ onOpenPulmonary }) => {
  const { vitals, connectedType, startCardiacScan, startPulmonaryScan, startContinuousMode, stopScan, powerOffDevice } = useVitals();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const send = async (action: () => Promise<boolean>) => {
    setBusy(true);
    try { setMessage(await action() ? 'Comando enviado; espera la confirmación del dispositivo.' : 'No se pudo enviar el comando. Revisa el enlace BLE.'); }
    catch { setMessage('No se pudo enviar el comando.'); }
    finally { setBusy(false); }
  };
  const controls = [
    ['Pulso · 20 s', startCardiacScan], ['Audio · 20 s', startPulmonaryScan],
    ['Continuo', startContinuousMode], ['Detener', stopScan], ['Reposo', powerOffDevice],
  ] as const;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Control del ESP32</Text>
      <Text style={styles.state}>
        {vitals.power === 'standby' ? 'En reposo' : vitals.scan_mode === 'cardiac' && vitals.scan_phase === 'calibrating'
          ? 'Adquiriendo pulso; los 20 s comienzan cuando se detecta una lectura válida'
          : `Modo: ${vitals.scan_mode ?? 'none'} · ${vitals.scan_sec ?? 0} s`}
      </Text>
      {connectedType === 'direct_ble' ? (
        <View style={styles.buttons}>
          {controls.map(([label, action]) => <TouchableOpacity key={label} style={[styles.button, busy && { opacity: 0.5 }]}
            disabled={busy} onPress={() => send(action)} accessibilityRole="button"><Text style={styles.buttonText}>{label}</Text></TouchableOpacity>)}
        </View>
      ) : <Text style={styles.state}>Usa K1 para pulso, K2 para audio o conecta por BLE para controlar desde la app.</Text>}
      {!!message && <Text style={styles.state}>{message}</Text>}
      {onOpenPulmonary && <TouchableOpacity onPress={onOpenPulmonary} accessibilityRole="button">
        <Text style={styles.link}>Abrir auscultación pulmonar</Text>
      </TouchableOpacity>}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 12 },
  title: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  state: { color: Colors.textSecondary, fontSize: 12, marginTop: 6 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  button: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  buttonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 12 },
  link: { color: Colors.primary, fontWeight: '600', marginTop: 10 },
});
