import { Linking } from 'react-native';
import { AuscultationMode } from '../types/vitals';

/**
 * Reproductor de grabaciones (.wav) del servidor, con filtro de escucha.
 * En la app web (servida desde la Mac) usa el reproductor del navegador y filtra con Web Audio;
 * en la app nativa abre el audio en el navegador del teléfono (sin filtro).
 *
 * El filtro solo cambia lo que se ESCUCHA: no toca el audio guardado ni lo que analiza la IA.
 */

/** auto = según el foco: pulmón -> agudos (diafragma); corazón -> sin filtro. */
export type ListeningFilter = 'auto' | 'none' | 'bell' | 'diaphragm' | 'ai';
type ResolvedFilter = Exclude<ListeningFilter, 'auto'>;
type Band = [number | null, number | null]; // [paso alto, paso bajo] en Hz

// Cortes orientativos para escuchar, no validados con este estetoscopio. "ai" usa la misma banda que
// analiza el modelo de ese foco (Backend/ml/features.py y Backend/ml/lung_features.py).
const BANDS: Record<ResolvedFilter, Record<AuscultationMode, Band>> = {
  none: { corazon: [null, null], pulmon: [null, null] },
  bell: { corazon: [null, 200], pulmon: [null, 200] },
  diaphragm: { corazon: [100, null], pulmon: [100, null] },
  ai: { corazon: [20, 600], pulmon: [100, 1800] },
};

export const FILTER_LABELS: Record<ListeningFilter, string> = {
  auto: 'Según el foco',
  none: 'Sin filtro',
  bell: 'Campana · graves',
  diaphragm: 'Diafragma · agudos',
  ai: 'Lo que analizó la IA',
};

export function resolveFilter(choice: ListeningFilter, mode: AuscultationMode = 'corazon'): ResolvedFilter {
  if (choice !== 'auto') return choice;
  return mode === 'pulmon' ? 'diaphragm' : 'none';
}

/** Texto corto con la banda que se escucha, p. ej. "más de 100 Hz". */
export function describeBand(choice: ListeningFilter, mode: AuscultationMode = 'corazon'): string {
  const [hp, lp] = BANDS[resolveFilter(choice, mode)][mode];
  if (hp && lp) return `${hp}–${lp} Hz`;
  if (hp) return `más de ${hp} Hz`;
  if (lp) return `menos de ${lp} Hz`;
  return 'todo el sonido';
}

let current: any = null;
let currentUrl: string | null = null;
let currentMode: AuscultationMode = 'corazon';
let currentSource: any = null;
let currentNodes: any[] = [];
let audioContext: any = null;
let filterChoice: ListeningFilter = 'auto';
const listeners = new Set<(url: string | null) => void>();
const filterListeners = new Set<(choice: ListeningFilter) => void>();

const notify = () => listeners.forEach((l) => l(currentUrl));

function context(): any {
  const Ctx = typeof window !== 'undefined' && ((window as any).AudioContext || (window as any).webkitAudioContext);
  if (!Ctx) return null;
  if (!audioContext) audioContext = new Ctx();
  return audioContext;
}

/** Conecta la grabación actual a la cadena de filtros (2 biquads por corte, ~24 dB/octava). */
function connectFilters() {
  const ctx = audioContext;
  if (!ctx || !currentSource) return;
  currentSource.disconnect();
  currentNodes.forEach((n) => n.disconnect());
  currentNodes = [];
  const [hp, lp] = BANDS[resolveFilter(filterChoice, currentMode)][currentMode];
  for (const [type, freq] of [['highpass', hp], ['lowpass', lp]] as const) {
    if (!freq) continue;
    for (let i = 0; i < 2; i++) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = Math.SQRT1_2;
      currentNodes.push(f);
    }
  }
  let node = currentSource;
  for (const f of currentNodes) {
    node.connect(f);
    node = f;
  }
  node.connect(ctx.destination);
}

export const audioPlayer = {
  isWeb(): boolean {
    return typeof window !== 'undefined' && !!(window as any).Audio;
  },

  playing(): string | null {
    return currentUrl;
  },

  /** Avance de la grabación que suena (0 a 1) para dibujar la línea sobre la onda. */
  progress(url: string): number {
    if (currentUrl !== url || !current) return 0;
    const d = Number(current.duration);
    return Number.isFinite(d) && d > 0 ? Math.min(1, Number(current.currentTime) / d) : 0;
  },

  onChange(listener: (url: string | null) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getFilter(): ListeningFilter {
    return filterChoice;
  },

  /** Cambia el filtro; si hay una grabación sonando, se aplica de inmediato. */
  setFilter(choice: ListeningFilter) {
    filterChoice = choice;
    connectFilters();
    filterListeners.forEach((l) => l(choice));
  },

  onFilterChange(listener: (choice: ListeningFilter) => void): () => void {
    filterListeners.add(listener);
    return () => filterListeners.delete(listener);
  },

  stop() {
    if (current) {
      current.pause();
      current.currentTime = 0;
    }
    if (currentSource) {
      currentSource.disconnect();
      currentNodes.forEach((n) => n.disconnect());
    }
    current = null;
    currentUrl = null;
    currentSource = null;
    currentNodes = [];
    notify();
  },

  async toggle(url: string, mode: AuscultationMode = 'corazon') {
    if (currentUrl === url) {
      this.stop();
      return;
    }
    this.stop();
    if (!this.isWeb()) {
      await Linking.openURL(url);
      return;
    }
    const audio = new (window as any).Audio();
    audio.crossOrigin = 'anonymous'; // necesario para filtrar audio de otro origen (app en desarrollo)
    audio.src = url;
    audio.onended = () => this.stop();
    current = audio;
    currentUrl = url;
    currentMode = mode;
    const ctx = context();
    if (ctx) {
      try {
        await ctx.resume();
        currentSource = ctx.createMediaElementSource(audio);
        connectFilters();
      } catch {
        currentSource = null; // sin Web Audio: se escucha sin filtro
      }
    }
    notify();
    try {
      await audio.play();
    } catch {
      this.stop();
    }
  },
};
