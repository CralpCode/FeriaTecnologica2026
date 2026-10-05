import React, { useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from './ui/Text';
import { Ionicons } from '@expo/vector-icons';
import { useModalLayout } from '../hooks/useLayout';
import { useDeviceConnection } from '../context/VitalsContext';
import { deviceBridge } from '../services/DeviceBridgeService';
import { DEFAULT_LOCAL_LAN } from '../config/api';
import { patientLabel } from '../services/consulta';
import { color, font, radius, space, touch, weight } from '../theme/tokens';
import { Banner, Button, Card, StatusPill } from './ui';

interface DeviceConnectionModalProps {
  visible: boolean;
  onClose: () => void;
}

const STATUS_TEXT: Record<string, { title: string; text: string }> = {
  wokwi_wifi: { title: 'ESP32 por WiFi', text: 'Los datos del dispositivo llegan al servidor y se guardan en el paciente abierto.' },
  direct_ble: { title: 'Bluetooth directo', text: 'Recibiendo el sensor directamente por Bluetooth.' },
  demo_icbhi: { title: 'Modo demostración', text: 'Audio real de ICBHI 2017, de otra persona. Este modo no tiene pulso ni SpO2.' },
  none: { title: 'Sin conectar', text: 'Elige cómo recibir los datos del dispositivo.' },
};

/** Conexión del dispositivo: estado, WiFi (recomendado) y Bluetooth; lo técnico en "Avanzado". */
export const DeviceConnectionModal: React.FC<DeviceConnectionModalProps> = ({ visible, onClose }) => {
  const modal = useModalLayout();
  const {
    connectedType, device, connectDirectBluetooth, connectViaServer, disconnectAllDevices,
    isBackendOnline, backendUrl, updateBackendUrl, currentSessionId,
  } = useDeviceConnection();
  const [busy, setBusy] = useState<'wifi' | 'ble' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const connected = connectedType !== 'none';
  const status = STATUS_TEXT[connectedType] || STATUS_TEXT.none;
  const bleAvailable = Platform.OS !== 'web' || deviceBridge.isWebBluetoothSupported();
  const isLocal = backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1');

  const run = async (kind: 'wifi' | 'ble') => {
    setError(null); setBusy(kind);
    try {
      const res = kind === 'wifi' ? await connectViaServer() : await connectDirectBluetooth();
      if (res.success) onClose();
      else setError(res.message);
    } catch (e: any) {
      setError(e?.message || 'No se pudo conectar.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} animationType={modal.animationType} transparent onRequestClose={onClose}>
      <View style={[styles.overlay, modal.overlay]}>
        <View style={[styles.sheet, modal.sheet]}>
          <View style={styles.head}>
            <Text style={styles.title}>Dispositivo</Text>
            <TouchableOpacity onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Cerrar">
              <Ionicons name="close" size={22} color={color.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Card tone={connected ? 'success' : undefined}>
              <View style={styles.row}>
                <Ionicons name={connected ? 'radio' : 'radio-outline'} size={24} color={connected ? color.success : color.textMuted} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cardTitle}>{status.title}{connected && device?.name ? ` · ${device.name}` : ''}</Text>
                  <Text style={styles.text}>{status.text}</Text>
                  <Text style={styles.meta}>Paciente abierto: {patientLabel(currentSessionId)}</Text>
                </View>
              </View>
              {connected && (
                <Button label="Desconectar" variant="secondary" icon="close-circle-outline" onPress={disconnectAllDevices}
                        style={{ marginTop: space.md }} />
              )}
            </Card>

            {error && <Banner tone="danger" text={error} />}

            <Text style={styles.section}>Conectar</Text>
            <Card>
              <View style={styles.row}>
                <Ionicons name="wifi" size={22} color={color.primary} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.titleRow}>
                    <Text style={styles.cardTitle}>ESP32 por WiFi</Text>
                    <StatusPill label="Recomendado" tone="primary" />
                  </View>
                  <Text style={styles.text}>El ESP32 envía pulso y audio al servidor. Funciona en cualquier celular o computadora con el navegador.</Text>
                </View>
              </View>
              <Button label={connectedType === 'wokwi_wifi' ? 'Recibiendo datos' : 'Recibir datos en este paciente'} icon="wifi"
                      onPress={() => run('wifi')} loading={busy === 'wifi'} disabled={connectedType === 'wokwi_wifi'}
                      style={{ marginTop: space.md }} />
            </Card>

            <Card>
              <View style={styles.row}>
                <Ionicons name="bluetooth" size={22} color={color.primary} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cardTitle}>Bluetooth directo</Text>
                  <Text style={styles.text}>
                    Enlaza la banda directamente. En la app Android usa Bluetooth nativo; en el navegador solo funciona
                    en Chrome o Edge con https o en este equipo. En la feria conviene WiFi.
                  </Text>
                </View>
              </View>
              {connectedType === 'direct_ble' ? (
                <Button label="Desconectar Bluetooth" variant="secondary" icon="bluetooth" onPress={disconnectAllDevices} style={{ marginTop: space.md }} />
              ) : (
                <Button label="Buscar y enlazar" variant="secondary" icon="bluetooth" onPress={() => run('ble')}
                        loading={busy === 'ble'} disabled={!bleAvailable} style={{ marginTop: space.md }} />
              )}
              {!bleAvailable && <Text style={styles.meta}>Este navegador no tiene Bluetooth web.</Text>}
            </Card>

            <TouchableOpacity style={styles.advancedHead} onPress={() => setAdvanced((v) => !v)} accessibilityRole="button"
                              accessibilityState={{ expanded: advanced }}>
              <Text style={styles.section}>Avanzado</Text>
              <Ionicons name={advanced ? 'chevron-up' : 'chevron-down'} size={18} color={color.textMuted} />
            </TouchableOpacity>
            {advanced && (
              <>
                <Card>
                  <View style={styles.titleRow}>
                    <Text style={styles.cardTitle}>Servidor SpiroScan (Mac)</Text>
                    <StatusPill label={isBackendOnline ? 'En línea' : 'Sin conexión'} tone={isBackendOnline ? 'success' : 'danger'} />
                  </View>
                  <Text style={styles.text}>
                    {isBackendOnline ? 'Base de datos, alertas e IA disponibles.'
                      : 'No se encuentra la Mac: revisa que start_server.sh esté corriendo y que estés en la misma red.'}
                  </Text>
                  <View style={styles.presets}>
                    <Preset label="LAN local" active={backendUrl === DEFAULT_LOCAL_LAN} onPress={() => updateBackendUrl(DEFAULT_LOCAL_LAN)} />
                    <Preset label="Este equipo" active={isLocal} onPress={() => updateBackendUrl('http://localhost:8000')} />
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>Dirección: {backendUrl}</Text>
                </Card>

              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const Preset: React.FC<{ label: string; active: boolean; onPress: () => void }> = ({ label, active, onPress }) => (
  <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]} accessibilityRole="button"
                    accessibilityState={{ selected: active }}>
    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(17,24,39,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xl, maxHeight: '92%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  title: { fontSize: font.lg, fontWeight: weight.heavy, color: color.text },
  close: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', marginBottom: 2 },
  cardTitle: { fontSize: font.md, fontWeight: weight.heavy, color: color.text },
  text: { fontSize: font.sm, color: color.textSecondary, lineHeight: 20, marginTop: 2 },
  meta: { fontSize: font.xs, color: color.textMuted, marginTop: space.sm },
  section: { fontSize: font.xs, fontWeight: weight.heavy, color: color.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: space.sm },
  advancedHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: touch, cursor: 'pointer' as any },
  presets: { flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' },
  chips: { flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: space.md,
    borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, cursor: 'pointer' as any,
  },
  chipActive: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { fontSize: font.xs, fontWeight: weight.bold, color: color.textSecondary },
  chipTextActive: { color: '#FFFFFF' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.success },
});
