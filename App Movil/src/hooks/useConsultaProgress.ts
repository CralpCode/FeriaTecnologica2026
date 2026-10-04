import { useCallback, useEffect, useMemo, useState } from 'react';
import { useVitals } from '../context/VitalsContext';
import { useClinical } from '../context/ClinicalContext';
import { apiService } from '../services/api';
import { doneCount, focusStates, FOCUS_ORDER, isNamedPatient, patientLabel } from '../services/consulta';
import { answeredCount, mergeContext, TOTAL_QUESTIONS } from '../services/questions';
import { PatientContext } from '../types/vitals';
import type { StepState } from '../components/ui';

export const CONSULTA_STEPS = ['paciente', 'datos', 'pulso', 'corazon', 'pulmon', 'resultado'] as const;
export type ConsultaStepKey = typeof CONSULTA_STEPS[number];

const LEVEL_TEXT: Record<string, string> = { rojo: 'Rojo', amarillo: 'Amarillo', verde: 'Verde', gris: 'Sin datos' };

/** Avance de la consulta del paciente actual, con los datos que ya existen en la app y el servidor. */
export function useConsultaProgress() {
  const { currentSessionId } = useVitals();
  const { recordings, lastResult, triage } = useClinical();
  const [context, setContext] = useState<PatientContext | null>(null);

  const reloadContext = useCallback(() => {
    apiService.getPatientContext(currentSessionId)
      .then((c) => setContext(mergeContext(c)))
      .catch(() => setContext(null));
  }, [currentSessionId]);
  useEffect(() => { setContext(null); reloadContext(); }, [reloadContext]);

  return useMemo(() => {
    const all = [lastResult, ...recordings];
    const heart = focusStates(all, 'corazon');
    const lung = focusStates(all, 'pulmon');
    const heartDone = doneCount('corazon', heart);
    const lungDone = doneCount('pulmon', lung);
    const heartRetry = FOCUS_ORDER.corazon.some((f) => heart[f] === 'repetir');
    const lungRetry = FOCUS_ORDER.pulmon.some((f) => lung[f] === 'repetir');
    const answered = context ? answeredCount(context) : 0;
    const pulse = triage?.datos_usados?.vitales_ultimo_minuto?.fc ?? null;
    const named = isNamedPatient(currentSessionId);

    const steps: { key: ConsultaStepKey; label: string; state: StepState; detail: string }[] = [
      { key: 'paciente', label: 'Paciente', state: named ? 'done' : 'pending', detail: patientLabel(currentSessionId) },
      { key: 'datos', label: 'Datos y síntomas', state: answered > 0 ? 'done' : 'pending', detail: `${answered}/${TOTAL_QUESTIONS} contestadas` },
      { key: 'pulso', label: 'Pulso', state: pulse !== null ? 'done' : 'pending', detail: pulse !== null ? `${pulse} BPM` : 'Sin lectura válida' },
      { key: 'corazon', label: 'Corazón', state: heartDone === 4 ? 'done' : heartRetry ? 'warn' : 'pending', detail: `${heartDone}/4 focos` },
      { key: 'pulmon', label: 'Pulmón', state: lungRetry ? 'warn' : lungDone >= 1 ? 'done' : 'pending', detail: `${lungDone} ${lungDone === 1 ? 'zona' : 'zonas'}` },
      { key: 'resultado', label: 'Resultado', state: 'pending', detail: LEVEL_TEXT[triage?.nivel || 'gris'] },
    ];
    const completed = steps.slice(0, 5).filter((s) => s.state === 'done').length;
    return { steps, completed, context, reloadContext, heart, lung, heartDone, lungDone, answered, pulse, named };
  }, [currentSessionId, recordings, lastResult, triage, context, reloadContext]);
}
