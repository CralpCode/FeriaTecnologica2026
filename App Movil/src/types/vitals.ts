export type VitalStatus = 'normal' | 'caution' | 'critical';

export interface VitalSigns {
  heartRate: number;            // Latidos por minuto (BPM)
  bloodOxygen: number;          // Saturación SpO2 (%)
  systolicPressure: number;     // Presión sistólica (mmHg)
  diastolicPressure: number;    // Presión diastólica (mmHg)
  temperature: number;          // Temperatura corporal (°C)
  hrv: number;                  // Variabilidad ritmo cardíaco (ms)
  stressLevel: number;          // Nivel de estrés (0-100)
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
  confidence: number;           // Porcentaje de certeza del modelo IA
}

export interface PulmonaryProbabilities {
  normal: number;      // Patrón Eupneico (%)
  asthma: number;      // Asma Bronquial / Sibilancias (%)
  pneumonia: number;   // Neumonía / Infiltrados (%)
  copd: number;        // EPOC / Obstrucción (%)
  bronchitis: number;  // Bronquitis / Tos paroxística (%)
}

export interface PulmonaryReport {
  id: string;
  timestamp: string;
  health_score: number;         // 0 a 100
  status: VitalStatus;
  primary_prediction: string;   // Diagnóstico principal
  acoustic_decibels: number;    // Nivel RMS detectado por INMP441
  acoustic_peak: number;        // Pico de amplitud acústica
  spo2: number;                 // Saturación SpO2 correlacionada
  heart_rate: number;           // Frecuencia cardíaca asociada
  probabilities: PulmonaryProbabilities;
  findings: string[];           // Hallazgos clínicos
  recommendations: string[];    // Consejos preventivos y médicos
  confidence: number;           // Confianza del análisis
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
