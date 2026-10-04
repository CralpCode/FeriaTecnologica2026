import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from './ui/Text';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useVitals } from '../context/VitalsContext';
import { useLayout } from '../hooks/useLayout';
import { patientLabel, isNamedPatient, relativeTime } from '../services/consulta';
import { apiService } from '../services/api';
import { color, font, radius, space, touch, weight } from '../theme/tokens';
import { DeviceConnectionModal } from './DeviceConnectionModal';
import { ClinicalAudioModal } from './ClinicalAudioModal';
import { AIExplainerModal } from './AIExplainerModal';
import { NewPatientModal } from './NewPatientModal';

interface HeaderProps {
  /** Se llama después de crear un paciente nuevo (p. ej. para ir a la consulta). */
  onNewPatient?: () => void;
}

/** Encabezado: paciente actual, nuevo paciente, estado del dispositivo y menú "Más". */
export const Header: React.FC<HeaderProps> = ({ onNewPatient }) => {
  const { isDeviceDirectConnected, isBackendOnline, currentSessionId, connectedType } = useVitals();
  const { isPhone } = useLayout();
  const [deviceVisible, setDeviceVisible] = useState(false);
  const [demoVisible, setDemoVisible] = useState(false);
  const [explainerVisible, setExplainerVisible] = useState(false);
  const [newVisible, setNewVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [backupText, setBackupText] = useState<{ text: string; ok: boolean } | null>(null);

  // Estado del respaldo automático: se consulta al abrir el menú
  useEffect(() => {
    if (!menuVisible) return;
    apiService.getBackupStatus().then((b) => {
      if (b.error) setBackupText({ text: `Respaldo falló ${relativeTime(b.error.hora)}`, ok: false });
      else if (!b.activo) setBackupText({ text: 'Respaldo automático apagado', ok: false });
      else if (b.ultimo) setBackupText({ text: `Último respaldo ${relativeTime(b.ultimo.hora)}`, ok: true });
      else setBackupText({ text: 'Primer respaldo en un minuto', ok: true });
    }).catch(() => setBackupText(null));
  }, [menuVisible]);
  const named = isNamedPatient(currentSessionId);
  const demo = connectedType === 'demo_icbhi';

  const openFromMenu = (open: () => void) => { setMenuVisible(false); open(); };

  return (
    <>
      <View style={styles.bar}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <MaterialCommunityIcons name="heart-pulse" size={22} color={color.primary} />
          </View>
          <View style={{ minWidth: 0, flexShrink: 1 }}>
            <Text style={styles.title} numberOfLines={1}>SpiroScan</Text>
            <Text style={styles.patient} numberOfLines={1}>
              {named ? `Paciente ${patientLabel(currentSessionId)}` : 'Sin paciente identificado'}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => setNewVisible(true)}
                            accessibilityRole="button" accessibilityLabel="Nuevo paciente">
            <Ionicons name="person-add" size={18} color="#FFFFFF" />
            {!isPhone && <Text style={styles.btnPrimaryText}>Nuevo paciente</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, isDeviceDirectConnected ? styles.btnOk : styles.btnOutline]}
            onPress={() => setDeviceVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={isDeviceDirectConnected ? 'Dispositivo conectado' : 'Conectar dispositivo'}
          >
            <Ionicons name={isDeviceDirectConnected ? 'radio' : 'radio-outline'} size={18}
                      color={isDeviceDirectConnected ? color.success : color.textSecondary} />
            <Text style={[styles.btnText, { color: isDeviceDirectConnected ? color.success : color.text }]}>
              {demo ? 'Demo' : isDeviceDirectConnected ? 'Conectado' : 'Conectar'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, styles.iconBtn]} onPress={() => setMenuVisible(true)}
                            accessibilityRole="button" accessibilityLabel="Más opciones">
            <Ionicons name="ellipsis-vertical" size={18} color={color.text} />
            {!isBackendOnline && <View style={styles.offlineDot} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Menú "Más" */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)}>
          <View style={styles.menu}>
            <View style={[styles.menuStatus, !!backupText && { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 2 }]}>
              <View style={[styles.statusDot, { backgroundColor: isBackendOnline ? color.success : color.danger }]} />
              <Text style={styles.menuStatusText}>{isBackendOnline ? 'Servidor en línea' : 'Sin conexión con el servidor'}</Text>
            </View>
            {backupText && (
              <View style={[styles.menuStatus, { paddingTop: 2 }]}>
                <Ionicons name={backupText.ok ? 'cloud-done-outline' : 'cloud-offline-outline'} size={14}
                          color={backupText.ok ? color.success : color.danger} />
                <Text style={[styles.menuStatusText, !backupText.ok && { color: color.danger }]}>{backupText.text}</Text>
              </View>
            )}
            <MenuItem icon="hardware-chip-outline" label="Dispositivo y servidor" onPress={() => openFromMenu(() => setDeviceVisible(true))} />
            <MenuItem icon="flask-outline" label="Banco de pruebas (casos ICBHI)" onPress={() => openFromMenu(() => setDemoVisible(true))} />
            <MenuItem icon="information-circle-outline" label="¿Cómo funciona la IA?" onPress={() => openFromMenu(() => setExplainerVisible(true))} />
          </View>
        </Pressable>
      </Modal>

      <NewPatientModal visible={newVisible} onClose={() => setNewVisible(false)} onCreated={onNewPatient} />
      <DeviceConnectionModal visible={deviceVisible} onClose={() => setDeviceVisible(false)} />
      <ClinicalAudioModal visible={demoVisible} onClose={() => setDemoVisible(false)} />
      <AIExplainerModal visible={explainerVisible} onClose={() => setExplainerVisible(false)} />
    </>
  );
};

const MenuItem: React.FC<{ icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }> = ({ icon, label, onPress }) => (
  <TouchableOpacity style={styles.menuItem} onPress={onPress} accessibilityRole="menuitem">
    <Ionicons name={icon} size={20} color={color.textSecondary} />
    <Text style={styles.menuText}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm,
    paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 60,
    backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1, minWidth: 0 },
  logo: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: color.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: font.md, fontWeight: weight.heavy, color: color.text, letterSpacing: -0.3 },
  patient: { fontSize: font.xs, color: color.textSecondary, fontWeight: weight.medium },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 0 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, minWidth: 40, paddingHorizontal: space.md,
    borderRadius: radius.md, borderWidth: 1, justifyContent: 'center', cursor: 'pointer' as any,
  },
  btnPrimary: { backgroundColor: color.primary, borderColor: color.primary },
  btnPrimaryText: { color: '#FFFFFF', fontSize: font.sm, fontWeight: weight.bold },
  btnOutline: { backgroundColor: color.surface, borderColor: color.borderStrong },
  btnOk: { backgroundColor: color.successSoft, borderColor: '#A7F3D0' },
  btnText: { fontSize: font.sm, fontWeight: weight.bold },
  iconBtn: { paddingHorizontal: 0, width: 40, backgroundColor: color.surface, borderColor: color.border },
  offlineDot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: color.danger },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.15)' },
  menu: {
    position: 'absolute', top: 58, right: space.lg, width: 280, backgroundColor: color.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, paddingVertical: space.sm,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  menuStatus: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderBottomWidth: 1, borderBottomColor: color.border, marginBottom: space.xs,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  menuStatusText: { fontSize: font.xs, color: color.textSecondary, fontWeight: weight.medium },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch, paddingHorizontal: space.lg, cursor: 'pointer' as any },
  menuText: { fontSize: font.sm, color: color.text, fontWeight: weight.medium },
});
