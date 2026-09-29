import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { VitalSigns, VitalsHistoryPoint, AIAnalysisReport, DeviceInfo, TimeRange, ChatMessage } from '../types/vitals';
import { apiService } from '../services/api';
import { API_CONFIG, setCustomBackendUrl, getCustomBackendUrl, getSessionId, setSessionId, generateNewSessionId } from '../config/api';
import { deviceBridge } from '../services/DeviceBridgeService';

export type ConnectedDeviceType = 'none' | 'wokwi_wifi' | 'direct_ble';

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
  connectDirectBluetooth: () => Promise<{ success: boolean; message: string; deviceName?: string }>;
  disconnectAllDevices: () => void;
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
};

const generateLocalMedicalReport = (v: VitalSigns): AIAnalysisReport => {
  const anomalies: string[] = [];
  let status: 'normal' | 'caution' | 'critical' = 'normal';
  let score = 96;

  if (v.bloodOxygen > 0 && v.bloodOxygen < 90) {
    anomalies.push(`Hipoxia Severa (SpO2 ${v.bloodOxygen.toFixed(1)}%)`);
    status = 'critical';
    score -= 40;
  } else if (v.bloodOxygen > 0 && v.bloodOxygen < 95) {
    anomalies.push(`SpO2 Límite (${v.bloodOxygen.toFixed(1)}%)`);
    status = 'caution';
    score -= 15;
  }

  if (v.heartRate > 100) {
    anomalies.push(`Taquicardia (${v.heartRate} LPM)`);
    if (status !== 'critical') status = 'caution';
    score -= 15;
  } else if (v.heartRate > 0 && v.heartRate < 50) {
    anomalies.push(`Bradicardia (${v.heartRate} LPM)`);
    if (status !== 'critical') status = 'caution';
    score -= 15;
  }

  if (v.temperature > 38.0) {
    anomalies.push(`Fiebre (${v.temperature.toFixed(1)}°C)`);
    if (status !== 'critical') status = 'caution';
    score -= 20;
  }

  return {
    id: `local-diag-${Date.now()}`,
    timestamp: new Date().toISOString(),
    healthScore: Math.max(20, Math.min(100, score)),
    status,
    title: anomalies.length > 0 ? 'Alerta Clínica (Modo Local Offline)' : 'Signos Vitales Normales (Modo Local)',
    summary: anomalies.length > 0
      ? `Diagnóstico Local Autónomo: Se han detectado anomalías: ${anomalies.join(', ')}.`
      : 'Diagnóstico Local Autónomo: Parámetros cardiopulmonares y acústicos dentro de rangos normales de seguridad.',
    recommendations: anomalies.length > 0
      ? ['Guarde reposo y respire pausadamente', 'Verifique la colocación del oxímetro', 'Consulte a un especialista si los valores persisten']
      : ['Frecuencia y saturación estables', 'Monitoreo preventivo continuo activo'],
    anomaliesDetected: anomalies,
    confidence: 92,
  };
};

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
    return newId;
  }, [refreshSessionsList]);

  const switchSession = useCallback((sessionId: string) => {
    if (!sessionId) return;
    setSessionId(sessionId);
    setCurrentSessionId(sessionId);
    setVitals(ABSOLUTE_ZERO_VITALS);
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
      text: `¡Hola! Soy tu asistente médico inteligente SpiroScan. Sesión activa: ${currentSessionId}. Monitoreando telemetría biomédica del ESP32.`,
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
      if (connectedTypeRef.current === 'direct_ble') return;
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
            name: 'SpiroScan-Band (ESP32 WiFi/Sim)',
            model: 'ESP32 Bio-Acústico (MAX30102 PPG)',
            connected: true,
            battery: 100,
            lastSync: new Date().toISOString(),
            firmwareVersion: 'v1.5.0 (Hardware Real)',
            signalStrength: 'excellent',
          });

          const now = Date.now();
          if (now - lastAiUpdateRef.current >= 8000 || (current.heartRate > 120 && now - lastAiUpdateRef.current >= 3000)) {
            lastAiUpdateRef.current = now;
            apiService.getAIAnalysis(current)
              .then(setAiReport)
              .catch(() => setAiReport(generateLocalMedicalReport(current)));
          }
        } else if (connectedTypeRef.current === 'wokwi_wifi' && !isDeviceActive) {
          setConnectedType('none');
          setDevice(null);
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

  const disconnectAllDevices = useCallback(() => {
    userManualDisconnectRef.current = true;
    deviceBridge.disconnect();
    setConnectedType('none');
    setDevice(null);
    setVitals(ABSOLUTE_ZERO_VITALS);
    apiService.disconnectSession(currentSessionId).catch(() => {});
  }, [currentSessionId]);

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
        let localReply = `(Modo Local Autónomo - Sin Conexión al Backend)\n\n` +
          `Operando directamente con el hardware ESP32 vía Bluetooth BLE:\n` +
          `• Frecuencia Cardíaca: ${vitals.heartRate > 0 ? `${vitals.heartRate} LPM` : 'En espera de contacto'}\n` +
          `• Saturación SpO2: ${vitals.bloodOxygen > 0 ? `${vitals.bloodOxygen.toFixed(1)}%` : 'En espera'}\n` +
          `• Temperatura: ${vitals.temperature > 0 ? `${vitals.temperature.toFixed(1)}°C` : 'En espera'}\n` +
          `• Nivel Sonoro Acústico: ${vitals.audio_rms.toFixed(1)} dB\n\n`;

        if (vitals.heartRate === 0) {
          localReply += 'Coloca tu dedo firmemente en el sensor MAX30102 para iniciar la adquisición.';
        } else if (vitals.bloodOxygen < 90) {
          localReply += '¡Atención!: Se detecta saturación baja (<90%). Respira pausadamente y solicita asistencia médica preventiva.';
        } else {
          localReply += 'Tus constantes biomédicas se encuentran estables.';
        }

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
        connectDirectBluetooth,
        disconnectAllDevices,
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
