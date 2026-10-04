import React, { useState, useRef, useEffect } from 'react';
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
  TextInput,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useDeviceConnection } from '../context/VitalsContext';
import { DEFAULT_CLOUD_BACKEND, DEFAULT_LOCAL_LAN, PRIMARY_BACKEND_URL, BACKEND_FALLBACK_URLS } from '../config/api';

interface DeviceConnectionModalProps {
  visible: boolean;
  onClose: () => void;
}

export const DeviceConnectionModalComponent: React.FC<DeviceConnectionModalProps> = ({ visible, onClose }) => {
  const {
    connectedType,
    device,
    connectDirectBluetooth,
    disconnectAllDevices,
    isBackendOnline,
    backendUrl,
    updateBackendUrl,
  } = useDeviceConnection();

  const [isConnecting, setIsConnecting] = useState(false);
  const [connectSuccess, setConnectSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState(backendUrl || '');
  const [isTestingUrl, setIsTestingUrl] = useState(false);
  const [urlTestStatus, setUrlTestStatus] = useState<'online' | 'offline' | null>(null);
  const scrollRef = useRef<any>(null);

  useEffect(() => {
    setCustomUrlInput(backendUrl || '');
  }, [backendUrl]);

  const handleBluetoothConnect = async () => {
    setErrorMessage(null);
    setConnectSuccess(false);
    setIsConnecting(true);

    try {
      const res = await connectDirectBluetooth();
      if (!res.success) {
        setErrorMessage(res.message);
        setIsConnecting(false);
      } else {
        setConnectSuccess(true);
        setIsConnecting(false);
        // Breve retardo para dar feedback visual y permitir al bus BLE estabilizarse sin colisión gráfica
        setTimeout(() => {
          setConnectSuccess(false);
          onClose();
        }, 600);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al conectar por Bluetooth.');
      setIsConnecting(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
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
                  {connectedType !== 'none'
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

          <ScrollView
            ref={scrollRef}
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
            keyboardShouldPersistTaps="handled"
          >
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
                  connectSuccess
                    ? { backgroundColor: '#16A34A' }
                    : connectedType !== 'none'
                    ? styles.actionBtnDisconnect
                    : styles.actionBtnConnect,
                  isConnecting && { opacity: 0.75 },
                ]}
                disabled={isConnecting || connectSuccess}
                onPress={() => {
                  if (connectedType !== 'none') {
                    disconnectAllDevices();
                  } else {
                    handleBluetoothConnect();
                  }
                }}
              >
                {isConnecting ? (
                  <View style={styles.actionBtnContent}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.actionBtnTextFull}>Enlazando con SpiroScan...</Text>
                  </View>
                ) : connectSuccess ? (
                  <View style={styles.actionBtnContent}>
                    <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                    <Text style={[styles.actionBtnTextFull, { color: '#FFFFFF', fontWeight: '800' }]}>
                      ¡Dispositivo Enlazado!
                    </Text>
                  </View>
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

            {/* Botón Acordeón para Opciones Avanzadas de Servidor */}
            <TouchableOpacity
              style={styles.advancedToggleBtn}
              activeOpacity={0.7}
              onPress={() => {
                setShowAdvanced((prev) => !prev);
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name="cog-outline" size={18} color="#64748B" />
                <Text style={styles.advancedToggleBtnText}>Opciones Avanzadas (Servidores Backend)</Text>
              </View>
              <Ionicons
                name={showAdvanced ? "chevron-up" : "chevron-down"}
                size={18}
                color="#64748B"
              />
            </TouchableOpacity>

            {showAdvanced && (
              <View style={{ marginTop: 8 }}>
                {/* Sección de Servidor Backend y Nube */}
                <Text style={styles.sectionHeading}>NUBE & SERVIDOR BACKEND</Text>

                <View style={styles.cloudConfigCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <MaterialCommunityIcons
                        name={isBackendOnline ? 'server-network' : 'server-network-off'}
                        size={20}
                        color={isBackendOnline ? '#16A34A' : '#64748B'}
                      />
                      <Text style={styles.cloudCardTitle}>
                        {isBackendOnline ? 'Servidor Conectado: EN LÍNEA' : 'Modo Autónomo / Sin Conexión'}
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
                      ? 'Telemetría persistida en base de datos e inteligencia artificial médica disponible en la nube.'
                      : 'Operando 100% autónomo por Bluetooth directo. La app visualiza y procesa los datos en vivo en el teléfono.'}
                  </Text>

                  {/* Input Manual de URL con Botón de Prueba Rápido */}
                  <Text style={styles.inputSectionLabel}>CONFIGURAR ENDPOINT DE BACKEND:</Text>
                  <View style={styles.urlInputRow}>
                    <TextInput
                      style={styles.urlInput}
                      value={customUrlInput}
                      onChangeText={setCustomUrlInput}
                      placeholder="http://192.168.1.X:8000 o https://tunel..."
                      placeholderTextColor="#94A3B8"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      style={[styles.applyUrlBtn, isTestingUrl && { opacity: 0.7 }]}
                      disabled={isTestingUrl}
                      onPress={async () => {
                        setIsTestingUrl(true);
                        setUrlTestStatus(null);
                        const clean = customUrlInput.trim().replace(/\/+$/, '');
                        updateBackendUrl(clean);
                        if (!clean || clean === 'offline') {
                          setIsTestingUrl(false);
                          setUrlTestStatus('offline');
                          return;
                        }
                        try {
                          const controller = new AbortController();
                          const timeout = setTimeout(() => controller.abort(), 2500);
                          const res = await fetch(`${clean}/api/device/status`, { signal: controller.signal });
                          clearTimeout(timeout);
                          setUrlTestStatus(res.ok ? 'online' : 'offline');
                        } catch {
                          setUrlTestStatus('offline');
                        } finally {
                          setIsTestingUrl(false);
                        }
                      }}
                    >
                      {isTestingUrl ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.applyUrlBtnText}>Aplicar</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {urlTestStatus && (
                    <Text
                      style={[
                        styles.urlStatusFeedback,
                        { color: urlTestStatus === 'online' ? '#16A34A' : '#DC2626' },
                      ]}
                    >
                      {urlTestStatus === 'online'
                        ? '✓ Conexión establecida con el servidor con éxito.'
                        : '✕ Servidor no responde en esta dirección. (Verifica IP/red).'}
                    </Text>
                  )}

                  {/* Atajos Rápidos */}
                  <Text style={[styles.inputSectionLabel, { marginTop: 12 }]}>PRESETS RÁPIDOS DE SERVIDOR:</Text>
                  <View style={styles.backendPresetContainer}>
                    <TouchableOpacity
                      style={[
                        styles.presetBtn,
                        backendUrl === PRIMARY_BACKEND_URL && styles.presetBtnActive,
                      ]}
                      onPress={() => {
                        setCustomUrlInput(PRIMARY_BACKEND_URL);
                        updateBackendUrl(PRIMARY_BACKEND_URL);
                      }}
                    >
                      <MaterialCommunityIcons
                        name="cloud-check"
                        size={14}
                        color={backendUrl === PRIMARY_BACKEND_URL ? '#FFFFFF' : '#0D9488'}
                      />
                      <Text style={[styles.presetBtnText, backendUrl === PRIMARY_BACKEND_URL && styles.presetBtnTextActive]}>
                        Cloudflare (Principal)
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.presetBtn,
                        backendUrl === BACKEND_FALLBACK_URLS[1] && styles.presetBtnActive,
                      ]}
                      onPress={() => {
                        setCustomUrlInput(BACKEND_FALLBACK_URLS[1]);
                        updateBackendUrl(BACKEND_FALLBACK_URLS[1]);
                      }}
                    >
                      <MaterialCommunityIcons
                        name="shield-outline"
                        size={14}
                        color={backendUrl === BACKEND_FALLBACK_URLS[1] ? '#FFFFFF' : '#334155'}
                      />
                      <Text style={[styles.presetBtnText, backendUrl === BACKEND_FALLBACK_URLS[1] && styles.presetBtnTextActive]}>
                        Túnel Ngrok (Respaldo)
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.presetBtn,
                        backendUrl === DEFAULT_LOCAL_LAN && styles.presetBtnActive,
                      ]}
                      onPress={() => {
                        setCustomUrlInput(DEFAULT_LOCAL_LAN);
                        updateBackendUrl(DEFAULT_LOCAL_LAN);
                      }}
                    >
                      <MaterialCommunityIcons
                        name="wifi"
                        size={14}
                        color={backendUrl === DEFAULT_LOCAL_LAN ? '#FFFFFF' : '#334155'}
                      />
                      <Text style={[styles.presetBtnText, backendUrl === DEFAULT_LOCAL_LAN && styles.presetBtnTextActive]}>
                        WiFi LAN (192.168.1.163)
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.presetBtn,
                        (backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1')) && styles.presetBtnActive,
                      ]}
                      onPress={() => {
                        setCustomUrlInput('http://localhost:8000');
                        updateBackendUrl('http://localhost:8000');
                      }}
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

                    <TouchableOpacity
                      style={[
                        styles.presetBtn,
                        (backendUrl === 'offline' || !backendUrl) && styles.presetBtnActive,
                      ]}
                      onPress={() => {
                        setCustomUrlInput('offline');
                        updateBackendUrl('offline');
                        setUrlTestStatus('offline');
                      }}
                    >
                      <MaterialCommunityIcons
                        name="bluetooth"
                        size={14}
                        color={(backendUrl === 'offline' || !backendUrl) ? '#FFFFFF' : '#334155'}
                      />
                      <Text style={[styles.presetBtnText, (backendUrl === 'offline' || !backendUrl) && styles.presetBtnTextActive]}>
                        Modo Autónomo (100% BLE)
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
      </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export const DeviceConnectionModal = React.memo(DeviceConnectionModalComponent);

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  advancedToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 14,
    marginBottom: 6,
  },
  advancedToggleBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    height: '88%',
    maxHeight: 740,
    display: 'flex',
    flexDirection: 'column',
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
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    paddingBottom: 36,
  },
  inputSectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    marginTop: 10,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  urlInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  urlInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    color: '#1E293B',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  applyUrlBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  applyUrlBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  urlStatusFeedback: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
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
});
