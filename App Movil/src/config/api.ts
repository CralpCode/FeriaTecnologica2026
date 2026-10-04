export const PRIMARY_BACKEND_URL = 'https://terminology-reward-troy-competitors.trycloudflare.com';

// Mecanismo de alta disponibilidad y tolerancia a fallos con múltiples endpoints ordenados por prioridad
export const BACKEND_FALLBACK_URLS: string[] = [
  'https://terminology-reward-troy-competitors.trycloudflare.com', // 1. Principal Cloudflare activo
  'https://antecedently-unsuppositive-teressa.ngrok-free.dev',    // 2. Respaldo túnel Ngrok
  'http://192.168.1.163:8000',                                    // 3. Respaldo LAN local
  'http://localhost:8000',                                        // 4. Respaldo Localhost
];

export const DEFAULT_CLOUD_BACKEND = PRIMARY_BACKEND_URL;
export const DEFAULT_LOCAL_LAN = 'http://192.168.1.163:8000';

let memoryCustomUrl: string | null = null;
let memorySessionId: string = 'apk_' + Math.random().toString(36).substring(2, 7);

export const setCustomBackendUrl = (url: string) => {
  memoryCustomUrl = url ? url.trim().replace(/\/+$/, '') : null;
  if (typeof window !== 'undefined' && window.localStorage) {
    if (!url) {
      window.localStorage.removeItem('SPIROSCAN_CUSTOM_BACKEND_URL');
    } else {
      window.localStorage.setItem('SPIROSCAN_CUSTOM_BACKEND_URL', memoryCustomUrl!);
    }
  }
};

export const getCustomBackendUrl = (): string | null => {
  if (memoryCustomUrl) return memoryCustomUrl;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem('SPIROSCAN_CUSTOM_BACKEND_URL');
  }
  return null;
};

const getDynamicBaseUrl = () => {
  // 1. Preferencia personalizada por el usuario
  const custom = getCustomBackendUrl();
  if (custom) return custom;

  // 2. Entorno Web en navegador
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    // Servidor de desarrollo de Expo (puerto 8081): el backend está en el puerto 8000 del mismo equipo.
    if (window.location.port === '8081') {
      return `${window.location.protocol}//${window.location.hostname}:8000`;
    }
    // App servida por la propia Mac (http://spiroscan.local:8000, IP o túnel): mismo origen.
    return window.location.origin;
  }

  // 3. Entorno Nativo / APK móvil (acceso remoto global por defecto)
  return process.env.EXPO_PUBLIC_API_URL || PRIMARY_BACKEND_URL;
};

export const getSessionId = (): string => {
  if (typeof window !== 'undefined') {
    let sid = window.sessionStorage?.getItem('SPIROSCAN_SESSION_ID') || window.localStorage?.getItem('SPIROSCAN_SESSION_ID');
    if (!sid) {
      const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent || '');
      const prefix = isMobile ? 'movil' : 'pc';
      sid = `${prefix}_${Math.random().toString(36).substring(2, 7)}`;
      try {
        window.sessionStorage?.setItem('SPIROSCAN_SESSION_ID', sid);
        window.localStorage?.setItem('SPIROSCAN_SESSION_ID', sid);
      } catch {}
    }
    return sid;
  }
  return memorySessionId;
};

export const setSessionId = (id: string) => {
  const clean = id.trim() || 'default';
  memorySessionId = clean;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage?.setItem('SPIROSCAN_SESSION_ID', clean);
      window.localStorage?.setItem('SPIROSCAN_SESSION_ID', clean);
    } catch {}
  }
};

export const generateNewSessionId = (label?: string): string => {
  const prefix = label ? label.toLowerCase().replace(/[^a-z0-9]/g, '') : 'sess';
  const newId = `${prefix}_${Math.random().toString(36).substring(2, 7)}`;
  setSessionId(newId);
  return newId;
};

export const API_CONFIG = {
  USE_MOCK_DATA: false,
  get BASE_URL() {
    return getDynamicBaseUrl();
  },
  TIMEOUT_MS: 60000,
  POLL_INTERVAL_MS: 1000,  // el ESP32 envía 1 lectura por segundo al servidor
  ENDPOINTS: {
    CURRENT_VITALS: '/api/vitals/current',
    HISTORY: '/api/vitals/history',
    TELEMETRY: '/api/telemetry',
    AI_ANALYZE: '/api/ai/vitals/analyze',
    AI_PULMONARY_ANALYZE: '/api/ai/pulmonary/analyze',
    AI_AUDIO_CLASSIFY: '/api/ai/audio/classify',
    AI_CHAT: '/api/ai/chat',
    AI_GENERATE: '/api/ai/llm/generate',
    DEVICE_STATUS: '/api/device/status',
    DEVICE_SESSION: '/api/device/session',
    DEVICE_CONNECT: '/api/device/connect',
    DEVICE_DISCONNECT: '/api/device/disconnect',
    DEVICE_LINK: '/api/device/link',
    SESSIONS: '/api/sessions',
    SESSIONS_CREATE: '/api/sessions/create',
  },
};
