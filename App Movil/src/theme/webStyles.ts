import { Platform } from 'react-native';

/**
 * Reglas globales solo para la versión web: letra de los campos de texto, suavizado de la letra,
 * contorno visible al navegar con teclado y sin resaltado azul al tocar en celulares.
 */
export function installWebStyles() {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById('spiroscan-web-styles')) return;
  const el = document.createElement('style');
  el.id = 'spiroscan-web-styles';
  el.textContent = `
    html, body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
    input, textarea { font-family: Inter_400Regular, system-ui, sans-serif !important; }
    * { -webkit-tap-highlight-color: transparent; }
    [role="button"]:focus-visible, [role="tab"]:focus-visible, [role="radio"]:focus-visible, [role="link"]:focus-visible,
    [role="menuitem"]:focus-visible, input:focus-visible, textarea:focus-visible {
      outline: 3px solid rgba(29, 78, 216, 0.45); outline-offset: 2px; border-radius: 10px;
    }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
  `;
  document.head.appendChild(el);
}
