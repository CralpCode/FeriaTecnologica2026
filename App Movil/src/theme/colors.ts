import { color } from './tokens';

/**
 * Paleta usada por las pantallas existentes. Toma sus valores de theme/tokens.ts (estilo clínico claro y
 * sobrio) para que toda la app se vea igual; los acentos de señales quedan en tonos menos saturados.
 */
export const Colors = {
  // Primario
  primary: color.primary,
  primarySoft: color.primarySoft,
  primaryDark: color.primaryHover,

  // Fondos y superficies
  background: color.bg,
  backgroundSecondary: color.surfaceMuted,
  card: color.surface,
  cardBorder: color.border,
  cardElevated: color.surface,

  // Acentos de señales (solo para identificar cada lectura)
  heartRate: '#BE123C',
  heartRateSoft: '#FFF1F2',
  oxygen: '#0369A1',
  oxygenSoft: '#F0F9FF',
  pressure: '#B45309',
  pressureSoft: '#FFFBEB',
  temperature: '#047857',
  temperatureSoft: '#ECFDF5',
  stress: '#6D28D9',
  stressSoft: '#F5F3FF',
  steps: color.primary,
  stepsSoft: color.primarySoft,
  audio: '#0E7490',
  audioSoft: '#ECFEFF',

  // Inteligencia artificial
  aiPurple: color.ai,
  aiPurpleGlow: 'rgba(109, 40, 217, 0.12)',
  aiPurpleSoft: color.aiSoft,
  aiCyan: color.info,
  aiGradient: [color.ai, color.primary],

  // Estados
  danger: color.danger,
  dangerSoft: color.dangerSoft,
  warning: color.warning,
  warningSoft: color.warningSoft,
  success: color.success,
  successSoft: color.successSoft,

  // Texto y líneas
  textPrimary: color.text,
  textSecondary: color.textSecondary,
  textMuted: color.textMuted,
  border: color.border,
};
