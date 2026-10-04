import { API_CONFIG, getSessionId, BACKEND_FALLBACK_URLS, setCustomBackendUrl } from '../config/api';
import { normalizePublicVitals } from './measurementQuality';
import {
  VitalSigns,
  VitalsHistoryPoint,
  AIAnalysisReport,
  DeviceInfo,
  TimeRange,
   AcousticAnalysisResult,
  AuscultationFocus, AuscultationMode, RecordingResult, ClinicalAlert, FocusGuide, HeartModelInfo,
  SessionReport, TriageResult, PatientContext, ClinicalAssessment, SessionOverview, ReportItem, LungModelsInfo,
} from '../types/vitals';

const ZERO_VITALS: VitalSigns = {
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
  timestamp: '',
  device_connected: false,
  finger: false,
  source: 'unknown',
  heartRateValid: false,
  bloodOxygenValid: false,
  spo2Calibrated: false,
};

class ApiService {
  private get baseUrl() {
    return API_CONFIG.BASE_URL;
  }

  private get defaultHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    };
  }

  // Mecanismo de alta disponibilidad: Petición con tolerancia a fallos y auto-failover transparente
  private async fetchWithFailover(pathWithQuery: string, options: RequestInit = {}, timeoutMs: number = 4000): Promise<Response> {
    if (!this.baseUrl || this.baseUrl === 'offline') {
      throw new Error('Modo offline autónomo activo');
    }

    const urlsToTry = [
      this.baseUrl,
      ...BACKEND_FALLBACK_URLS.filter((u) => u !== this.baseUrl),
    ];

    let lastError: any = null;
    for (const base of urlsToTry) {
      if (!base || base === 'offline') continue;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`${base}${pathWithQuery}`, {
          ...options,
          signal: controller.signal,
          headers: {
            ...this.defaultHeaders,
            ...(options.headers || {}),
          },
        });
        clearTimeout(timeout);
        if (res.ok) {
          if (base !== this.baseUrl && typeof window !== 'undefined') {
            setCustomBackendUrl(base);
          }
          return res;
        }
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Servidor backend no disponible');
  }

  async getCurrentVitals(): Promise<VitalSigns> {
    try {
      const sid = getSessionId();
      const response = await this.fetchWithFailover(
        `${API_CONFIG.ENDPOINTS.CURRENT_VITALS}?session_id=${encodeURIComponent(sid)}`,
        { method: 'GET' }
      );
      if (!response.ok) return ZERO_VITALS;
      return normalizePublicVitals(await response.json());
    } catch (error) {
      return ZERO_VITALS;
    }
  }

  async getVitalsHistory(range: TimeRange): Promise<VitalsHistoryPoint[]> {
    try {
      const sid = getSessionId();
      const response = await this.fetchWithFailover(
        `${API_CONFIG.ENDPOINTS.HISTORY}?range=${range}&session_id=${encodeURIComponent(sid)}`,
        { method: 'GET' }
      );
      if (!response.ok) return [];
      return await response.json();
    } catch (error) {
      return [];
    }
  }

  async sendTelemetry(data: Partial<VitalSigns>): Promise<boolean> {
    try {
      const sid = getSessionId();
      const response = await this.fetchWithFailover(API_CONFIG.ENDPOINTS.TELEMETRY, {
        method: 'POST',
        body: JSON.stringify({ ...data, session_id: sid }),
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async getSessionsList(): Promise<any[]> {
    try {
      const response = await this.fetchWithFailover(API_CONFIG.ENDPOINTS.SESSIONS, {
        method: 'GET',
      });
      if (!response.ok) return [];
      return await response.json();
    } catch {
      return [];
    }
  }

  async disconnectSession(sessionId?: string): Promise<boolean> {
    try {
      const sid = sessionId || getSessionId();
      const response = await this.fetchWithFailover(
        `/api/sessions/${encodeURIComponent(sid)}/disconnect`,
        { method: 'POST' }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAIAnalysis(vitals: VitalSigns): Promise<AIAnalysisReport> {
    if (!vitals || vitals.heartRate === 0) {
      return {
        id: 'zero-vitals',
        healthScore: null,
        status: 'insufficient_data',
        title: 'Dispositivo en Espera',
        summary: 'Dispositivo en espera. Enlaza tu ESP32 para ver el análisis médico.',
        recommendations: ['Esperando telemetría del sensor...'],
        anomaliesDetected: [],
        confidence: null,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const response = await this.fetchWithFailover(API_CONFIG.ENDPOINTS.AI_ANALYZE, {
        method: 'POST',
        headers: this.defaultHeaders,
        body: JSON.stringify({ session_id: getSessionId() }),
      });
      if (!response.ok) throw new Error('API error');
      const data = await response.json();
      return {
        id: data.id || `ai-${Date.now()}`,
        healthScore: null,
        status: data.status || 'insufficient_data',
        title: data.title || 'Evaluación por reglas',
        summary: data.summary || '',
        recommendations: data.recommendations || [],
        anomaliesDetected: data.anomaliesDetected || [],
        confidence: null,
        method: data.method,
        timestamp: data.timestamp || new Date().toISOString(),
        acoustic_analysis: data.acoustic_analysis || null,
      };
    } catch (error) {
      // Sin servidor no hay evaluación: se lanza el error para que el contexto use las reglas locales.
      throw error;
    }
  }

  async classifyAudio(features: Record<string, number>, sessionId?: string): Promise<AcousticAnalysisResult | null> {
    try {
      const sid = sessionId || getSessionId();
      const response = await fetch(`${this.baseUrl}${API_CONFIG.ENDPOINTS.AI_AUDIO_CLASSIFY}`, {
        method: 'POST',
        headers: this.defaultHeaders,
        body: JSON.stringify({ features, session_id: sid }),
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  // Análisis y Predicción de Enfermedades Pulmonares con IA (Nube o Motor Local Offline)
  async sendAIChatMessage(message: string, currentVitals: VitalSigns): Promise<string> {
    try {
      const sid = getSessionId();
      const response = await this.fetchWithFailover(
        API_CONFIG.ENDPOINTS.AI_CHAT,
        {
          method: 'POST',
          body: JSON.stringify({ message, session_id: sid }),
        },
        100000 // El servidor local puede tardar hasta 90 s en responder.
      );
      if (!response.ok) throw new Error('Chat API error');
      const data = await response.json();
      return data.reply || data.message;
    } catch (error) {
      return 'El servidor de valoración no está disponible. No se ha generado una evaluación con estos datos. Revisa la conexión y vuelve a intentar.';
    }
  }

  // -------------------------------------------------------------------------
  // Auscultación, alertas e informes
  // -------------------------------------------------------------------------

  get liveSocketUrl(): string {
    return `${this.baseUrl.replace(/^http/, 'ws')}/ws/live`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: this.defaultHeaders });
    if (!response.ok) {
      const detail = await response.json().then((d) => d.detail).catch(() => response.statusText);
      throw new Error(detail || `HTTP ${response.status}`);
    }
    return response.json();
  }

  /** Indica al servidor que la próxima grabación del ESP32 pertenece a esta sesión y foco. */
  armRecording(location: AuscultationFocus, mode: AuscultationMode) {
    return this.request('/api/audio/arm', {
      method: 'POST',
      body: JSON.stringify({ session_id: getSessionId(), location, mode }),
    });
  }

  getHistory(): Promise<SessionOverview[]> {
    return this.request('/api/history');
  }

  getSessionRecordings(sessionId: string): Promise<RecordingResult[]> {
    return this.request(`/api/recordings?session_id=${encodeURIComponent(sessionId)}`);
  }

  listReports(sessionId: string): Promise<ReportItem[]> {
    return this.request(`/api/reports?session_id=${encodeURIComponent(sessionId)}`);
  }

  recordingAudioUrl(recordingId: string): string {
    return `${this.baseUrl}/api/recordings/${encodeURIComponent(recordingId)}/audio`;
  }

  absoluteUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  createReportFor(sessionId: string): Promise<SessionReport> {
    return this.request(`/api/reports/session/${encodeURIComponent(sessionId)}`, { method: 'POST' });
  }

  getTriage(): Promise<TriageResult> {
    return this.request(`/api/triage/${encodeURIComponent(getSessionId())}`);
  }

  getPatientContext(sessionId: string): Promise<PatientContext> {
    return this.request(`/api/clinical/context/${encodeURIComponent(sessionId)}`);
  }

  savePatientContext(sessionId: string, context: PatientContext): Promise<PatientContext> {
    return this.request(`/api/clinical/context/${encodeURIComponent(sessionId)}`, {
      method: 'PUT', body: JSON.stringify(context),
    });
  }

  getClinicalAssessment(sessionId: string): Promise<ClinicalAssessment> {
    return this.request(`/api/clinical/assessment/${encodeURIComponent(sessionId)}`);
  }

  getModelsInfo(): Promise<{ corazon: HeartModelInfo; pulmon: LungModelsInfo }> {
    return this.request('/api/models');
  }

  /** Indica al servidor que los datos que lleguen del ESP32 por WiFi pertenecen a esta sesión. */
  linkDevice() {
    return this.request(API_CONFIG.ENDPOINTS.DEVICE_LINK, {
      method: 'POST',
      body: JSON.stringify({ session_id: getSessionId() }),
    });
  }

  getRecordings(): Promise<RecordingResult[]> {
    return this.request(`/api/recordings?session_id=${encodeURIComponent(getSessionId())}`);
  }

  getAlerts(): Promise<ClinicalAlert[]> {
    return this.request(`/api/alerts?session_id=${encodeURIComponent(getSessionId())}`);
  }

  ackAlert(id: number): Promise<ClinicalAlert> {
    return this.request(`/api/alerts/${id}/ack`, { method: 'POST' });
  }

  createSessionReport(): Promise<SessionReport> {
    return this.request(`/api/reports/session/${encodeURIComponent(getSessionId())}`, { method: 'POST' });
  }

  reportPdfUrl(report: SessionReport): string {
    return `${this.baseUrl}${report.pdf_url}`;
  }

  getGuide(location: AuscultationFocus): Promise<FocusGuide> {
    return this.request(`/api/guide/${location}`);
  }

  async askGuide(question: string, location: AuscultationFocus): Promise<string> {
    const data = await this.request<{ answer: string }>('/api/guide/ask', {
      method: 'POST',
      body: JSON.stringify({ question, location, session_id: getSessionId() }),
    });
    return data.answer;
  }

  getHeartModelInfo(): Promise<HeartModelInfo> {
    return this.request('/api/model/heart');
  }

  async getDeviceStatus(): Promise<DeviceInfo> {
    try {
      const response = await this.fetchWithFailover(API_CONFIG.ENDPOINTS.DEVICE_STATUS, {
        method: 'GET',
      });
      if (!response.ok) throw new Error('Status API error');
      return await response.json();
    } catch (error) {
      return {
        name: 'SpiroScan-Band',
        model: 'ESP32 Bio-Acústico',
        connected: false,
        battery: 0,
        lastSync: new Date().toISOString(),
        firmwareVersion: 'v1.5.0',
        signalStrength: 'weak',
      };
    }
  }

  getDemoAudioUrl(sampleId: string): string {
    return `${this.baseUrl}/api/demo/audio/${sampleId}.wav`;
  }

  async getDemoSamples(): Promise<Record<string, any>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/demo/samples`, {
        headers: this.defaultHeaders,
      });
      if (!response.ok) return {};
      return await response.json();
    } catch {
      return {};
    }
  }

  async injectDemoSample(sampleId: string): Promise<any | null> {
    try {
      const sid = getSessionId();
      const response = await fetch(`${this.baseUrl}/api/demo/inject/${encodeURIComponent(sampleId)}?session_id=${encodeURIComponent(sid)}`, {
        method: 'POST',
        headers: this.defaultHeaders,
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }
}

export const apiService = new ApiService();

