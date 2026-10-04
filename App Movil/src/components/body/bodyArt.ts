/**
 * Trazos del dibujo del torso (viewBox 240 x 300). Vista de FRENTE: la derecha del paciente queda a la izquierda
 * de quien mira; vista de ESPALDA: la izquierda del paciente queda a la izquierda de quien mira.
 * Las referencias siguen la guía de colocación del servidor (Backend/llm_tasks.py, GUIDE):
 * costilla 2 en el ángulo del esternón (y 72), 2.º espacio intercostal y 80, 4.º y 112, 5.º y 128 (136 en la línea
 * medioclavicular), líneas medioclaviculares x 82 / 158, líneas axilares medias x 63 / 177.
 */
import { AuscultationFocus } from '../../types/vitals';

export const VB_W = 240;
export const VB_H = 260;
export type BodyView = 'front' | 'back';

/** Silueta de busto (tipo maniquí): cuello, hombros redondeados y tronco. Simétrica. */
export const SILHOUETTE =
  'M66 262 C62 212 56 160 52 128 C42 124 32 112 31 92 C31 76 38 64 50 58 C66 50 90 46 100 42 ' +
  'C103 30 104 16 104 0 L136 0 C136 16 137 30 140 42 C150 46 174 50 190 58 C202 64 209 76 209 92 ' +
  'C208 112 198 124 188 128 C184 160 178 212 174 262 Z';

/** Pliegues suaves: músculos del cuello y línea del pectoral. */
export const CONTOURS = [
  'M104 22 C110 26 114 34 116 44',
  'M136 22 C130 26 126 34 124 44',
  'M52 128 C60 120 66 112 70 100',
  'M188 128 C180 120 174 112 170 100',
];

export const FRONT = {
  clavicles: [
    'M113 52 C99 50 88 56 76 56 C67 56 59 57 51 61',
    'M127 52 C141 50 152 56 164 56 C173 56 181 57 189 61',
  ],
  /** Esternón: manubrio, cuerpo y apéndice xifoides. */
  sternum: ['M112 52 L128 52 L126 72 L114 72 Z', 'M114 72 L126 72 L124 150 L116 150 Z', 'M116 150 L124 150 L120 162 Z'],
  /** Costillas 2 a 7 desde el borde del esternón (tenues). */
  ribs: [72, 88, 104, 120, 136, 150].flatMap((y) => [
    `M114 ${y} C96 ${y - 2} 78 ${y + 4} 64 ${y + 20}`,
    `M126 ${y} C144 ${y - 2} 162 ${y + 4} 176 ${y + 20}`,
  ]),
  costalMargin: ['M118 160 C104 172 86 194 70 214', 'M122 160 C136 172 154 194 170 214'],
  heart: 'M112 90 C104 98 101 118 107 134 C115 150 140 153 159 142 C166 138 162 126 153 116 C143 101 133 92 125 88 C119 85 114 86 112 90 Z',
  /** Grandes vasos (sutil) sobre el corazón. */
  vessels: 'M114 90 C114 80 118 74 124 74 C130 74 133 80 132 88',
  lungs: [
    'M98 44 C84 46 70 70 64 110 C60 140 62 170 66 196 C80 190 98 186 112 182 L112 60 C110 50 104 44 98 44 Z',
    'M142 44 C156 46 170 70 176 110 C180 140 178 170 174 196 C160 190 142 186 130 184 C134 170 140 158 142 146 ' +
      'C134 140 128 130 128 120 L128 60 C130 50 136 44 142 44 Z',
  ],
  /** Fisuras: horizontal y oblicua del pulmón derecho; oblicua del izquierdo. */
  fissures: ['M112 104 C96 104 80 106 65 108', 'M64 126 C80 146 94 166 106 184', 'M176 116 C160 140 146 164 136 184'],
};

export const BACK = {
  /** Escápulas: borde interno casi vertical, ángulo inferior y espina hacia el hombro. */
  scapulae: [
    'M98 70 C86 69 72 72 62 78 C59 82 59 87 62 91 C68 111 78 132 90 148 C95 124 98 96 98 70 Z',
    'M142 70 C154 69 168 72 178 78 C181 82 181 87 178 91 C172 111 162 132 150 148 C145 124 142 96 142 70 Z',
  ],
  scapulaSpines: ['M97 84 C84 82 70 80 56 80', 'M143 84 C156 82 170 80 184 80'],
  lungs: [
    'M104 52 C88 54 72 80 66 120 C62 160 66 200 72 232 C86 226 100 222 114 220 L114 64 C112 56 108 52 104 52 Z',
    'M136 52 C152 54 168 80 174 120 C178 160 174 200 168 232 C154 226 140 222 126 220 L126 64 C128 56 132 52 136 52 Z',
  ],
  fissures: ['M112 82 C98 110 84 140 70 172', 'M128 82 C142 110 156 140 170 172'],
  /** Apófisis espinosas de C7 hacia abajo. */
  vertebrae: Array.from({ length: 18 }, (_, i) => 44 + i * 12),
};

export type LabelSide = 'above' | 'below' | 'left' | 'right';

/** Dónde va cada foco en el dibujo y a qué vista pertenece. */
export const POINTS: Record<AuscultationFocus, { view: BodyView; x: number; y: number; label: LabelSide }> = {
  AV: { view: 'front', x: 106, y: 80, label: 'left' },   // 2.º espacio intercostal, borde derecho del esternón
  PV: { view: 'front', x: 134, y: 80, label: 'right' },  // 2.º espacio intercostal, borde izquierdo del esternón
  TV: { view: 'front', x: 131, y: 122, label: 'left' },  // borde inferior izquierdo del esternón (4.º-5.º espacio)
  MV: { view: 'front', x: 158, y: 138, label: 'below' }, // 5.º espacio intercostal, línea medioclavicular izquierda
  TC: { view: 'front', x: 120, y: 26, label: 'right' },  // tráquea, arriba del esternón
  AR: { view: 'front', x: 82, y: 80, label: 'below' },   // 2.º espacio intercostal, línea medioclavicular derecha
  AL: { view: 'front', x: 158, y: 80, label: 'below' },  // 2.º espacio intercostal, línea medioclavicular izquierda
  LR: { view: 'front', x: 63, y: 136, label: 'below' },  // línea axilar media derecha, 5.º espacio intercostal
  LL: { view: 'front', x: 177, y: 136, label: 'below' }, // línea axilar media izquierda, 5.º espacio intercostal
  PL: { view: 'back', x: 105, y: 108, label: 'below' },  // entre la columna y el borde de la escápula izquierda
  PR: { view: 'back', x: 135, y: 108, label: 'below' },  // entre la columna y el borde de la escápula derecha
};

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
