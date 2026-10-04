import { useWindowDimensions } from 'react-native';

export type LayoutSize = 'phone' | 'tablet' | 'desktop';

/** Ancho máximo del contenido en pantallas grandes, para que nada se estire de lado a lado. */
export const CONTENT_MAX_WIDTH = 1200;

/**
 * Tamaño de la pantalla para adaptar el diseño:
 *   phone   < 600 px  -> una columna y barra de navegación inferior
 *   tablet  600-1024  -> dos columnas donde ayude; barra lateral si está horizontal
 *   desktop > 1024    -> barra lateral y dos columnas
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const size: LayoutSize = width < 600 ? 'phone' : width <= 1024 ? 'tablet' : 'desktop';
  const landscape = width > height;
  return {
    width,
    height,
    size,
    isPhone: size === 'phone',
    isDesktop: size === 'desktop',
    /** Barra lateral en computadora y en tablet horizontal; barra inferior en el resto. */
    useSideNav: size === 'desktop' || (size === 'tablet' && landscape),
    /** Dos columnas cuando hay espacio suficiente. */
    twoColumns: width >= 900,
  };
}

/**
 * Presentación de los modales: hoja desde abajo en celular; ventana centrada (máx. 640 px)
 * en tablet y computadora, para que no ocupe todo el ancho de la pantalla.
 */
export function useModalLayout() {
  const { isPhone } = useLayout();
  return {
    animationType: (isPhone ? 'slide' : 'fade') as 'slide' | 'fade',
    overlay: isPhone ? null : ({ justifyContent: 'center', alignItems: 'center', padding: 24 } as const),
    sheet: isPhone ? null : ({ width: '100%', maxWidth: 640, borderRadius: 22, maxHeight: '90%' } as const),
  };
}
