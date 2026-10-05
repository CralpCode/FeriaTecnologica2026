/**
 * Tipografía de SpiroScan: Inter incluida en la app (funciona sin internet y se ve igual en todos los equipos).
 * Cada grosor es un archivo propio; `familyFor` elige el archivo según el fontWeight del estilo.
 */
export const FONT_FILES = {
  Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
  Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
  Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
  Inter_700Bold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
  Inter_800ExtraBold: require('@expo-google-fonts/inter/800ExtraBold/Inter_800ExtraBold.ttf'),
};

export type FontFamily = keyof typeof FONT_FILES;

export const family = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
} as const;

/** Archivo de Inter para un fontWeight de React Native ('400', '700', 'bold', 800…). */
export function familyFor(weight?: string | number | null): FontFamily {
  if (weight === 'bold') return 'Inter_700Bold';
  const w = Number(weight ?? 400);
  if (!Number.isFinite(w) || w < 450) return 'Inter_400Regular';
  if (w < 550) return 'Inter_500Medium';
  if (w < 650) return 'Inter_600SemiBold';
  if (w < 750) return 'Inter_700Bold';
  return 'Inter_800ExtraBold';
}
