import { Platform } from 'react-native';

/** Tiempo mínimo en pantalla para que el logo no aparezca y desaparezca de golpe. */
const MIN_VISIBLE_MS = 700;

/** Desvanece la pantalla de carga de la versión web (public/index.html) cuando la app ya está lista. */
export function hideWebSplash() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const el = document.getElementById('spiroscan-splash');
  if (!el || el.classList.contains('ss-out')) return;
  const wait = Math.max(0, MIN_VISIBLE_MS - performance.now());
  setTimeout(() => {
    el.classList.add('ss-out');
    el.setAttribute('aria-busy', 'false');
    setTimeout(() => el.remove(), 400);
  }, wait);
}
