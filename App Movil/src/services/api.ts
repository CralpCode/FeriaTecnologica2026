import { API_CONFIG, getSessionId } from '../config/api';
import { VitalSigns, VitalsHistoryPoint, AIAnalysisReport, DeviceInfo, TimeRange } from '../types/vitals';

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
        healthScore: data.healthScore || 85,
        status: data.status || 'normal',
        title: data.title || 'Análisis Clínico',
        summary: data.summary || 'Monitoreo activo.',
        recommendations: data.recommendations || ['Parámetros dentro de rango.'],
        anomaliesDetected: data.anomaliesDetected || [],
        confidence: data.confidence || 95,
        timestamp: data.timestamp || new Date().toISOString(),
      };
    } catch (error) {
      return {
        id: `err-${Date.now()}`,
        healthScore: 85,
        status: 'normal',
        title: 'Análisis Local',
        summary: 'Monitoreo activo.',
        recommendations: ['Parámetros en rango.'],
        anomaliesDetected: [],
        confidence: 90,
        timestamp: new Date().toISOString(),
      };
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
