import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { apiService } from '../services/api';
import { useVitals } from './VitalsContext';
import { AuscultationFocus, AuscultationMode, ClinicalAlert, RecordingResult, TriageResult } from '../types/vitals';

export type RecordingPhase = 'idle' | 'armed' | 'recording' | 'processing' | 'done';

interface ClinicalContextProps {
  alerts: ClinicalAlert[];
  activeAlertsCount: number;
  hasCriticalAlert: boolean;
  recordings: RecordingResult[];
  lastResult: RecordingResult | null;
  phase: RecordingPhase;
  recordingStage: 'capturing' | 'uploading' | 'processing';
  armedLocation: AuscultationFocus | null;
  triage: TriageResult | null;
  recordingStartedAt: number | null;
  /** El estetoscopio ya recibió la orden de grabar (preguntó al servidor). */
  commandDelivered: boolean;
  /** Hora en que se dio la orden (para avisar si el estetoscopio no responde). */
  armedAt: number | null;
  isLiveConnected: boolean;
  armRecording: (location: AuscultationFocus, mode: AuscultationMode) => Promise<void>;
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
  const [recordingStage, setRecordingStage] = useState<'capturing' | 'uploading' | 'processing'>('capturing');
  const [armedLocation, setArmedLocation] = useState<AuscultationFocus | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [commandDelivered, setCommandDelivered] = useState(false);
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const activeRecording = useRef<string | null>(null);
  const sessionRef = useRef(currentSessionId);
  sessionRef.current = currentSessionId;

  const refresh = useCallback(async () => {
    try {
      const [a, r, t] = await Promise.all([apiService.getAlerts(), apiService.getRecordings(), apiService.getTriage()]);
      setAlerts(a);
      setRecordings(r);
      setTriage(t);
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
    setTriage(null);
    setPhase('idle');
    activeRecording.current = null;
    setArmedAt(null);
    setArmedLocation(null);
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
            activeRecording.current = null;
            setPhase('armed');
            setRecordingStartedAt(null);
            setLastResult(null);
            setArmedLocation(msg.data.location);
            setCommandDelivered(false);
            setArmedAt(Date.now());
            break;
          case 'RECORDING_COMMAND_DELIVERED':
            setCommandDelivered(true);
            break;
          case 'RECORDING_STARTED':
            activeRecording.current = msg.data.recording_id;
            setPhase('recording');
            setRecordingStage('capturing');
            setCommandDelivered(true);
            setRecordingStartedAt(Date.now());
            break;
          case 'TRIAGE_UPDATE':
            setTriage(msg.data);
            break;
          case 'RECORDING_QUEUED':
            if (activeRecording.current === msg.data.recording_id) {
              setPhase('processing');
              setRecordingStage('processing');
            }
            refresh();
            break;
          case 'RECORDING_RESULT':
            if (activeRecording.current === msg.data.recording_id) {
              setLastResult(msg.data);
              setPhase('done');
            }
            setRecordings((prev) => [msg.data, ...prev.filter((r) => r.recording_id !== msg.data.recording_id)]);
            refresh();  // trae también has_audio y el estado guardado
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

  // Una preparación vence a los 120 s en el servidor (ARM_TTL_S); la app vuelve a "lista" igual.
  useEffect(() => {
    if (phase !== 'armed') return;
    const timer = setTimeout(() => setPhase((p) => (p === 'armed' ? 'idle' : p)), 120_000);
    return () => clearTimeout(timer);
  }, [phase]);

  // Consultar el estado guardado incluso con WebSocket: recupera eventos perdidos
  // y distingue el envío de audio de la inferencia.
  useEffect(() => {
    if (phase !== 'armed' && phase !== 'recording' && phase !== 'processing') return;
    let closed = false;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const state = await apiService.getRecordingStatus();
        if (closed || !armedAt || state.age_s > (Date.now() - armedAt) / 1000 + 10
            || state.location !== armedLocation) return;
        if (activeRecording.current && state.recording_id !== activeRecording.current) return;
        if (state.recording_id) activeRecording.current = state.recording_id;
        if (state.result) {
          setLastResult(state.result);
          setPhase('done');
          refresh();
        } else if (['queued', 'processing'].includes(state.stage)) {
          setPhase('processing');
          setRecordingStage('processing');
          refresh();
        } else if (['capturing', 'uploading'].includes(state.stage)) {
          setPhase('recording');
          setRecordingStage(state.stage as 'capturing' | 'uploading' | 'processing');
          setRecordingStartedAt((prev) => prev ?? Date.now() - state.age_s * 1000);
        }
      } catch {} finally { pending = false; }
    };
    poll();
    const timer = setInterval(poll, 2500);
    return () => { closed = true; clearInterval(timer); };
  }, [phase, armedAt, armedLocation, refresh]);

  // Respaldo: si el WebSocket no está disponible (p. ej. algunos túneles), se consulta periódicamente.
  useEffect(() => {
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [isLiveConnected, refresh]);

  const armRecording = useCallback(async (location: AuscultationFocus, mode: AuscultationMode) => {
    activeRecording.current = null;
    setArmedLocation(location);
    setPhase('armed');
    setRecordingStartedAt(null);
    setCommandDelivered(false);
    setArmedAt(Date.now());
    setLastResult(null);
    try {
      await apiService.armRecording(location, mode);
      if (connectedType === 'none') await connectViaServer();
    } catch (error) {
      setPhase('idle');
      throw error;
    }
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
        recordingStage,
        armedLocation,
        triage,
        recordingStartedAt,
        commandDelivered,
        armedAt,
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
