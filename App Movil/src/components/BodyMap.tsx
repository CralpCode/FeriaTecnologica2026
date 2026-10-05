import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { AuscultationFocus, AuscultationMode } from '../types/vitals';
import { FOCUS_INFO, FOCUS_ORDER, FocusState } from '../services/consulta';
import { color, font, radius, shadow, space, weight } from '../theme/tokens';
import { Text } from './ui/Text';
import { useReducedMotion } from './ui';
import { BACK, BodyView, CONTOURS, FRONT, LANDMARKS, POINTS, SILHOUETTE, VB_H, VB_W } from './body/bodyArt';

export type { BodyView } from './body/bodyArt';
export { LANDMARKS } from './body/bodyArt';

export const HEART_FOCI: AuscultationFocus[] = ['AV', 'PV', 'TV', 'MV'];
export const LUNG_FOCI: AuscultationFocus[] = ['TC', 'AL', 'AR', 'LL', 'LR', 'PL', 'PR'];
export const viewOf = (f: AuscultationFocus): BodyView => POINTS[f].view;

const RECORDING_SECONDS = 15;

export const STATE_STYLE: Record<FocusState, {
  bg: string; fg: string; border: string; text: string; icon?: React.ComponentProps<typeof Ionicons>['name'];
}> = {
  pendiente: { bg: '#FFFFFF', fg: color.primary, border: color.primary, text: 'pendiente' },
  normal: { bg: color.success, fg: '#FFFFFF', border: color.success, text: 'grabado, sin hallazgos', icon: 'checkmark' },
  anormal: { bg: color.danger, fg: '#FFFFFF', border: color.danger, text: 'grabado, posible sonido anormal', icon: 'alert' },
  repetir: { bg: color.warning, fg: '#FFFFFF', border: color.warning, text: 'repetir: calidad insuficiente', icon: 'refresh' },
};

export type RecordingMark = { focus: AuscultationFocus; phase: 'armed' | 'recording'; startedAt: number | null } | null;

/**
 * Dibujo anatómico del torso con los focos de auscultación.
 * Frente: la derecha del paciente queda a la izquierda de quien mira (marcas "D" e "I" en los hombros).
 */
export const BodyMap: React.FC<{
  mode: AuscultationMode;
  view: BodyView;
  states: Record<string, FocusState>;
  selected: AuscultationFocus | null;
  onSelect?: (f: AuscultationFocus) => void;
  maxWidth?: number;
  recording?: RecordingMark;
  showLandmarks?: boolean;
  /** Color del fondo donde va el dibujo (para el desvanecido de abajo). */
  background?: string;
}> = ({ mode, view, states, selected, onSelect, maxWidth = 420, recording, showLandmarks = true, background = color.surface }) => {
  const [w, setW] = useState(0);
  const h = w * (VB_H / VB_W);
  const k = w / VB_W;
  const foci = (mode === 'corazon' ? HEART_FOCI : LUNG_FOCI).filter((f) => POINTS[f].view === view);
  // En el resumen (sin guías) los puntos pueden ser más chicos para que no se encimen en mapas pequeños
  const size = Math.round(Math.max(showLandmarks ? 30 : 24, Math.min(40, w * 0.105)));
  const leftMark = view === 'front' ? 'D' : 'I';
  const rightMark = view === 'front' ? 'I' : 'D';
  const landmark = showLandmarks && selected && POINTS[selected]?.view === view ? LANDMARKS[selected] : null;
  const heart = mode === 'corazon';
  const fadeId = `fade-${mode}-${view}`;

  return (
    <View style={[styles.wrap, { maxWidth }]}>
      <View style={{ width: '100%', aspectRatio: VB_W / VB_H }}
            onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
            accessibilityLabel={`Dibujo del torso, vista de ${view === 'front' ? 'frente' : 'espalda'}. ` +
              `${view === 'front' ? 'La derecha del paciente queda a la izquierda del dibujo.' : 'La izquierda del paciente queda a la izquierda del dibujo.'}`}>
        {w > 0 && (
          <Svg width={w} height={h} viewBox={`0 0 ${VB_W} ${VB_H}`}>
            <Defs>
              <LinearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={background} stopOpacity={0} />
                <Stop offset="1" stopColor={background} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Path d={SILHOUETTE} fill={color.skin} stroke={color.skinStroke} strokeWidth={1.4} strokeLinejoin="round" />
            {CONTOURS.map((d, i) => <Path key={`c${i}`} d={d} fill="none" stroke={color.skinStroke} strokeWidth={1} opacity={0.6} />)}
            {view === 'front' ? (
              <G>
                {!heart && FRONT.lungs.map((d, i) => <Path key={`l${i}`} d={d} fill={color.lungFill} stroke={color.lungStroke} strokeWidth={1.1} />)}
                {!heart && FRONT.fissures.map((d, i) => <Path key={`f${i}`} d={d} fill="none" stroke={color.lungStroke} strokeWidth={1} strokeDasharray="3 3" />)}
                {FRONT.ribs.map((d, i) => <Path key={`r${i}`} d={d} fill="none" stroke={color.bone} strokeWidth={1.2} strokeLinecap="round" />)}
                {FRONT.costalMargin.map((d, i) => <Path key={`m${i}`} d={d} fill="none" stroke={color.bone} strokeWidth={1.4} />)}
                {heart && <Path d={FRONT.heart} fill={color.heartFill} stroke={color.heartStroke} strokeWidth={1.2} />}
                {heart && <Path d={FRONT.vessels} fill="none" stroke={color.heartStroke} strokeWidth={1.2} opacity={0.7} />}
                {FRONT.sternum.map((d, i) => <Path key={`s${i}`} d={d} fill="#E9EDF2" stroke={color.skinStroke} strokeWidth={1} />)}
                {FRONT.clavicles.map((d, i) => <Path key={`k${i}`} d={d} fill="none" stroke={color.skinStroke} strokeWidth={2.2} strokeLinecap="round" />)}
              </G>
            ) : (
              <G>
                {!heart && BACK.lungs.map((d, i) => <Path key={`l${i}`} d={d} fill={color.lungFill} stroke={color.lungStroke} strokeWidth={1.1} />)}
                {!heart && BACK.fissures.map((d, i) => <Path key={`f${i}`} d={d} fill="none" stroke={color.lungStroke} strokeWidth={1} strokeDasharray="3 3" />)}
                {BACK.scapulae.map((d, i) => <Path key={`e${i}`} d={d} fill="#E9EDF2" stroke={color.skinStroke} strokeWidth={1.1} />)}
                {BACK.scapulaSpines.map((d, i) => <Path key={`p${i}`} d={d} fill="none" stroke={color.skinStroke} strokeWidth={1.6} strokeLinecap="round" />)}
                {BACK.vertebrae.map((y) => <Rect key={`v${y}`} x={117.5} y={y - 2.5} width={5} height={5} rx={1.8} fill="#E2E7EE" stroke={color.skinStroke} strokeWidth={0.7} />)}
              </G>
            )}
            {landmark?.lines.map((l, i) => (
              <Path key={`g${i}`} d={l.d} fill="none" stroke={color.primary} strokeWidth={1.8} strokeLinecap="round" opacity={0.85}
                    strokeDasharray={l.dashed ? '4 3' : undefined} />
            ))}
            <Rect x={0} y={VB_H - 46} width={VB_W} height={46} fill={`url(#${fadeId})`} />
          </Svg>
        )}

        {w > 0 && (
          <>
            <SideMark letter={leftMark} x={26 * k} y={40 * k} label={leftMark === 'D' ? 'Derecha del paciente' : 'Izquierda del paciente'} />
            <SideMark letter={rightMark} x={214 * k} y={40 * k} label={rightMark === 'D' ? 'Derecha del paciente' : 'Izquierda del paciente'} />
          </>
        )}

        {w > 0 && foci.map((f) => (
          <FocusPoint
            key={f}
            focus={f}
            x={POINTS[f].x * k}
            y={POINTS[f].y * k}
            size={size}
            state={states[f] || 'pendiente'}
            selected={selected === f}
            order={heart && showLandmarks ? FOCUS_ORDER.corazon.indexOf(f) + 1 : null}
            recording={recording && recording.focus === f ? recording : null}
            onPress={onSelect ? () => onSelect(f) : undefined}
            labelSide={POINTS[f].label}
          />
        ))}
      </View>
    </View>
  );
};

const SideMark: React.FC<{ letter: string; label: string; x: number; y: number }> = ({ letter, label, x, y }) => (
  <View style={[styles.side, { left: x - 13, top: y - 13 }]} accessibilityLabel={label}>
    <Text style={styles.sideText}>{letter}</Text>
  </View>
);

/** Un foco: estado con color e ícono, halo si está elegido y anillo de 15 s mientras graba. */
const FocusPoint: React.FC<{
  focus: AuscultationFocus; x: number; y: number; size: number; state: FocusState; selected: boolean;
  order: number | null; recording: RecordingMark; onPress?: () => void; labelSide: 'above' | 'below' | 'left' | 'right';
}> = ({ focus, x, y, size, state, selected, order, recording, onPress, labelSide }) => {
  const st = STATE_STYLE[state];
  const reduced = useReducedMotion();
  const halo = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const prevState = useRef(state);

  useEffect(() => {
    if (!selected || reduced) { halo.setValue(0); return; }
    const loop = Animated.loop(Animated.timing(halo, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [selected, reduced, halo]);

  // Al llegar un resultado, el punto "salta" una vez
  useEffect(() => {
    if (prevState.current !== state && state !== 'pendiente' && !reduced) {
      pop.setValue(0.6);
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: false }).start();
    }
    prevState.current = state;
  }, [state, reduced, pop]);

  const ring = size + 14;
  const labelW = 120;
  const labelPos = labelSide === 'below' ? { left: x - labelW / 2, top: y + size / 2 + 6, alignItems: 'center' as const }
    : labelSide === 'above' ? { left: x - labelW / 2, top: y - size / 2 - 30, alignItems: 'center' as const }
    : labelSide === 'left' ? { left: x - size / 2 - 8 - labelW, top: y - 12, alignItems: 'flex-end' as const }
    : { left: x + size / 2 + 8, top: y - 12, alignItems: 'flex-start' as const };

  return (
    <>
      {selected && !reduced && (
        <Animated.View pointerEvents="none" style={[styles.halo, {
          width: size, height: size, borderRadius: size / 2, left: x - size / 2, top: y - size / 2,
          opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
          transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
        }]} />
      )}
      {recording && (
        <View pointerEvents="none" style={{ position: 'absolute', left: x - ring / 2, top: y - ring / 2, width: ring, height: ring }}>
          {recording.phase === 'recording'
            ? <RecordingRing size={ring} startedAt={recording.startedAt} />
            : <View style={[styles.armedRing, { width: ring, height: ring, borderRadius: ring / 2 }]} />}
        </View>
      )}
      <Animated.View style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, transform: [{ scale: pop }] }}>
        <Pressable
          onPress={onPress}
          disabled={!onPress}
          accessibilityRole={onPress ? 'button' : 'image'}
          accessibilityState={{ selected }}
          accessibilityLabel={`${FOCUS_INFO[focus].long}: ${st.text}`}
          style={(s: any) => [styles.point, {
            width: size, height: size, borderRadius: size / 2, backgroundColor: st.bg, borderColor: st.border,
          }, selected && styles.pointSelected, s.hovered && onPress && !selected && { transform: [{ scale: 1.08 }] }]}
        >
          <Text style={[styles.pointText, { color: st.fg, fontSize: size < 34 ? 11 : 12 }]}>{focus}</Text>
        </Pressable>
        {st.icon && (
          <View pointerEvents="none" style={[styles.badge, { backgroundColor: '#FFFFFF', borderColor: st.border }]}>
            <Ionicons name={st.icon} size={10} color={st.border} />
          </View>
        )}
        {order !== null && state === 'pendiente' && !selected && (
          <View pointerEvents="none" style={styles.order}><Text style={styles.orderText}>{order}</Text></View>
        )}
      </Animated.View>
      {selected && onPress && (
        <View pointerEvents="none" style={[styles.labelBox, { width: labelW }, labelPos]}>
          <Text style={styles.label} numberOfLines={1}>{FOCUS_INFO[focus].short}</Text>
        </View>
      )}
    </>
  );
};

/** Anillo que se llena durante los 15 s reales de la grabación (desde la hora en que empezó). */
const RecordingRing: React.FC<{ size: number; startedAt: number | null }> = ({ size, startedAt }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t); }, []);
  const frac = startedAt ? Math.min(1, (now - startedAt) / 1000 / RECORDING_SECONDS) : 0;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={color.dangerSoft} strokeWidth={stroke} fill="none" />
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={frac >= 1 ? color.ai : color.danger} strokeWidth={stroke} fill="none"
              strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - frac)}
              transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </Svg>
  );
};

/** Fichas de los focos con su estado, debajo del dibujo (atajo táctil y para lectores de pantalla). */
export const FocusChips: React.FC<{
  foci: AuscultationFocus[]; states: Record<string, FocusState>; selected: AuscultationFocus | null;
  onSelect: (f: AuscultationFocus) => void;
}> = ({ foci, states, selected, onSelect }) => (
  <View style={styles.chips}>
    {foci.map((f) => {
      const st = STATE_STYLE[states[f] || 'pendiente'];
      const active = selected === f;
      const done = (states[f] || 'pendiente') !== 'pendiente';
      return (
        <Pressable key={f} onPress={() => onSelect(f)} accessibilityRole="button" accessibilityState={{ selected: active }}
                   accessibilityLabel={`${FOCUS_INFO[f].long}: ${st.text}`}
                   style={(s: any) => [styles.chip, s.hovered && !active && { backgroundColor: color.surfaceMuted },
                     active && { borderColor: color.primary, backgroundColor: color.primarySoft }]}>
          <View style={[styles.chipDot, { backgroundColor: done ? st.bg : '#FFFFFF', borderColor: st.border }]}>
            {st.icon && <Ionicons name={st.icon} size={9} color="#FFFFFF" />}
          </View>
          <Text style={[styles.chipCode, active && { color: color.primary }]}>{f}</Text>
          <Text style={styles.chipName} numberOfLines={1}>{FOCUS_INFO[f].short}</Text>
        </Pressable>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  wrap: { width: '100%', alignSelf: 'center' },
  side: {
    position: 'absolute', width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, ...shadow.sm,
  },
  sideText: { fontSize: font.xs, fontWeight: weight.heavy, color: color.textSecondary },
  halo: { position: 'absolute', backgroundColor: color.primary },
  armedRing: { borderWidth: 2, borderStyle: 'dashed', borderColor: color.primary },
  point: {
    borderWidth: 2, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' as any, ...shadow.sm,
  },
  pointSelected: { borderWidth: 3, boxShadow: `0px 0px 0px 3px ${color.surface}, 0px 0px 0px 5px ${color.primary}` },
  pointText: { fontWeight: weight.heavy, letterSpacing: 0.2 },
  badge: {
    position: 'absolute', right: -4, top: -4, width: 16, height: 16, borderRadius: 8, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  order: {
    position: 'absolute', right: -7, top: -7, width: 18, height: 18, borderRadius: 9, backgroundColor: color.primary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#FFFFFF',
  },
  orderText: { fontSize: 12, lineHeight: 14, color: '#FFFFFF', fontWeight: weight.heavy },
  labelBox: { position: 'absolute' },
  label: {
    fontSize: font.xs, fontWeight: weight.bold, color: '#FFFFFF', backgroundColor: color.text, overflow: 'hidden',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 10, borderRadius: radius.pill,
    borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, cursor: 'pointer' as any,
  },
  chipDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  chipCode: { fontSize: font.xs, fontWeight: weight.heavy, color: color.text },
  chipName: { fontSize: font.xs, color: color.textSecondary, maxWidth: 110 },
});
