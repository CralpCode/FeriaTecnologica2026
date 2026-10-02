export type VitalStatus = 'normal' | 'caution' | 'critical';

export interface VitalSigns {
  heartRate: number;            // Latidos por minuto (BPM)
  bloodOxygen: number;          // Saturación SpO2 (%)
  systolicPressure: number;     // Siempre 0: el MAX30102 no mide presión (se mantiene por compatibilidad)
  diastolicPressure: number;    // Siempre 0 (ídem)
  temperature: number;          // Siempre 0: no hay sensor de temperatura corporal
  hrv: number;                  // Variabilidad ritmo cardíaco (ms)
  stressLevel: number;          // Índice EXPERIMENTAL del firmware (0-100), no validado
  audio_rms: number;            // Nivel sonoro RMS (dB) del micrófono INMP441
  audio_peak: number;           // Pico sonoro (dB)
  steps: number;                // Pasos acumulados
  calories: number;             // Calorías estimadas (kcal)
  timestamp: string;            // ISO Date String
  device_connected?: boolean;   // Enlace activo con el ESP32
  finger?: boolean;             // Dedo detectado sobre el sensor
}

export interface VitalsHistoryPoint {
  timeLabel: string;
  heartRate: number;
  bloodOxygen: number;
  systolicPressure: number;
  diastolicPressure: number;
  temperature: number;
  stressLevel: number;
  hrv?: number;
}

export interface AIAnalysisReport {
  id: string;
  timestamp: string;
  healthScore: number;          // 0 a 100
  status: VitalStatus;
  title: string;
  summary: string;
  recommendations: string[];
  anomaliesDetected: string[];
  confidence: number;           // 0 cuando la evaluación es por reglas (no hay certeza de modelo)
  method?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: string;
  metricsMentioned?: string[];
}

export interface DeviceInfo {
  name: string;
  model: string;
  connected: boolean;
  battery: number;
  lastSync: string;
  firmwareVersion: string;
  signalStrength: 'excellent' | 'good' | 'weak';
}

export type TimeRange = '24h' | '7d' | '30d';

export interface RawDevicePacket {
  bpm: number;
  spo2: number;
  systolic: number;
  diastolic: number;
  temperature?: number;
  stress?: number;
  stress_score?: number;
  hrv?: number;
  audio_rms: number;
  audio_peak: number;
  finger?: boolean;
  device_id?: string;
}

// ---------------------------------------------------------------------------
// Auscultación, alertas e informes (servidor SpiroScan en la Mac)
// ---------------------------------------------------------------------------

export type HeartFocus = 'AV' | 'PV' | 'TV' | 'MV';

export interface RecordingResult {
  recording_id: string;
  session_id: string;
  location: HeartFocus | '';
  duration_s: number;
  result: 'normal' | 'anormal' | 'calidad_insuficiente' | 'error';
  reason?: string | null;
  probability: number | null;
  threshold: number | null;
  quality?: { rms: number; clipping_ratio: number; duration_s?: number; windows?: number } | null;
  created_at?: string;
}

export type AlertSeverity = 'critical' | 'caution' | 'info';

export interface ClinicalAlert {
  id: number;
  session_id: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  action: string;
  llm_generated: boolean;
  data: Record<string, any>;
  created_at: string;
  acknowledged: boolean;
}

export interface FocusGuide {
  foco: HeartFocus;
  nombre: string;
  posicion: string;
  pasos: string[];
}

export interface HeartModelInfo {
  loaded: boolean;
  dataset?: string;
  umbral?: number;
  metricas_prueba?: { auc: number; sensibilidad: number; especificidad: number; n: number };
  limitaciones?: string[];
}

export interface SessionReport {
  report_id: number;
  pdf_url: string;
  llm_generated: boolean;
  content: { resumen: string; hallazgos: string[]; recomendacion: string; nota_referencia: string };
}
