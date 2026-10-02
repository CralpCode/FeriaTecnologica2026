import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { apiService } from '../services/api';
import { useVitals } from './VitalsContext';
import { ClinicalAlert, HeartFocus, RecordingResult } from '../types/vitals';

export type RecordingPhase = 'idle' | 'armed' | 'recording' | 'done';

interface ClinicalContextProps {
  alerts: ClinicalAlert[];
  activeAlertsCount: number;
  hasCriticalAlert: boolean;
  recordings: RecordingResult[];
  lastResult: RecordingResult | null;
  phase: RecordingPhase;
  armedLocation: HeartFocus | null;
  isLiveConnected: boolean;
  armRecording: (location: HeartFocus) => Promise<void>;
  acknowledgeAlert: (id: number) => Promise<void>;
  refresh: () => Promise<void>;
}

const ClinicalContext = createContext<ClinicalContextProps | undefined>(undefined);

const POLL_MS = 5000;

export const ClinicalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { currentSessionId, backendUrl, connectedType, connectViaServer } = useVitals();
  const [alerts, setAlerts] = useState<ClinicalAlert[]>([]);
  const [recordings, setRecordings] = useState<RecordingResult[]>([]);
  const [lastResult, setLastResult] = useState<RecordingResult | null>(null);
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [armedLocation, setArmedLocation] = useState<HeartFocus | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const sessionRef = useRef(currentSessionId);
  sessionRef.current = currentSessionId;

  const refresh = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([apiService.getAlerts(), apiService.getRecordings()]);
      setAlerts(a);
      setRecordings(r);
    } catch {}
  }, []);

  const upsertAlert = useCallback((alert: ClinicalAlert) => {
    setAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)].sort((x, y) => y.id - x.id));
  }, []);

  // Canal en vivo del servidor (alertas y resultados de auscultación)
  useEffect(() => {
    setAlerts([]);
    setRecordings([]);
    setLastResult(null);
    setPhase('idle');
    refresh();

    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      try {
        ws = new WebSocket(apiService.liveSocketUrl);
      } catch {
        retry = setTimeout(connect, 3000);
        return;
      }
      ws.onopen = () => setIsLiveConnected(true);
      ws.onclose = () => {
        setIsLiveConnected(false);
        if (!closed) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (event) => {
        let msg: any;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.session_id && msg.session_id !== sessionRef.current) return;
        switch (msg.type) {
          case 'ALERT':
          case 'ALERT_UPDATED':
            upsertAlert(msg.data);
            break;
          case 'RECORDING_ARMED':
            setPhase('armed');
            setArmedLocation(msg.data.location);
            break;
          case 'RECORDING_STARTED':
            setPhase('recording');
            break;
          case 'RECORDING_RESULT':
            setLastResult(msg.data);
            setPhase('done');
            setRecordings((prev) => [msg.data, ...prev.filter((r) => r.recording_id !== msg.data.recording_id)]);
            break;
        }
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [currentSessionId, backendUrl, refresh, upsertAlert]);

  // Respaldo: si el WebSocket no está disponible (p. ej. algunos túneles), se consulta periódicamente.
  useEffect(() => {
    if (isLiveConnected) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [isLiveConnected, refresh]);

  const armRecording = useCallback(async (location: HeartFocus) => {
    await apiService.armRecording(location);
    // Armar también vincula el ESP32 a esta sesión: empezamos a leer sus vitales del servidor.
    if (connectedType === 'none') await connectViaServer();
    setArmedLocation(location);
    setPhase('armed');
    setLastResult(null);
  }, [connectedType, connectViaServer]);

  const acknowledgeAlert = useCallback(async (id: number) => {
    const updated = await apiService.ackAlert(id);
    upsertAlert(updated);
  }, [upsertAlert]);

  const active = alerts.filter((a) => !a.acknowledged);

  return (
    <ClinicalContext.Provider
      value={{
        alerts,
        activeAlertsCount: active.length,
        hasCriticalAlert: active.some((a) => a.severity === 'critical'),
        recordings,
        lastResult,
        phase,
        armedLocation,
        isLiveConnected,
        armRecording,
        acknowledgeAlert,
        refresh,
      }}
    >
      {children}
    </ClinicalContext.Provider>
  );
};

export const useClinical = () => {
  const ctx = useContext(ClinicalContext);
  if (!ctx) throw new Error('useClinical debe usarse dentro de ClinicalProvider');
  return ctx;
};
