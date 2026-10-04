import { AuscultationFocus, AuscultationMode, RecordingResult } from '../types/vitals';

/** Orden sugerido de la consulta. Pulmón: primero izquierda/derecha anteriores y posteriores. */
export const FOCUS_ORDER: Record<AuscultationMode, AuscultationFocus[]> = {
  corazon: ['AV', 'PV', 'TV', 'MV'],
  pulmon: ['AL', 'AR', 'PL', 'PR', 'TC', 'LL', 'LR'],
};

export type FocusState = 'normal' | 'anormal' | 'repetir' | 'pendiente';

// La valoración del servidor usa la última grabación de cada foco de los últimos 30 minutos
// (Backend/clinical_assessment.py, recent_recordings); aquí se aplica la misma regla.
const WINDOW_MS = 30 * 60 * 1000;

const modeOf = (r: RecordingResult): AuscultationMode => (r.mode === 'pulmon' ? 'pulmon' : 'corazon');

/** Estado de cada foco del modo según sus grabaciones (las más recientes primero). */
export function focusStates(recordings: (RecordingResult | null | undefined)[], mode: AuscultationMode,
                            now = Date.now()): Record<string, FocusState> {
  const out: Record<string, FocusState> = {};
  const seen = new Set<string>();
  for (const r of recordings) {
    if (!r || seen.has(r.recording_id) || modeOf(r) !== mode || !r.location) continue;
    if (r.recording_id.startsWith('demo_') || (r.details as any)?.demo) continue; // demo ICBHI: no es del paciente
    seen.add(r.recording_id);
    if (out[r.location]) continue; // ya hay una más reciente para ese foco
    const t = r.created_at ? Date.parse(r.created_at) : now;
    if (Number.isFinite(t) && now - t > WINDOW_MS) continue;
    out[r.location] = r.result === 'normal' || r.result === 'anormal' ? r.result : 'repetir';
  }
  for (const f of FOCUS_ORDER[mode]) out[f] = out[f] || 'pendiente';
  return out;
}

/** Siguiente foco a grabar: el primero pendiente o por repetir, en el orden sugerido. */
export function nextFocus(mode: AuscultationMode, states: Record<string, FocusState>): AuscultationFocus | null {
  return FOCUS_ORDER[mode].find((f) => states[f] === 'repetir' || states[f] === 'pendiente') || null;
}

/** Focos con resultado válido (normal o anormal). */
export function doneCount(mode: AuscultationMode, states: Record<string, FocusState>, only?: AuscultationFocus[]) {
  return (only || FOCUS_ORDER[mode]).filter((f) => states[f] === 'normal' || states[f] === 'anormal').length;
}

/** Nombre corto y largo de cada foco o zona (corazón: focos clásicos; pulmón: zonas de ICBHI). */
export const FOCUS_INFO: Record<AuscultationFocus, { short: string; long: string }> = {
  AV: { short: 'Aórtico', long: 'Foco aórtico' },
  PV: { short: 'Pulmonar', long: 'Foco pulmonar' },
  TV: { short: 'Tricuspídeo', long: 'Foco tricuspídeo' },
  MV: { short: 'Mitral', long: 'Foco mitral' },
  TC: { short: 'Tráquea', long: 'Tráquea' },
  AL: { short: 'Ant. izq.', long: 'Tórax anterior izquierdo' },
  AR: { short: 'Ant. der.', long: 'Tórax anterior derecho' },
  PL: { short: 'Espalda izq.', long: 'Espalda izquierda' },
  PR: { short: 'Espalda der.', long: 'Espalda derecha' },
  LL: { short: 'Costado izq.', long: 'Costado izquierdo' },
  LR: { short: 'Costado der.', long: 'Costado derecho' },
};

export const focusName = (id?: string | null) =>
  (id && FOCUS_INFO[id as AuscultationFocus]?.long) || 'Sin foco';

/**
 * Las sesiones que la app crea sola al abrirse (pc_xxxxx, movil_xxxxx, apk_xxxxx) no tienen un paciente
 * identificado; las de "Nuevo paciente" llevan el código que escribió el médico.
 */
export const isNamedPatient = (sessionId: string) => !/^(pc|movil|apk|sess)_[a-z0-9]{5}$/.test(sessionId);

/** Código legible del paciente: "p017_ab12c" -> "P017". */
export const patientLabel = (sessionId: string) =>
  isNamedPatient(sessionId) ? sessionId.replace(/_[a-z0-9]{5}$/, '').toUpperCase() : 'Sin identificar';
