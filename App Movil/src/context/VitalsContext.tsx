import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { VitalSigns, VitalsHistoryPoint, AIAnalysisReport, DeviceInfo, TimeRange, ChatMessage, VitalStatus } from '../types/vitals';
import { apiService } from '../services/api';
import { API_CONFIG, setCustomBackendUrl, getCustomBackendUrl, getSessionId, setSessionId, generateNewSessionId } from '../config/api';
import { deviceBridge } from '../services/DeviceBridgeService';
import localDemoSamples from '../config/demoSamples.json';

export type ConnectedDeviceType = 'none' | 'wokwi_wifi' | 'direct_ble' | 'demo_icbhi';

export interface SessionInfo {
  session_id: string;
  name?: string;
  records_count?: number;
  last_seen?: string;
  is_live?: boolean;
}

interface VitalsContextProps {
  vitals: VitalSigns;
  aiReport: AIAnalysisReport | null;
  history: VitalsHistoryPoint[];
  selectedRange: TimeRange;
  isStreaming: boolean;
  activeScenario: string;
  device: DeviceInfo | null;
  connectedType: ConnectedDeviceType;
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  isDeviceDirectConnected: boolean;
  isBackendOnline: boolean;
  backendUrl: string;
  currentSessionId: string;
  availableSessions: SessionInfo[];
  updateBackendUrl: (url: string) => void;
  createNewSession: (label?: string) => string;
  switchSession: (sessionId: string) => void;
  refreshSessionsList: () => Promise<void>;
  setSelectedRange: (range: TimeRange) => void;
  toggleStreaming: () => void;
  triggerScenario: (scenario: 'normal' | 'tachycardia' | 'hypertension' | 'hypoxia' | 'stress') => void;
  sendChatMessage: (text: string) => Promise<void>;
  refreshAllData: () => Promise<void>;
  connectToWokwiEmulator: () => void;
  connectViaServer: () => Promise<{ success: boolean; message: string }>;
  connectDirectBluetooth: () => Promise<{ success: boolean; message: string; deviceName?: string }>;
  disconnectAllDevices: () => void;
  injectClinicalDemo: (sampleId: string) => Promise<boolean>;
}

const ABSOLUTE_ZERO_VITALS: VitalSigns = {
  heartRate: 0,
  bloodOxygen: 0.0,
  systolicPressure: 0,
  diastolicPressure: 0,
  temperature: 0.0,
  hrv: 0,
  stressLevel: 0,
  audio_rms: 0.0,
  audio_peak: 0.0,
  steps: 0,
  calories: 0,
  timestamp: new Date().toISOString(),
  device_connected: false,
  finger: false,
  source: 'unknown',
  heartRateValid: false,
  bloodOxygenValid: false,
  spo2Calibrated: false,
};

const generateLocalMedicalReport = (_v: VitalSigns): AIAnalysisReport => ({
  id: `unavailable-${Date.now()}`,
  timestamp: new Date().toISOString(),
  healthScore: null,
  confidence: null,
  status: 'insufficient_data',
  title: 'Valoración no disponible',
  summary: 'No hay conexión con el servicio de valoración. No se pueden inferir enfermedades ni descartar problemas con estos datos.',
  recommendations: ['Revisa la conexión y completa los síntomas en Auscultación.', 'Si hay síntomas de alarma, busca atención médica sin esperar al sistema.'],
  anomaliesDetected: [],
  method: 'unavailable',
});

const VitalsContext = createContext<VitalsContextProps | undefined>(undefined);

export const VitalsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [vitals, setVitals] = useState<VitalSigns>(ABSOLUTE_ZERO_VITALS);
  const [aiReport, setAiReport] = useState<AIAnalysisReport | null>(null);
  const [history, setHistory] = useState<VitalsHistoryPoint[]>([]);
  const [selectedRange, setSelectedRange] = useState<TimeRange>('24h');
  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [activeScenario, setActiveScenario] = useState<string>('normal');
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [connectedType, setConnectedType] = useState<ConnectedDeviceType>('none');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(true);
  const [backendUrl, setBackendUrl] = useState<string>(API_CONFIG.BASE_URL);
  const [currentSessionId, setCurrentSessionId] = useState<string>(getSessionId());
  const [availableSessions, setAvailableSessions] = useState<SessionInfo[]>([]);

  const refreshSessionsList = useCallback(async () => {
    try {
      const list = await apiService.getSessionsList();
      if (Array.isArray(list)) {
        setAvailableSessions(list);
      }
    } catch {}
  }, []);

  const createNewSession = useCallback((label?: string): string => {
    const newId = generateNewSessionId(label);
    setCurrentSessionId(newId);
    setVitals(ABSOLUTE_ZERO_VITALS);
    setAiReport(null);
    setHistory([]);
    setChatMessages([
      {
        id: `init-${newId}`,
        sender: 'ai',
        text: `¡Hola! Sesión independiente iniciada [${newId}]. Monitoreando telemetría del ESP32.`,
        timestamp: 'Ahora',
      },
    ]);
    refreshSessionsList();
    // El ESP32 (por WiFi) pasa a registrar en el paciente nuevo; si no, seguiría en el anterior.
    apiService.linkDevice().catch(() => {});
    return newId;
  }, [refreshSessionsList]);

  const switchSession = useCallback((sessionId: string) => {
    if (!sessionId) return;
    setSessionId(sessionId);
    setCurrentSessionId(sessionId);
    setVitals(ABSOLUTE_ZERO_VITALS);
    setAiReport(null);
    setHistory([]);
    setChatMessages([
      {
        id: `init-${sessionId}`,
        sender: 'ai',
        text: `Cambiado a sesión [${sessionId}]. Cargando telemetría...`,
        timestamp: 'Ahora',
      },
    ]);
    apiService.getCurrentVitals().then(setVitals).catch(() => {});
    apiService.getVitalsHistory(selectedRange).then(setHistory).catch(() => {});
    apiService.linkDevice().catch(() => {});  // el ESP32 registra en el paciente abierto
    refreshSessionsList();
  }, [selectedRange, refreshSessionsList]);

  useEffect(() => {
    refreshSessionsList();
  }, [refreshSessionsList]);

  const lastAiUpdateRef = useRef<number>(0);
  const lastHistoryAppendRef = useRef<number>(0);
  const isFetchingRef = useRef<boolean>(false);
  const connectedTypeRef = useRef<ConnectedDeviceType>(connectedType);
  const userManualDisconnectRef = useRef<boolean>(false);

  useEffect(() => {
    connectedTypeRef.current = connectedType;
  }, [connectedType]);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'init-msg',
      sender: 'ai',
      text: `¡Hola! Soy el asistente de SpiroScan. Puedo explicarte los datos de esta sesión (${currentSessionId}); no doy diagnósticos.`,
      timestamp: 'Ahora',
    },
  ]);

  // Chequeo periódico de salud del Backend / Nube
  useEffect(() => {
    const checkCloud = async () => {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.DEVICE_STATUS}`, {
          method: 'GET',
        });
        setIsBackendOnline(res.ok);
      } catch {
        setIsBackendOnline(false);
      }
    };
    checkCloud();
    const timer = setInterval(checkCloud, 12000);
    return () => clearInterval(timer);
  }, [backendUrl]);

  // 1. Suscripción al Canal Directo Bluetooth BLE (Funciona con o sin internet)
  useEffect(() => {
    const unsubVitals = deviceBridge.onVitals((incomingVitals) => {
      if (userManualDisconnectRef.current) return;
      setVitals(incomingVitals);
      setConnectedType('direct_ble');
      setDevice({
        name: deviceBridge.getDeviceName() || 'SpiroScan-Band (Bluetooth BLE)',
        model: 'ESP32 Bio-Acústico (MAX30102 PPG)',
        connected: true,
        battery: 100,
        lastSync: new Date().toISOString(),
        firmwareVersion: 'v2.0 (GATT BLE Directo)',
        signalStrength: 'excellent',
      });

      const now = Date.now();

      // Acumular historia localmente (permite consultar gráficos offline sin internet)
      if (incomingVitals.heartRate > 0 && now - lastHistoryAppendRef.current >= 3000) {
        lastHistoryAppendRef.current = now;
        const newPoint: VitalsHistoryPoint = {
          timeLabel: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          heartRate: incomingVitals.heartRate,
          bloodOxygen: incomingVitals.bloodOxygen,
          systolicPressure: incomingVitals.systolicPressure,
          diastolicPressure: incomingVitals.diastolicPressure,
          temperature: incomingVitals.temperature,
          stressLevel: incomingVitals.stressLevel,
          hrv: incomingVitals.hrv,
          signalQuality: incomingVitals.signalQuality,
          sampleAgeMs: incomingVitals.sampleAgeMs,
          source: incomingVitals.source,
          heartRateValid: incomingVitals.heartRateValid,
          bloodOxygenValid: incomingVitals.bloodOxygenValid,
          spo2Calibrated: incomingVitals.spo2Calibrated,
        };
        setHistory((prev) => {
          const updated = [...prev, newPoint];
          return updated.length > 50 ? updated.slice(updated.length - 50) : updated;
        });
      }

      // Actualizar reporte médico (Nube si hay internet, o Motor Clínico Local si está offline)
      if (incomingVitals.heartRate > 0 && now - lastAiUpdateRef.current >= 8000) {
        lastAiUpdateRef.current = now;
        apiService.getAIAnalysis(incomingVitals)
          .then((report) => {
            setAiReport(report);
            setIsBackendOnline(true);
          })
          .catch(() => {
            setIsBackendOnline(false);
            setAiReport(generateLocalMedicalReport(incomingVitals));
          });
      }
    });

    const unsubStatus = deviceBridge.onStatus((connected, name) => {
      if (connected && !userManualDisconnectRef.current) {
        setConnectedType('direct_ble');
        setDevice({
          name: name || 'SpiroScan-Band (Bluetooth BLE)',
          model: 'ESP32 Bio-Acústico (MAX30102 PPG)',
          connected: true,
          battery: 100,
          lastSync: new Date().toISOString(),
          firmwareVersion: 'v2.0 (GATT BLE Directo)',
          signalStrength: 'excellent',
        });
      } else {
        setConnectedType('none');
        setDevice(null);
        setVitals(ABSOLUTE_ZERO_VITALS);
      }
    });

    return () => {
      unsubVitals();
      unsubStatus();
    };
  }, []);

  // 2. Sondeo Alternativo del Backend (Solo cuando se elige explícitamente modo WiFi/Simulador)
  useEffect(() => {
    if (!isStreaming) return;

    const interval = setInterval(async () => {
      if (connectedTypeRef.current === 'direct_ble' || connectedTypeRef.current === 'demo_icbhi') return;
      if (userManualDisconnectRef.current || connectedTypeRef.current === 'none') return;
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      try {
        const current = await apiService.getCurrentVitals();
        setIsBackendOnline(true);
        
        const isFresh = current.timestamp ? (Date.now() - new Date(current.timestamp).getTime()) < 6000 : false;
        const isDeviceActive = Boolean(
          isFresh &&
          current && (
            current.device_connected === true ||
            (current.heartRate > 0 && current.bloodOxygen > 0)
          )
        );

        if (isDeviceActive && connectedTypeRef.current === 'wokwi_wifi') {
          setVitals(current);
          setDevice({
            name: 'SpiroScan-Band (ESP32 por WiFi)',
            model: 'ESP32 (MAX30102 + INMP441)',
            connected: true,
            battery: 0,
            lastSync: new Date().toISOString(),
            firmwareVersion: 'WiFi vía servidor',
            signalStrength: 'good',
          });

          const now = Date.now();
          if (now - lastAiUpdateRef.current >= 8000 || (current.heartRate > 120 && now - lastAiUpdateRef.current >= 3000)) {
            lastAiUpdateRef.current = now;
            apiService.getAIAnalysis(current)
              .then(setAiReport)
              .catch(() => setAiReport(generateLocalMedicalReport(current)));
          }
        } else if (connectedTypeRef.current === 'wokwi_wifi' && !isDeviceActive) {
          // Seguimos escuchando al servidor: el ESP32 puede estar sin dedo o encendiéndose.
          setVitals(ABSOLUTE_ZERO_VITALS);
        }
      } catch (err) {
        setIsBackendOnline(false);
      } finally {
        isFetchingRef.current = false;
      }
    }, API_CONFIG.POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isStreaming]);

  const connectDirectBluetooth = useCallback(async () => {
    userManualDisconnectRef.current = false;
    const res = await deviceBridge.scanAndConnectRealBluetooth();
    if (res.success) {
      setConnectedType('direct_ble');
      setDevice({
        name: res.deviceName || 'SpiroScan-Band (Bluetooth BLE)',
        model: 'ESP32 Bio-Acústico (MAX30102 PPG)',
        connected: true,
        battery: 100,
        lastSync: new Date().toISOString(),
        firmwareVersion: 'v2.0 (GATT BLE Directo)',
        signalStrength: 'excellent',
      });
    }
    return res;
  }, []);

  const connectToWokwiEmulator = () => {
    userManualDisconnectRef.current = false;
    setConnectedType('wokwi_wifi');
  };

  // ESP32 por WiFi: los datos llegan al servidor (la Mac) y la app los lee de ahí.
  const connectViaServer = useCallback(async () => {
    try {
      await apiService.linkDevice();
      userManualDisconnectRef.current = false;
      setConnectedType('wokwi_wifi');
      return { success: true, message: 'Recibiendo datos del ESP32 a través del servidor.' };
    } catch (e: any) {
      return { success: false, message: `No se pudo contactar al servidor: ${e?.message || e}` };
    }
  }, []);

  const disconnectAllDevices = useCallback(() => {
    userManualDisconnectRef.current = true;
    deviceBridge.disconnect();
    setConnectedType('none');
    setDevice(null);
    setVitals(ABSOLUTE_ZERO_VITALS);
    apiService.disconnectSession(currentSessionId).catch(() => {});
  }, [currentSessionId]);

  // 3. Inyección y Simulación Activa del Banco de Pruebas Clínicas ICBHI
  // Banco de pruebas clínico (casos de ICBHI 2017). Los signos vitales son DATOS DE EJEMPLO
  // y el resultado acústico SIEMPRE viene del modelo real en el servidor.
  const injectClinicalDemo = useCallback(async (sampleId: string): Promise<boolean> => {
    userManualDisconnectRef.current = false;
    const sampleData = (localDemoSamples as any)[sampleId];
    if (!sampleData) return false;

    const nowIso = new Date().toISOString();
    const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    setConnectedType('demo_icbhi');
    setAiReport(null);
    setVitals({ ...ABSOLUTE_ZERO_VITALS, timestamp: nowIso, source: 'simulated' });
    setDevice({
      name: `Demo ICBHI (paciente #${sampleData.patient_id})`,
      model: 'Datos de ejemplo',
      connected: true,
      battery: 0,
      lastSync: nowIso,
      firmwareVersion: 'Modo demostración',
      signalStrength: 'good',
    });

    let modelText = 'No se pudo analizar: el servidor no está disponible.';
    try {
      const res = await apiService.injectDemoSample(sampleId);
      if (res && res.report) {
        setAiReport(res.report);
        setIsBackendOnline(true);
        const ac = res.report.acoustic_analysis;
        if (ac) {
          modelText = `Modelo base: ${ac.prediction} (salida acústica del modelo ${Math.round(ac.probability_abnormal * 100)} %).`;
        }
      }
    } catch {
      setIsBackendOnline(false);
    }

    const truth = sampleData.is_abnormal ? 'patológico' : 'normal';
    setChatMessages((prev) => [
      ...prev,
      {
        id: `demo-msg-${Date.now()}`,
        sender: 'ai',
        text:
          `[DEMO ICBHI] Caso del paciente #${sampleData.patient_id} (${sampleData.diagnosis}).\n` +
          `• Etiqueta real del ciclo en ICBHI: ${sampleData.cycle_class_name} (${truth}).\n` +
          `• ${modelText}\n` +
          `• El audio pertenece a un conjunto de investigación; no es una medición del usuario. No se inventan pulso ni SpO2.`,
        timestamp: timeLabel,
      },
    ]);
    return true;
  }, []);

  const loadInitialData = useCallback(async () => {
    try {
      const hist = await apiService.getVitalsHistory(selectedRange);
      if (hist && hist.length > 0) {
        setHistory(hist);
        setIsBackendOnline(true);
      }
    } catch (e) {
      setIsBackendOnline(false);
    }
  }, [selectedRange]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const triggerScenario = useCallback(async (scenario: 'normal' | 'tachycardia' | 'hypertension' | 'hypoxia' | 'stress') => {
    setActiveScenario(scenario);
  }, []);

  const toggleStreaming = useCallback(() => {
    setIsStreaming((prev) => !prev);
  }, []);

  const updateBackendUrl = useCallback((newUrl: string) => {
    setCustomBackendUrl(newUrl);
    setBackendUrl(newUrl || API_CONFIG.BASE_URL);
  }, []);

  const sendChatMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: text.trim(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setChatMessages((prev) => [...prev, userMsg]);
      setIsChatLoading(true);

      try {
        const replyText = await apiService.sendAIChatMessage(text, vitals);
        setIsBackendOnline(true);
        const aiMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: replyText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setChatMessages((prev) => [...prev, aiMsg]);
      } catch (error) {
        setIsBackendOnline(false);
        const localReply = 'El servidor no está disponible. No puedo valorar enfermedades ni afirmar que los datos sean normales. Reconecta y utiliza el formulario de valoración de esta sesión. Si hay síntomas de alarma, busca atención médica de inmediato.';

        const aiMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: localReply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setChatMessages((prev) => [...prev, aiMsg]);
      } finally {
        setIsChatLoading(false);
      }
    },
    [vitals]
  );

  return (
    <VitalsContext.Provider
      value={{
        vitals,
        aiReport,
        history,
        selectedRange,
        isStreaming,
        activeScenario,
        device,
        connectedType,
        chatMessages,
        isChatLoading,
        isDeviceDirectConnected: connectedType !== 'none',
        isBackendOnline,
        backendUrl,
        currentSessionId,
        availableSessions,
        updateBackendUrl,
        createNewSession,
        switchSession,
        refreshSessionsList,
        setSelectedRange,
        toggleStreaming,
        triggerScenario,
        sendChatMessage,
        refreshAllData: loadInitialData,
        connectToWokwiEmulator,
        connectViaServer,
        connectDirectBluetooth,
        disconnectAllDevices,
        injectClinicalDemo,
      }}
    >
      {children}
    </VitalsContext.Provider>
  );
};

export const useVitals = () => {
  const context = useContext(VitalsContext);
  if (!context) {
    throw new Error('useVitals debe ser usado dentro de un VitalsProvider');
  }
  return context;
};
