/**
 * Trazos del dibujo del torso (viewBox 240 x 260). Vista de FRENTE: la derecha del paciente queda a la izquierda
 * de quien mira; vista de ESPALDA: la izquierda del paciente queda a la izquierda de quien mira.
 * Las referencias siguen la guía de colocación del servidor (Backend/llm_tasks.py, GUIDE):
 * costilla 2 en el ángulo del esternón (y 72), 2.º espacio intercostal y 80, 4.º y 112, 5.º y 128 (136 en la línea
 * medioclavicular), líneas medioclaviculares x 82 / 158, líneas axilares medias x 63 / 177.
 */
import { AuscultationFocus } from '../../types/vitals';

import art from './bodyArt.json';

/** Trazos del dibujo: viven en bodyArt.json para que el servidor dibuje el mismo torso en el informe PDF. */
export const VB_W: number = art.vb.w;
export const VB_H: number = art.vb.h;
export type BodyView = 'front' | 'back';

/** Silueta de busto (tipo maniquí): cuello, hombros redondeados y tronco. Simétrica. */
export const SILHOUETTE: string = art.silhouette;
/** Pliegues suaves: músculos del cuello y línea del pectoral. */
export const CONTOURS: string[] = art.contours;
/** Frente: clavículas, esternón, costillas 2-7, reborde costal, corazón con grandes vasos y pulmones con fisuras. */
export const FRONT: {
  clavicles: string[]; sternum: string[]; ribs: string[]; costalMargin: string[]; heart: string; vessels: string;
  lungs: string[]; fissures: string[];
} = art.front;
/** Espalda: escápulas con su espina, pulmones con fisuras y apófisis espinosas desde C7. */
export const BACK: { scapulae: string[]; scapulaSpines: string[]; lungs: string[]; fissures: string[]; vertebrae: number[] } = art.back;

export type LabelSide = 'above' | 'below' | 'left' | 'right';

/** Dónde va cada foco en el dibujo y a qué vista pertenece (ubicaciones según GUIDE del servidor). */
export const POINTS = art.points as Record<AuscultationFocus, { view: BodyView; x: number; y: number; label: LabelSide }>;

export type Landmark = { lines: { d: string; dashed?: boolean }[]; text: string };

const hLine = (y: number, x1: number, x2: number) => `M${x1} ${y} L${x2} ${y}`;
const vLine = (x: number, y1: number, y2: number) => `M${x} ${y1} L${x} ${y2}`;

/** Referencias anatómicas de cada foco (se resaltan al elegirlo). Texto tomado de la guía del servidor. */
export const LANDMARKS: Record<AuscultationFocus, Landmark> = {
  AV: { lines: [{ d: hLine(80, 88, 112) }, { d: vLine(113, 66, 94) }], text: '2.º espacio intercostal, junto al borde DERECHO del esternón' },
  PV: { lines: [{ d: hLine(80, 128, 152) }, { d: vLine(127, 66, 94) }], text: '2.º espacio intercostal, junto al borde IZQUIERDO del esternón' },
  TV: { lines: [{ d: vLine(126, 104, 150) }, { d: hLine(122, 120, 142) }], text: '4.º-5.º espacio intercostal, borde inferior izquierdo del esternón' },
  MV: { lines: [{ d: vLine(158, 58, 196), dashed: true }, { d: hLine(138, 124, 178) }], text: '5.º espacio intercostal en la línea medioclavicular izquierda (punta del corazón)' },
  TC: { lines: [{ d: vLine(120, 8, 50) }, { d: 'M112 52 Q120 58 128 52' }], text: 'En el cuello, sobre la tráquea, justo encima del esternón' },
  AR: { lines: [{ d: vLine(82, 56, 196), dashed: true }, { d: hLine(80, 64, 112) }], text: '2.º espacio intercostal derecho, en la línea medioclavicular' },
  AL: { lines: [{ d: vLine(158, 56, 196), dashed: true }, { d: hLine(80, 128, 176) }], text: '2.º espacio intercostal izquierdo, en la línea medioclavicular' },
  LR: { lines: [{ d: vLine(63, 104, 214), dashed: true }, { d: hLine(136, 58, 84) }], text: 'Línea axilar media derecha, a la altura del 5.º espacio intercostal' },
  LL: { lines: [{ d: vLine(177, 104, 214), dashed: true }, { d: hLine(136, 156, 182) }], text: 'Línea axilar media izquierda, a la altura del 5.º espacio intercostal' },
  PL: { lines: [{ d: hLine(108, 90, 120) }, { d: vLine(90, 92, 124) }], text: 'Entre la columna y el borde de la escápula izquierda, a media altura' },
  PR: { lines: [{ d: hLine(108, 120, 150) }, { d: vLine(150, 92, 124) }], text: 'Entre la columna y el borde de la escápula derecha, a media altura' },
};
