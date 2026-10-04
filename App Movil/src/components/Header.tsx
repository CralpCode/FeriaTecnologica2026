import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';
import { DeviceConnectionModal } from './DeviceConnectionModal';
import { ClinicalAudioModal } from './ClinicalAudioModal';
import { useLayout } from '../hooks/useLayout';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  onOpenSettings?: () => void;
  onOpenInfo?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title = 'SpiroScan',
  subtitle = 'Monitoreo Biomédico Continuo',
  onOpenSettings,
  onOpenInfo,
}) => {
  const { isDeviceDirectConnected, device, isBackendOnline, currentSessionId } = useVitals();
  const [deviceModalVisible, setDeviceModalVisible] = useState(false);
  const [clinicalDemoVisible, setClinicalDemoVisible] = useState(false);
  const { isPhone } = useLayout();

  return (
    <>
      <View style={styles.container}>
        <View style={styles.leftContainer}>
          <View style={styles.logoBadge}>
            <MaterialCommunityIcons name="heart-pulse" size={24} color={Colors.primary} />
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {isPhone ? 'Sesión ' : `${subtitle} • Sesión `}
              <Text style={{ color: Colors.primary, fontWeight: '700' }}>{currentSessionId}</Text>
            </Text>
          </View>
        </View>

        <View style={styles.rightContainer}>
          {/* Indicador de Nube / Modo Local */}
          <TouchableOpacity
            style={[
              styles.cloudStatusBadge,
              isBackendOnline ? styles.cloudOnline : styles.cloudOffline,
            ]}
            onPress={() => setDeviceModalVisible(true)}
            activeOpacity={0.8}
            accessibilityLabel={isBackendOnline ? 'Servidor conectado' : 'Servidor sin conexión'}
          >
            <MaterialCommunityIcons
              name={isBackendOnline ? 'server-network' : 'server-network-off'}
              size={16}
              color={isBackendOnline ? Colors.success : Colors.textSecondary}
            />
            {!isPhone && (
              <Text style={[styles.cloudStatusText, { color: isBackendOnline ? Colors.success : Colors.textSecondary }]}>
                {isBackendOnline ? 'SERVIDOR' : 'SIN SERVIDOR'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Botón de Estado de Dispositivo (Bluetooth Directo) */}
          <TouchableOpacity
            style={[
              styles.deviceStatusButton,
              isDeviceDirectConnected ? styles.deviceConnected : styles.deviceDisconnected,
            ]}
            onPress={() => setDeviceModalVisible(true)}
            activeOpacity={0.8}
            accessibilityLabel={isDeviceDirectConnected ? 'Dispositivo conectado' : 'Conectar dispositivo'}
          >
            <MaterialCommunityIcons
              name={isDeviceDirectConnected ? 'link-variant' : 'link-variant-off'}
              size={18}
              color={isDeviceDirectConnected ? '#16A34A' : '#EF4444'}
            />
            <Text style={[styles.deviceStatusText, { color: isDeviceDirectConnected ? '#15803D' : '#DC2626' }]}>
              {isDeviceDirectConnected ? 'CONECTADO' : isPhone ? 'CONECTAR' : 'SIN DISPOSITIVO'}
            </Text>
          </TouchableOpacity>

          {/* Botón Discreto de Banco de Pruebas Clínico (Validación ICBHI) */}
          <TouchableOpacity
            style={styles.labDemoButton}
            onPress={() => setClinicalDemoVisible(true)}
            activeOpacity={0.7}
            accessibilityLabel="Banco de Pruebas Clínicas"
          >
            <MaterialCommunityIcons name="flask-outline" size={16} color={Colors.aiPurple} />
          </TouchableOpacity>

          {onOpenSettings && (
            <TouchableOpacity style={styles.iconButton} onPress={onOpenSettings}>
              <Ionicons name="settings-outline" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Modal de Conexión de Dispositivo */}
      <DeviceConnectionModal
        visible={deviceModalVisible}
        onClose={() => setDeviceModalVisible(false)}
        onOpenClinicalDemo={() => setClinicalDemoVisible(true)}
      />

      {/* Modal Discreto de Banco de Pruebas y Validación Clínica */}
      <ClinicalAudioModal
        visible={clinicalDemoVisible}
        onClose={() => setClinicalDemoVisible(false)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  leftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  textContainer: {
    justifyContent: 'center',
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  cloudStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  cloudOnline: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  cloudOffline: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  cloudStatusText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  deviceStatusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
  },
  deviceConnected: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  deviceDisconnected: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
  },
  deviceStatusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labDemoButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3E8FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
});
