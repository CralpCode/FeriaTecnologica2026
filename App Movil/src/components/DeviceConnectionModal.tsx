import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';
import { deviceBridge } from '../services/DeviceBridgeService';
import { DEFAULT_CLOUD_BACKEND, DEFAULT_LOCAL_LAN } from '../config/api';

interface DeviceConnectionModalProps {
  visible: boolean;
  onClose: () => void;
  onOpenClinicalDemo?: () => void;
}

export const DeviceConnectionModal: React.FC<DeviceConnectionModalProps> = ({ visible, onClose, onOpenClinicalDemo }) => {
  const {
    connectedType,
    device,
    connectDirectBluetooth,
    disconnectAllDevices,
    isBackendOnline,
    backendUrl,
    updateBackendUrl,
    currentSessionId,
    availableSessions,
    createNewSession,
    switchSession,
  } = useVitals();

  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleBluetoothConnect = async () => {
    setErrorMessage(null);
    setIsConnecting(true);

    try {
      const res = await connectDirectBluetooth();
      if (!res.success) {
        setErrorMessage(res.message);
      } else {
        onClose();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al conectar por Bluetooth.');
    } finally {
      setIsConnecting(false);
    }
  };

  const isWebBleSupported = deviceBridge.isWebBluetoothSupported();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Cabecera */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View
                style={[
                  styles.bluetoothIconCircle,
                  connectedType !== 'none' && styles.iconConnected,
                ]}
              >
                <MaterialCommunityIcons
                  name={connectedType !== 'none' ? 'check-circle' : 'bluetooth'}
                  size={22}
                  color={connectedType !== 'none' ? '#16A34A' : Colors.primary}
                />
              </View>
              <View>
                <Text style={styles.headerTitle}>Gestor Bluetooth Directo</Text>
                <Text style={styles.headerSubtitle}>
                  {connectedType !== 'none'
                    ? `● Enlazado a: ${device?.name || 'SpiroScan-Band'}`
                    : '○ Sin conexión activa'}
                </Text>
              </View>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Banner de Estado */}
          <View
            style={[
              styles.statusBanner,
              connectedType !== 'none' ? styles.statusBannerOnline : styles.statusBannerOffline,
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View
                style={[
                  styles.statusDotLarge,
                  { backgroundColor: connectedType !== 'none' ? '#16A34A' : '#DC2626' },
                ]}
              />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text
                  style={[
                    styles.statusBannerTitle,
                    { color: connectedType !== 'none' ? '#15803D' : '#991B1B' },
                  ]}
                >
                  {connectedType === 'direct_ble'
                    ? 'ENLACE DIRECTO BLUETOOTH BLE ACTIVO'
                    : connectedType === 'demo_icbhi'
                    ? 'BANCO DE PRUEBAS CLÍNICAS (ICBHI 2017)'
                    : connectedType !== 'none'
                    ? 'ENLAZADO A SPIROSCAN'
                    : 'DISPOSITIVO EN ESPERA (CERO ABSOLUTO)'}
                </Text>
                <Text
                  style={[
                    styles.statusBannerDesc,
                    { color: connectedType !== 'none' ? '#166534' : '#7F1D1D' },
                  ]}
                >
                  {connectedType === 'demo_icbhi'
                    ? 'Simulando paciente real con auscultación torácica y constantes biomédicas.'
                    : connectedType !== 'none'
                    ? 'Recibiendo telemetría física en tiempo real del sensor MAX30102.'
                    : 'Sincroniza directamente con tu pulsera SpiroScan por Bluetooth.'}
                </Text>
              </View>
            </View>

            {connectedType !== 'none' && (
              <TouchableOpacity
                style={styles.disconnectBtn}
                onPress={disconnectAllDevices}
              >
                <Text style={styles.disconnectBtnText}>Desconectar</Text>
              </TouchableOpacity>
            )}
          </View>

          {errorMessage && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#B91C1C" />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionHeading}>DISPOSITIVO FÍSICO (BLE)</Text>

            {/* Opción SpiroScan BLE Físico */}
            <View
              style={[
                styles.deviceCard,
                connectedType !== 'none' && styles.deviceCardActive,
              ]}
            >
              <View style={styles.deviceCardHeader}>
                <View
                  style={[
                    styles.deviceIconWrapper,
                    { backgroundColor: connectedType !== 'none' ? '#DCFCE7' : '#EFF6FF' },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="bluetooth"
                    size={22}
                    color={connectedType !== 'none' ? '#16A34A' : Colors.primary}
                  />
                </View>

                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.deviceCardTitle}>SpiroScan-Band (ESP32 BLE)</Text>
                  <Text style={styles.deviceCardSub}>
                    MAX30102 + INMP441 + GATT Dual
                  </Text>
                  <Text style={styles.deviceCardBadgeText}>
                    Enlace Inalámbrico 100% Autónomo
                  </Text>
                </View>

                <View style={[styles.devicePill, connectedType !== 'none' ? styles.devicePillConnected : styles.devicePillDisconnected]}>
                  <Text style={[styles.devicePillText, { color: connectedType !== 'none' ? '#15803D' : '#64748B' }]}>
                    {connectedType !== 'none' ? 'ENLAZADO' : 'STANDBY'}
                  </Text>
                </View>
              </View>

              {/* Botón de Acción a Ancho Completo (Sin Desbordamientos en Móvil) */}
              <TouchableOpacity
                style={[
                  styles.actionBtnFull,
                  connectedType !== 'none' ? styles.actionBtnDisconnect : styles.actionBtnConnect,
                  isConnecting && { opacity: 0.7 },
                ]}
                disabled={isConnecting}
                onPress={() => {
                  if (connectedType !== 'none') {
                    disconnectAllDevices();
                  } else {
                    handleBluetoothConnect();
                  }
                }}
              >
                {isConnecting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <View style={styles.actionBtnContent}>
                    <MaterialCommunityIcons
                      name={connectedType !== 'none' ? 'bluetooth-off' : 'bluetooth-connect'}
                      size={18}
                      color={connectedType !== 'none' ? '#DC2626' : '#FFFFFF'}
                    />
                    <Text
                      style={[
                        styles.actionBtnTextFull,
                        connectedType !== 'none' ? styles.actionTextDisconnect : styles.actionTextConnect,
                      ]}
                    >
                      {connectedType !== 'none' ? 'Desconectar Dispositivo' : 'Sincronizar Dispositivo'}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Guía de Compatibilidad Independiente */}
            <View style={styles.guideCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Ionicons name="phone-portrait-outline" size={16} color={Colors.primary} />
                <Text style={styles.guideTitle}>Funcionamiento Independiente:</Text>
              </View>

              <View style={styles.guideRow}>
                <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
                <Text style={styles.guideStep}>
                  <Text style={{ fontWeight: '700' }}>En APK Android: </Text>
                  Toca "Sincronizar Dispositivo" para escanear y enlazar por Bluetooth BLE nativo.
                </Text>
              </View>

              <View style={styles.guideRow}>
                <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
                <Text style={styles.guideStep}>
                  <Text style={{ fontWeight: '700' }}>En Web (PC / Móvil): </Text>
                  Abre en Chrome/Edge y toca "Sincronizar Dispositivo" para enlazar.
                </Text>
              </View>

              <View style={styles.guideRow}>
                <Ionicons name="shield-checkmark" size={14} color="#2563EB" />
                <Text style={styles.guideStep}>
                  Cero cables ni servidores intermedios: conexión directa por radio BLE.
                </Text>
              </View>
            </View>

            {/* Sección de Servidor Backend y Nube */}
            <Text style={[styles.sectionHeading, { marginTop: 18 }]}>NUBE & BACKEND (DOCKER / MODO HÍBRIDO)</Text>

            <View style={styles.cloudConfigCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <MaterialCommunityIcons
                    name={isBackendOnline ? 'server-network' : 'server-network-off'}
                    size={20}
                    color={isBackendOnline ? '#16A34A' : '#64748B'}
                  />
                  <Text style={styles.cloudCardTitle}>
                    {isBackendOnline ? 'Servidor Docker: EN LÍNEA' : 'Modo Autónomo (Sin Nube)'}
                  </Text>
                </View>
                <View style={[styles.cloudPill, isBackendOnline ? styles.cloudPillOnline : styles.cloudPillOffline]}>
                  <Text style={[styles.cloudPillText, { color: isBackendOnline ? '#15803D' : '#64748B' }]}>
                    {isBackendOnline ? 'ACTIVO' : 'OFFLINE'}
                  </Text>
                </View>
              </View>

              <Text style={styles.cloudCardDesc}>
                {isBackendOnline
                  ? 'Sincronizando telemetría médica en base de datos persistente y diagnóstico con IA médica.'
                  : 'Sin conexión a internet o backend inactivo. Consulta tus signos vitales en tiempo real directamente por Bluetooth.'}
              </Text>

              {/* Selector Rápido de Backend */}
              <View style={styles.backendPresetContainer}>
                <TouchableOpacity
                  style={[
                    styles.presetBtn,
                    backendUrl === DEFAULT_CLOUD_BACKEND && styles.presetBtnActive,
                  ]}
                  onPress={() => updateBackendUrl(DEFAULT_CLOUD_BACKEND)}
                >
                  <MaterialCommunityIcons
                    name="cloud-outline"
                    size={14}
                    color={backendUrl === DEFAULT_CLOUD_BACKEND ? '#FFFFFF' : '#334155'}
                  />
                  <Text style={[styles.presetBtnText, backendUrl === DEFAULT_CLOUD_BACKEND && styles.presetBtnTextActive]}>
                    Túnel Cloudflare
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.presetBtn,
                    (backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1')) && styles.presetBtnActive,
                  ]}
                  onPress={() => updateBackendUrl('http://localhost:8000')}
                >
                  <MaterialCommunityIcons
                    name="laptop"
                    size={14}
                    color={(backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1')) ? '#FFFFFF' : '#334155'}
                  />
                  <Text
                    style={[
                      styles.presetBtnText,
                      (backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1')) && styles.presetBtnTextActive,
                    ]}
                  >
                    Docker Local
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.backendUrlLabel} numberOfLines={1}>
                Endpoint: {backendUrl}
              </Text>
            </View>

            {/* Gestión de Sesiones Múltiples / Pacientes Independientes */}
            <Text style={[styles.sectionHeading, { marginTop: 18 }]}>SESIÓN Y PACIENTES (MULTI-SESIÓN AISLADA)</Text>

            <View style={styles.sessionCard}>
              <View style={styles.sessionCardTopRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 150 }}>
                  <MaterialCommunityIcons name="account-clock" size={20} color={Colors.primary} />
                  <View style={{ marginLeft: 8, flex: 1 }}>
                    <Text style={styles.sessionCardTitle} numberOfLines={1}>Sesión: {currentSessionId}</Text>
                    <Text style={styles.sessionCardSub} numberOfLines={1}>Telemetría y chat aislados</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.newSessionBtn}
                  onPress={() => createNewSession()}
                >
                  <Ionicons name="add" size={14} color="#FFFFFF" />
                  <Text style={styles.newSessionBtnText}>Nueva Sesión</Text>
                </TouchableOpacity>
              </View>

              {availableSessions.length > 1 && (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.sessionListHeading}>Sesiones detectadas en el backend:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                    {availableSessions.map((s) => (
                      <TouchableOpacity
                        key={s.session_id}
                        style={[
                          styles.sessionChip,
                          s.session_id === currentSessionId && styles.sessionChipActive,
                        ]}
                        onPress={() => switchSession(s.session_id)}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          {s.is_live && <View style={styles.livePulseDot} />}
                          <Text
                            style={[
                              styles.sessionChipText,
                              s.session_id === currentSessionId && styles.sessionChipTextActive,
                            ]}
                          >
                            {s.session_id}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Sección Discreta de Demostración y Validación Clínica */}
              {onOpenClinicalDemo && (
                <View style={styles.demoSection}>
                  <Text style={styles.sectionHeading}>BANCO DE PRUEBAS CLÍNICAS (ICBHI 2017)</Text>
                  <View style={styles.demoCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                      <MaterialCommunityIcons name="flask-outline" size={18} color={Colors.aiPurple} style={{ marginRight: 6 }} />
                      <Text style={styles.demoCardTitle}>Demostración con Pacientes Reales</Text>
                    </View>
                    <Text style={styles.demoCardDesc}>
                      Prueba grabaciones torácicas certificadas de validación (Sano, Sibilancias, Crepitantes, Neumonía) para contrastar la inferencia en vivo.
                    </Text>
                    <TouchableOpacity
                      style={styles.openDemoBtn}
                      onPress={() => {
                        onClose();
                        onOpenClinicalDemo();
                      }}
                      activeOpacity={0.8}
                    >
                      <MaterialCommunityIcons name="stethoscope" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.openDemoBtnText}>Abrir Banco de Auscultación</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bluetoothIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconConnected: {
    backgroundColor: '#DCFCE7',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  closeButton: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
  },
  statusBanner: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
  },
  statusBannerOnline: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  statusBannerOffline: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  statusDotLarge: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusBannerTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  statusBannerDesc: {
    fontSize: 11,
    marginTop: 2,
  },
  disconnectBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  disconnectBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  errorText: {
    marginLeft: 8,
    fontSize: 11,
    color: '#991B1B',
    flex: 1,
    fontWeight: '600',
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 4,
  },
  scrollArea: {
    width: '100%',
  },
  deviceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  deviceCardActive: {
    borderColor: '#16A34A',
    backgroundColor: '#F0FDF4',
  },
  deviceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  deviceIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  deviceCardSub: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  deviceCardBadgeText: {
    fontSize: 10,
    color: '#2563EB',
    fontWeight: '700',
    marginTop: 2,
  },
  devicePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  devicePillConnected: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  devicePillDisconnected: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  devicePillText: {
    fontSize: 9,
    fontWeight: '800',
  },
  actionBtnFull: {
    width: '100%',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionBtnConnect: {
    backgroundColor: Colors.primary,
  },
  actionBtnDisconnect: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  actionBtnTextFull: {
    fontSize: 13,
    fontWeight: '800',
  },
  actionTextConnect: {
    color: '#FFFFFF',
  },
  actionTextDisconnect: {
    color: '#DC2626',
  },
  guideCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
  },
  guideTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginLeft: 6,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 6,
  },
  guideStep: {
    fontSize: 11,
    color: '#475569',
    marginLeft: 6,
    flex: 1,
    lineHeight: 16,
  },
  cloudConfigCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
    marginBottom: 8,
  },
  cloudCardTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1E293B',
    marginLeft: 8,
  },
  cloudPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  cloudPillOnline: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  cloudPillOffline: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  cloudPillText: {
    fontSize: 9,
    fontWeight: '800',
  },
  cloudCardDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 6,
    lineHeight: 15,
  },
  backendPresetContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  presetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    flex: 1,
    minWidth: 125,
    justifyContent: 'center',
  },
  presetBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  presetBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  presetBtnTextActive: {
    color: '#FFFFFF',
  },
  backendUrlLabel: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  sessionCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
    marginBottom: 12,
  },
  sessionCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  sessionCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E293B',
  },
  sessionCardSub: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  newSessionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  newSessionBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  sessionListHeading: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sessionChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginRight: 6,
  },
  sessionChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: Colors.primary,
  },
  sessionChipText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  sessionChipTextActive: {
    color: Colors.primary,
    fontWeight: '800',
  },
  livePulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
  },
  demoSection: {
    marginTop: 18,
    marginBottom: 6,
  },
  demoCard: {
    backgroundColor: '#FAF5FF',
    borderColor: '#E9D5FF',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  demoCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B21A8',
  },
  demoCardDesc: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 10,
  },
  openDemoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.aiPurple,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  openDemoBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
