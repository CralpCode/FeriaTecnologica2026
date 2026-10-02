import { API_CONFIG, getSessionId } from '../config/api';
import {
  VitalSigns, VitalsHistoryPoint, AIAnalysisReport, DeviceInfo, TimeRange,
  HeartFocus, RecordingResult, ClinicalAlert, FocusGuide, HeartModelInfo, SessionReport,
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

  async getCurrentVitals(): Promise<VitalSigns> {
    try {
      const sid = getSessionId();
      const response = await fetch(`${this.baseUrl}${API_CONFIG.ENDPOINTS.CURRENT_VITALS}?session_id=${encodeURIComponent(sid)}`, {
        method: 'GET',
        headers: this.defaultHeaders,
      });
      if (!response.ok) return ZERO_VITALS;
      return await response.json();
    } catch (error) {
      return ZERO_VITALS;
    }
  }

  async getVitalsHistory(range: TimeRange): Promise<VitalsHistoryPoint[]> {
    try {
      const sid = getSessionId();
      const response = await fetch(`${this.baseUrl}${API_CONFIG.ENDPOINTS.HISTORY}?range=${range}&session_id=${encodeURIComponent(sid)}`, {
        method: 'GET',
        headers: this.defaultHeaders,
      });
      if (!response.ok) return [];
      return await response.json();
    } catch (error) {
      return [];
    }
  }

  async sendTelemetry(data: Partial<VitalSigns>): Promise<boolean> {
    try {
      const sid = getSessionId();
      const response = await fetch(`${this.baseUrl}${API_CONFIG.ENDPOINTS.TELEMETRY}`, {
        method: 'POST',
        headers: this.defaultHeaders,
        body: JSON.stringify({ ...data, session_id: sid }),
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async getSessionsList(): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}${API_CONFIG.ENDPOINTS.SESSIONS}`, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
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
      const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sid)}/disconnect`, {
        method: 'POST',
        headers: this.defaultHeaders,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAIAnalysis(vitals: VitalSigns): Promise<AIAnalysisReport> {
    if (!vitals || vitals.heartRate === 0) {
      return {
        id: 'zero-vitals',
        healthScore: 0,
        status: 'normal',
        title: 'Dispositivo en Espera',
        summary: 'Dispositivo en espera. Enlaza tu ESP32 para ver el análisis médico.',
        recommendations: ['Esperando telemetría del sensor...'],
        anomaliesDetected: [],
        confidence: 0,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}${API_CONFIG.ENDPOINTS.AI_ANALYZE}`, {
        method: 'POST',
        headers: this.defaultHeaders,
        body: JSON.stringify({ vitals }),
      });
      if (!response.ok) throw new Error('API error');
      const data = await response.json();
      return {
        id: data.id || `ai-${Date.now()}`,
        healthScore: data.healthScore ?? 0,
        status: data.status || 'normal',
        title: data.title || 'Evaluación por reglas',
        summary: data.summary || '',
        recommendations: data.recommendations || [],
        anomaliesDetected: data.anomaliesDetected || [],
        confidence: data.confidence ?? 0,
        method: data.method,
        timestamp: data.timestamp || new Date().toISOString(),
      };
    } catch (error) {
      // Sin servidor no hay evaluación: se lanza el error para que el contexto use las reglas locales.
      throw error;
    }
  }

  async sendAIChatMessage(message: string, currentVitals: VitalSigns): Promise<string> {
    try {
      const sid = getSessionId();
      const response = await fetch(`${this.baseUrl}${API_CONFIG.ENDPOINTS.AI_CHAT}`, {
        method: 'POST',
        headers: this.defaultHeaders,
        body: JSON.stringify({ message, vitals: currentVitals, session_id: sid }),
      });
      if (!response.ok) throw new Error('Chat API error');
      const data = await response.json();
      return data.reply || data.message;
    } catch (error) {
      return 'No se pudo conectar con el servicio de IA en el backend.';
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
  armRecording(location: HeartFocus) {
    return this.request('/api/audio/arm', {
      method: 'POST',
      body: JSON.stringify({ session_id: getSessionId(), location }),
    });
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

  getGuide(location: HeartFocus): Promise<FocusGuide> {
    return this.request(`/api/guide/${location}`);
  }

  async askGuide(question: string, location: HeartFocus): Promise<string> {
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
      const response = await fetch(`${this.baseUrl}${API_CONFIG.ENDPOINTS.DEVICE_STATUS}`, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
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
}

export const apiService = new ApiService();
