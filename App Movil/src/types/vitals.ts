export type VitalStatus = 'normal' | 'caution' | 'critical' | 'insufficient_data';

export interface MeasurementQuality {
  source?: 'real' | 'simulated' | 'unknown';
  heartRateValid?: boolean;
  bloodOxygenValid?: boolean;
  spo2Calibrated?: boolean;
  signalQuality?: string | null;
  audioUnit?: string;
  sampleAgeMs?: number | null;
  validadoPor?: string;           // "servidor" si el paquete venía en el formato original del firmware
}

export interface VitalSigns extends MeasurementQuality {
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

export interface VitalsHistoryPoint extends MeasurementQuality {
  timeLabel: string;
  heartRate: number;
  bloodOxygen: number;
  systolicPressure: number;
  diastolicPressure: number;
  temperature: number;
  stressLevel: number;
  hrv?: number;
}

export interface AcousticAnalysisResult {
  prediction: string;             // "Normal" | "Patologico (Sibilancias/Crepitantes)"
  is_abnormal: number;            // 0 (sano) | 1 (anomalía adventicia)
  confidence: number;             // Certeza estadística del modelo (0 a 100%)
  probability_abnormal?: number;   // Probabilidad sigmoidea (0.0 a 1.0)
  model_name?: string;             // "Logistic Regression (L2)"
  score_icbhi?: number;           // Métrica de benchmark clínico (ej. 61.22%)
}

export interface AIAnalysisReport {
  id: string;
  timestamp: string;
  healthScore: number | null;   // Sin puntuación de salud validada: null
  status: VitalStatus;
  title: string;
  summary: string;
  recommendations: string[];
  anomaliesDetected: string[];
  confidence: number | null;    // Sin probabilidad clínica validada: null
  method?: string;
  acoustic_analysis?: AcousticAnalysisResult | null; // Resultado del modelo base de pulmón (ICBHI)
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

export interface RawDevicePacket extends MeasurementQuality {
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
  test?: boolean;
  device_id?: string;
  heart_rate_valid?: boolean;
  spo2_valid?: boolean;
  spo2_calibrated?: boolean;
  signal_quality?: string | null;
  sample_age_ms?: number | null;
}

export interface PatientContext {
  age_years: number | null;
  at_rest: boolean | null;
  altitude_m: number | null;
  symptoms: Record<'dyspnea' | 'chest_pain' | 'syncope' | 'cyanosis' | 'confusion' | 'severe_breathlessness' | 'cough' | 'fever' | 'wheeze' | 'orthopnea' | 'edema', boolean | null>;
  history: Record<'asthma' | 'copd' | 'smoking', boolean | null>;
}

export interface ClinicalAssessment {
  status: 'insufficient_data' | 'findings' | 'no_specific_findings' | 'urgent';
  summary: string;
  findings: { code: string; label: string; evidence: string[] }[];
  possibilities: { condition: string; why: string[]; confirmation: string[]; source_ids: string[] }[];
  missing_data: string[];
  limitations: string[];
  next_steps: string[];
  urgent: boolean;
  sources: { id: string; title: string; url: string }[];
  disease_probabilities: null;
}

// ---------------------------------------------------------------------------
// Auscultación, alertas e informes (servidor SpiroScan en la Mac)
// ---------------------------------------------------------------------------

export type HeartFocus = 'AV' | 'PV' | 'TV' | 'MV';
export type LungZone = 'TC' | 'AL' | 'AR' | 'PL' | 'PR' | 'LL' | 'LR';
export type AuscultationFocus = HeartFocus | LungZone;
export type AuscultationMode = 'corazon' | 'pulmon';

export interface MurmurTrait {
  valor: string;
  confianza: number;
  exactitud_modelo: number;
}

export interface RecordingDetails {
  caracteristicas_soplo?: Record<string, MurmurTrait>;
  ruidos?: Record<string, { presente: boolean; probabilidad: number; umbral: number; sensibilidad_modelo: number }>;
  patron?: { compatible_con: string; probabilidad: number; sensibilidad_modelo: number };
  modelo_base?: { prediction: string; probability_abnormal: number; model_name: string; score_icbhi: number };
  /** Presente si el servidor corrigió el audio con la respuesta medida de la pieza (fantoma). */
  ecualizacion?: { perfil: string; bandas_corregidas: number; max_refuerzo_db: number; relativa_a_referencia?: boolean };
}

export type TriageLevel = 'rojo' | 'amarillo' | 'verde' | 'gris';

export interface TriageResult {
  session_id: string;
  nivel: TriageLevel;
  titulo: string;
  motivos: string[];
  aviso: string;
  demo?: boolean;               // incluye un caso de demostración ICBHI (no es de esta persona)
  datos_usados?: {
    vitales_ultimo_minuto: { spo2: number | null; fc: number | null; lecturas: number } | null;
  };
}

export interface RecordingResult {
  recording_id: string;
  session_id: string;
  location: AuscultationFocus | '';
  mode?: AuscultationMode;
  duration_s: number;
  result: 'normal' | 'anormal' | 'calidad_insuficiente' | 'modelo_no_disponible' | 'error';
  details?: RecordingDetails;
  has_audio?: boolean;
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

export interface SessionOverview {
  session_id: string;
  first_seen: string | null;
  last_seen: string | null;
  readings: number;
  recordings: number;
  abnormal_recordings: number;
  alerts: number;
  active_alerts: number;
  reports: number;
  triaje: TriageLevel;
}

export interface ReportItem {
  report_id: number;
  session_id: string;
  created_at: string;
  llm_generated: boolean;
  pdf_url: string;
  has_pdf: boolean;
}

export interface FocusGuide {
  foco: AuscultationFocus;
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
  caracterizacion_soplo?: Record<string, { mostrar: boolean; exactitud_balanceada: number; azar: number }> | null;
}

export interface LungModelsInfo {
  lung_sounds_cnn?: { loaded: boolean; metricas_prueba?: Record<string, any> };
  lung_disease_cnn?: { loaded: boolean; metricas_prueba?: Record<string, any>; mostrar?: boolean };
  modelo_base?: { loaded: boolean; model_name?: string; puntaje_icbhi_reportado?: number; extractor_listo?: boolean };
}

export interface SessionReport {
  report_id: number;
  pdf_url: string;
  llm_generated: boolean;
  content: { resumen: string; hallazgos: string[]; recomendacion: string; nota_referencia: string };
}
