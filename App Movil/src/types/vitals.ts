export type VitalStatus = 'normal' | 'caution' | 'critical' | 'insufficient_data';

export type VitalMetric =
  | 'heartRate' | 'bloodOxygen' | 'systolicPressure' | 'diastolicPressure'
  | 'temperature' | 'hrv' | 'stressLevel' | 'chipTemperature'
  | 'audio_rms' | 'audio_peak' | 'steps' | 'calories';
export type MeasurementProvenance = 'measured' | 'derived' | 'estimated' | 'unavailable' | 'unverified';

export interface MeasurementQuality {
  validity?: Partial<Record<VitalMetric, boolean>>;
  provenance?: Partial<Record<VitalMetric, MeasurementProvenance>>;
  spo2_calibrated?: boolean;
  chipTemperature?: number; // Temperature inside MAX30102, not body temperature.
  source?: string;
}

export interface VitalSigns extends MeasurementQuality {
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
  scan_mode?: 'cardiac' | 'pulmonary' | 'continuous' | 'none'; // Modo de escaneo activo (disparado por boton fisico o app)
  scan_sec?: number;            // Segundos restantes del escaneo (o transcurridos en continuo)
  scan_phase?: 'calibrating' | 'measuring' | 'none'; // Fase del escaneo clínico (calibración previa vs medición activa)
  cardiac_locked?: boolean;     // Verdadero únicamente cuando el pulso fue fijado y calibrado
  power?: 'active' | 'standby'; // Estado energetico del hardware
}

export interface VitalsHistoryPoint extends MeasurementQuality {
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
  v?: number;                   // Telemetry contract version (2 carries validity).
  valid?: number;               // 1=BPM, 2=SpO2 estimate, 4=PRV RMSSD, 8=chip temp, 16=audio.
  cal?: boolean;                // SpO2 calibration supplied by the device.
  source?: string;
  bpm?: number | null;
  spo2?: number | null;
  systolic?: number | null;
  diastolic?: number | null;
  temperature?: number | null;
  chip_temp?: number | null;
  stress?: number | null;
  stress_score?: number | null;
  hrv?: number | null;
  audio_rms?: number | null;
  audio_peak?: number | null;
  finger?: boolean;
  device_id?: string;
  scan_mode?: 'cardiac' | 'pulmonary' | 'continuous' | 'none';
  scan_sec?: number;
  scan_phase?: 'calibrating' | 'measuring' | 'none';
  cardiac_locked?: boolean;
  power?: 'active' | 'standby';
}
