/**
 * Sistema visual de SpiroScan: clínico, claro y sobrio.
 * Un azul principal, neutros, colores solo para estados y morado únicamente para lo que hace la IA.
 * `Colors` (theme/colors.ts) sigue existiendo mientras se migran las pantallas.
 */
export const color = {
  primary: '#1D4ED8',
  primaryHover: '#1E40AF',
  primarySoft: '#EFF4FF',
  primaryBorder: '#C7D7FE',

  bg: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F3F6',
  border: '#E3E7EC',
  borderStrong: '#CBD2DA',

  text: '#111827',
  textSecondary: '#4B5563',
  textMuted: '#6B7280',
  textOnPrimary: '#FFFFFF',

  success: '#047857',
  successSoft: '#ECFDF5',
  warning: '#B45309',
  warningSoft: '#FFFBEB',
  danger: '#B91C1C',
  dangerSoft: '#FEF2F2',
  info: '#0369A1',
  infoSoft: '#F0F9FF',
  ai: '#6D28D9',
  aiSoft: '#F5F3FF',
} as const;

export const font = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 32 } as const;
export const weight = { regular: '400', medium: '600', bold: '700', heavy: '800' } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
/** Área táctil mínima recomendada. */
export const touch = 44;

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'ai';

export const toneColors: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: color.textSecondary, bg: color.surfaceMuted, border: color.border },
  primary: { fg: color.primary, bg: color.primarySoft, border: color.primaryBorder },
  success: { fg: color.success, bg: color.successSoft, border: '#A7F3D0' },
  warning: { fg: color.warning, bg: color.warningSoft, border: '#FDE68A' },
  danger: { fg: color.danger, bg: color.dangerSoft, border: '#FECACA' },
  info: { fg: color.info, bg: color.infoSoft, border: '#BAE6FD' },
  ai: { fg: color.ai, bg: color.aiSoft, border: '#DDD6FE' },
};
