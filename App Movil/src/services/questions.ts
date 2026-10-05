import { PatientContext } from '../types/vitals';

type SymptomKey = keyof PatientContext['symptoms'];
type HistoryKey = keyof PatientContext['history'];

/** Síntomas de alarma: si alguno es "Sí", la valoración es urgente (Backend/clinical_assessment.py). */
export const ALARM_SYMPTOMS: [SymptomKey, string][] = [
  ['severe_breathlessness', 'Falta de aire intensa o dificultad para hablar'],
  ['chest_pain', 'Dolor en el pecho'],
  ['syncope', 'Desmayo'],
  ['cyanosis', 'Labios o cara azulados'],
  ['confusion', 'Confusión nueva'],
];

export const OTHER_SYMPTOMS: [SymptomKey, string][] = [
  ['dyspnea', 'Falta de aire'],
  ['cough', 'Tos'],
  ['fever', 'Fiebre'],
  ['wheeze', 'Silbidos al respirar'],
  ['orthopnea', 'Falta de aire al acostarse'],
  ['edema', 'Hinchazón de piernas o tobillos'],
];

export const HISTORY: [HistoryKey, string][] = [
  ['asthma', 'Asma diagnosticada'],
  ['copd', 'EPOC diagnosticada'],
  ['smoking', 'Tabaquismo actual o previo'],
];

/** Total de preguntas: edad, reposo, altitud + 11 síntomas + 3 antecedentes. */
export const TOTAL_QUESTIONS = 3 + ALARM_SYMPTOMS.length + OTHER_SYMPTOMS.length + HISTORY.length;

export const emptyContext = (): PatientContext => ({
  age_years: null,
  at_rest: null,
  altitude_m: null,
  symptoms: Object.fromEntries([...ALARM_SYMPTOMS, ...OTHER_SYMPTOMS].map(([k]) => [k, null])) as PatientContext['symptoms'],
  history: Object.fromEntries(HISTORY.map(([k]) => [k, null])) as PatientContext['history'],
  notes: null,
});

/** Une lo guardado en el servidor con la plantilla vacía (lo no contestado queda como desconocido). */
export const mergeContext = (saved: Partial<PatientContext> | null | undefined): PatientContext => {
  const blank = emptyContext();
  return {
    ...blank,
    ...(saved || {}),
    symptoms: { ...blank.symptoms, ...(saved?.symptoms || {}) },
    history: { ...blank.history, ...(saved?.history || {}) },
  };
};

export const answeredCount = (c: PatientContext): number =>
  [c.age_years, c.at_rest, c.altitude_m].filter((v) => v !== null && v !== undefined).length
  + Object.values(c.symptoms).filter((v) => v !== null).length
  + Object.values(c.history).filter((v) => v !== null).length;

export const hasAlarm = (c: PatientContext): boolean => ALARM_SYMPTOMS.some(([k]) => c.symptoms[k] === true);
