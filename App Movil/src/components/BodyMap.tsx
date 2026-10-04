import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { AuscultationFocus, AuscultationMode } from '../types/vitals';
import { FOCUS_INFO, FocusState } from '../services/consulta';
import { color, font, weight } from '../theme/tokens';

export type BodyView = 'front' | 'back';

const VB_W = 200;
const VB_H = 260;

/**
 * Posición de cada foco en el dibujo (coordenadas del viewBox 200 x 260).
 * Vista de FRENTE: la derecha del paciente queda a la izquierda de quien mira.
 * Vista de ESPALDA: la izquierda del paciente queda a la izquierda de quien mira.
 * Ubicaciones según la guía de colocación del servidor (Backend/llm_tasks.py, GUIDE).
 */
const POINTS: Record<AuscultationFocus, { view: BodyView; x: number; y: number }> = {
  AV: { view: 'front', x: 84, y: 78 },   // 2.º espacio intercostal, borde derecho del esternón
  PV: { view: 'front', x: 116, y: 78 },  // 2.º espacio intercostal, borde izquierdo del esternón
  TV: { view: 'front', x: 105, y: 122 }, // borde inferior izquierdo del esternón
  MV: { view: 'front', x: 137, y: 140 }, // 5.º espacio intercostal, línea medioclavicular izquierda
  TC: { view: 'front', x: 100, y: 30 },  // tráquea, sobre el esternón
  AR: { view: 'front', x: 68, y: 82 },   // anterior derecho, línea medioclavicular
  AL: { view: 'front', x: 132, y: 82 },  // anterior izquierdo
  LR: { view: 'front', x: 42, y: 132 },  // costado derecho, línea axilar media
  LL: { view: 'front', x: 158, y: 132 }, // costado izquierdo
  PL: { view: 'back', x: 78, y: 112 },   // espalda izquierda, entre columna y escápula
  PR: { view: 'back', x: 122, y: 112 },  // espalda derecha
};

export const HEART_FOCI: AuscultationFocus[] = ['AV', 'PV', 'TV', 'MV'];
export const LUNG_FOCI: AuscultationFocus[] = ['TC', 'AL', 'AR', 'LL', 'LR', 'PL', 'PR'];
export const viewOf = (f: AuscultationFocus): BodyView => POINTS[f].view;

const STATE_STYLE: Record<FocusState, { bg: string; fg: string; border: string; text: string }> = {
  pendiente: { bg: '#FFFFFF', fg: color.primary, border: color.primary, text: 'pendiente' },
  normal: { bg: color.success, fg: '#FFFFFF', border: color.success, text: 'grabado, sin hallazgos' },
  anormal: { bg: color.danger, fg: '#FFFFFF', border: color.danger, text: 'grabado, posible sonido anormal' },
  repetir: { bg: color.warning, fg: '#FFFFFF', border: color.warning, text: 'repetir: calidad insuficiente' },
};

const TORSO = 'M86 16 L86 40 Q60 44 36 60 Q27 66 29 82 L37 132 Q41 190 52 240 L148 240 Q159 190 163 132 L171 82 Q173 66 164 60 Q140 44 114 40 L114 16';

export const BodyMap: React.FC<{
  mode: AuscultationMode;
  view: BodyView;
  states: Record<string, FocusState>;
  selected: AuscultationFocus | null;
  onSelect: (f: AuscultationFocus) => void;
  maxWidth?: number;
}> = ({ mode, view, states, selected, onSelect, maxWidth = 300 }) => {
  const [w, setW] = useState(0);
  const h = w * (VB_H / VB_W);
  const foci = (mode === 'corazon' ? HEART_FOCI : LUNG_FOCI).filter((f) => POINTS[f].view === view);
  const size = Math.max(32, Math.min(40, w * 0.12)); // sin encimarse a 300 px de ancho
  const leftSide = view === 'front' ? 'Derecha del paciente' : 'Izquierda del paciente';
  const rightSide = view === 'front' ? 'Izquierda del paciente' : 'Derecha del paciente';

  return (
    <View style={[styles.wrap, { maxWidth }]}>
      <View style={styles.sides}>
        <Text style={styles.side}>◀ {leftSide}</Text>
        <Text style={styles.side}>{rightSide} ▶</Text>
      </View>
      <View style={{ width: '100%', height: h || undefined, aspectRatio: VB_W / VB_H }}
            onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
            accessibilityLabel={`Dibujo del torso, vista de ${view === 'front' ? 'frente' : 'espalda'}`}>
        {w > 0 && (
          <Svg width={w} height={h} viewBox={`0 0 ${VB_W} ${VB_H}`}>
            <Path d={TORSO} fill={color.surfaceMuted} stroke={color.borderStrong} strokeWidth={1.5} />
            {view === 'front' ? (
              <>
                <Line x1={100} y1={52} x2={100} y2={150} stroke={color.borderStrong} strokeWidth={1.2} />
                <Path d="M100 50 Q80 47 56 57" fill="none" stroke={color.borderStrong} strokeWidth={1.2} />
                <Path d="M100 50 Q120 47 144 57" fill="none" stroke={color.borderStrong} strokeWidth={1.2} />
                <Path d="M100 150 Q80 166 58 178" fill="none" stroke={color.border} strokeWidth={1.2} />
                <Path d="M100 150 Q120 166 142 178" fill="none" stroke={color.border} strokeWidth={1.2} />
              </>
            ) : (
              <>
                <Line x1={100} y1={40} x2={100} y2={236} stroke={color.borderStrong} strokeWidth={1.2} strokeDasharray="4 4" />
                <Path d="M58 72 Q54 108 70 142 Q86 122 88 78 Z" fill="none" stroke={color.borderStrong} strokeWidth={1.2} />
                <Path d="M142 72 Q146 108 130 142 Q114 122 112 78 Z" fill="none" stroke={color.borderStrong} strokeWidth={1.2} />
              </>
            )}
          </Svg>
        )}
        {w > 0 && foci.map((f) => {
          const p = POINTS[f];
          const st = STATE_STYLE[states[f] || 'pendiente'];
          const active = selected === f;
          return (
            <TouchableOpacity
              key={f}
              onPress={() => onSelect(f)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${FOCUS_INFO[f].long}: ${st.text}`}
              style={[styles.point, {
                width: size, height: size, borderRadius: size / 2,
                left: (p.x / VB_W) * w - size / 2, top: (p.y / VB_H) * h - size / 2,
                backgroundColor: st.bg, borderColor: st.border,
              }, active && styles.pointActive]}
            >
              <Text style={[styles.pointText, { color: st.fg }]}>{f}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { width: '100%', alignSelf: 'center' },
  sides: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  side: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.medium },
  point: {
    position: 'absolute', borderWidth: 2, alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },
  pointActive: {
    borderWidth: 4, borderColor: color.text,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  pointText: { fontSize: font.xs, fontWeight: weight.heavy },
});
