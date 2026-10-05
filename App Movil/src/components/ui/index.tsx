/**
 * Componentes base de la interfaz (estilo clínico claro y sobrio). Úsalos en lugar de estilos sueltos.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleProp,
  StyleSheet,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Text } from './Text';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { color, font, radius, shadow, space, tabular, toneColors, touch, Tone, weight } from '../../theme/tokens';

export { Text } from './Text';
type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------------------------------------
/** true si la persona pidió "reducir movimiento" en su sistema. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => alive && setReduced(!!v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduced(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduced;
}

/** Aparece con un fundido y un desplazamiento corto (cambia cada vez que cambia `trigger`). */
export const FadeIn: React.FC<{ trigger?: unknown; children: React.ReactNode; style?: StyleProp<ViewStyle>; distance?: number }> = ({
  trigger, children, style, distance = 8,
}) => {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { v.setValue(1); return; }
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [trigger, reduced, v]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
};

// ---------------------------------------------------------------------------------------------
export const Button: React.FC<{
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai';
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}> = ({ label, onPress, variant = 'primary', icon, iconRight, loading, disabled, size = 'md', full, style, accessibilityLabel }) => {
  const v = BUTTON[variant];
  const inactive = disabled || loading;
  const iconSize = size === 'lg' ? 20 : size === 'sm' ? 16 : 18;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={(state: any) => [
        styles.button, size === 'lg' && styles.buttonLg, size === 'sm' && styles.buttonSm, v.box,
        state.hovered && !inactive && v.hover, full && { alignSelf: 'stretch' },
        state.pressed && !inactive && { transform: [{ scale: 0.98 }] },
        inactive && { opacity: 0.5 }, style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} size="small" />
        : icon ? <Ionicons name={icon} size={iconSize} color={v.fg} /> : null}
      <Text style={[styles.buttonText, size === 'lg' && { fontSize: font.md }, size === 'sm' && { fontSize: font.xs }, { color: v.fg }]}
            numberOfLines={1}>{label}</Text>
      {iconRight && !loading && <Ionicons name={iconRight} size={iconSize} color={v.fg} />}
    </Pressable>
  );
};

/** Botón cuadrado solo con ícono (siempre con etiqueta para lectores de pantalla). */
export const IconButton: React.FC<{
  icon: IconName; onPress: () => void; accessibilityLabel: string; size?: number; tint?: string; style?: StyleProp<ViewStyle>;
}> = ({ icon, onPress, accessibilityLabel, size = 44, tint = color.text, style }) => (
  <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
             style={(state: any) => [styles.iconButton, { width: size, height: size }, state.hovered && { backgroundColor: color.surfaceMuted },
               state.pressed && { transform: [{ scale: 0.96 }] }, style]}>
    <Ionicons name={icon} size={20} color={tint} />
  </Pressable>
);

const BUTTON: Record<string, { box: ViewStyle; hover: ViewStyle; fg: string }> = {
  primary: {
    box: { backgroundColor: color.primary, borderColor: color.primary, ...shadow.sm },
    hover: { backgroundColor: color.primaryHover, borderColor: color.primaryHover }, fg: color.textOnPrimary,
  },
  secondary: {
    box: { backgroundColor: color.surface, borderColor: color.borderStrong },
    hover: { backgroundColor: color.surfaceMuted }, fg: color.text,
  },
  ghost: { box: { backgroundColor: 'transparent', borderColor: 'transparent' }, hover: { backgroundColor: color.primarySoft }, fg: color.primary },
  danger: {
    box: { backgroundColor: color.danger, borderColor: color.danger },
    hover: { backgroundColor: '#991B1B', borderColor: '#991B1B' }, fg: color.textOnPrimary,
  },
  ai: {
    box: { backgroundColor: color.ai, borderColor: color.ai, ...shadow.sm },
    hover: { backgroundColor: '#5B21B6', borderColor: '#5B21B6' }, fg: color.textOnPrimary,
  },
};

// ---------------------------------------------------------------------------------------------
export const Card: React.FC<{
  children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: Tone; padded?: boolean; elevated?: boolean;
}> = ({ children, style, tone, padded = true, elevated }) => (
  <View style={[styles.card, elevated && styles.cardElevated, padded && { padding: space.lg },
    tone && { backgroundColor: toneColors[tone].bg, borderColor: toneColors[tone].border }, style]}>
    {children}
  </View>
);

// ---------------------------------------------------------------------------------------------
export const SectionHeader: React.FC<{
  title: string; subtitle?: string; kicker?: string; right?: React.ReactNode; style?: StyleProp<ViewStyle>;
}> = ({ title, subtitle, kicker, right, style }) => (
  <View style={[styles.sectionHeader, style]}>
    <View style={{ flex: 1, minWidth: 0 }}>
      {!!kicker && <Text style={styles.kicker}>{kicker}</Text>}
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {!!subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </View>
    {right}
  </View>
);

/** Rótulo pequeño en mayúsculas para encabezar grupos. */
export const Kicker: React.FC<{ children: React.ReactNode; style?: StyleProp<TextStyle> }> = ({ children, style }) => (
  <Text style={[styles.kicker, style]}>{children}</Text>
);

// ---------------------------------------------------------------------------------------------
export const StatusPill: React.FC<{ label: string; tone?: Tone; icon?: IconName; dot?: boolean; style?: StyleProp<ViewStyle> }> = ({
  label, tone = 'neutral', icon, dot, style,
}) => {
  const t = toneColors[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }, style]}>
      {dot && <View style={[styles.pillDot, { backgroundColor: t.fg }]} />}
      {icon && <Ionicons name={icon} size={13} color={t.fg} />}
      <Text style={[styles.pillText, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
};

// ---------------------------------------------------------------------------------------------
export const Banner: React.FC<{ tone?: Tone; title?: string; text: string; icon?: IconName; action?: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({
  tone = 'info', title, text, icon, action, style,
}) => {
  const t = toneColors[tone];
  const defaultIcon: IconName = tone === 'danger' ? 'alert-circle' : tone === 'warning' ? 'warning' : tone === 'success' ? 'checkmark-circle' : 'information-circle';
  return (
    <View style={[styles.banner, { backgroundColor: t.bg, borderColor: t.border }, style]}
          accessibilityRole={tone === 'danger' ? 'alert' : undefined}>
      <Ionicons name={icon || defaultIcon} size={20} color={t.fg} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {!!title && <Text style={[styles.bannerTitle, { color: t.fg }]}>{title}</Text>}
        <Text style={styles.bannerText}>{text}</Text>
        {action}
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------------------------
type SegOption<T> = { label: string; value: T; tone?: Tone; icon?: IconName };

/**
 * Selector de una opción. `tone` en una opción colorea su estado elegido
 * (p. ej. "Sí" en rojo para un síntoma de alarma); sin tono se marca en azul.
 */
export const SegmentedControl = <T extends string | boolean | null>({
  options, value, onChange, disabled, accessibilityLabel, stretch,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  stretch?: boolean;
}) => (
  <View style={[styles.segment, stretch && { alignSelf: 'stretch' }]} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
    {options.map((o) => {
      const active = o.value === value;
      const t = o.tone ? toneColors[o.tone] : null;
      // Relleno solo para lo que implica riesgo (rojo, ámbar); el resto queda con contorno
      const solid = active && (o.tone === 'danger' || o.tone === 'warning');
      return (
        <Pressable
          key={String(o.label)}
          onPress={() => onChange(o.value)}
          disabled={disabled}
          accessibilityRole="radio"
          accessibilityState={{ checked: active, disabled: !!disabled }}
          accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}: ${o.label}` : o.label}
          style={(state: any) => [styles.segmentItem, stretch && { flex: 1 },
            state.hovered && !active && { backgroundColor: 'rgba(255,255,255,0.7)' },
            active && styles.segmentItemActive,
            active && t && { borderColor: t.fg },
            solid && t && { backgroundColor: t.fg }]}
        >
          {o.icon && <Ionicons name={o.icon} size={15} color={solid ? '#FFFFFF' : active ? (t?.fg || color.primary) : color.textSecondary} />}
          <Text style={[styles.segmentText, active && styles.segmentTextActive,
            active && t && { color: t.fg }, solid && { color: '#FFFFFF' }]}>{o.label}</Text>
        </Pressable>
      );
    })}
  </View>
);

export const YES_NO_UNKNOWN: SegOption<boolean | null>[] = [
  { label: 'Sí', value: true }, { label: 'No', value: false }, { label: 'No sé', value: null },
];

// ---------------------------------------------------------------------------------------------
export type StepState = 'done' | 'pending' | 'warn' | 'current';

/** Barra de pasos conectada: se puede tocar cualquier paso (no obliga a un orden rígido). */
export const Stepper: React.FC<{
  steps: { key: string; label: string; state: StepState; detail?: string }[];
  current: number;
  onSelect: (index: number) => void;
  compact?: boolean;
}> = ({ steps, current, onSelect, compact }) => (
  <View style={styles.stepper} accessibilityRole="tablist">
    {steps.map((s, i) => {
      const active = i === current;
      const done = s.state === 'done';
      const warn = s.state === 'warn';
      const tone = done ? color.success : warn ? color.warning : active ? color.primary : color.borderStrong;
      const lineDone = i < steps.length - 1 && done && (steps[i + 1].state === 'done' || steps[i + 1].state === 'warn' || i + 1 <= current);
      return (
        <Pressable
          key={s.key}
          onPress={() => onSelect(i)}
          accessibilityRole="tab"
          accessibilityState={{ selected: active }}
          accessibilityLabel={`Paso ${i + 1}: ${s.label}${done ? ', completo' : warn ? ', revisar' : ''}${s.detail ? `. ${s.detail}` : ''}`}
          style={(state: any) => [styles.step, compact && styles.stepCompact, state.hovered && !active && { backgroundColor: color.surfaceMuted },
            active && !compact && styles.stepActive]}
        >
          <View style={styles.stepTrack}>
            <View style={[styles.stepDot, compact && active && styles.stepDotBig,
              { borderColor: tone, backgroundColor: done || warn ? tone : active ? color.primary : color.surface },
              active && { boxShadow: `0px 0px 0px 4px ${done ? color.successSoft : warn ? color.warningSoft : color.primarySoft}` }]}>
              {done ? <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                : warn ? <Ionicons name="alert" size={14} color="#FFFFFF" />
                : <Text style={[styles.stepNum, { color: active ? '#FFFFFF' : color.textMuted }]}>{i + 1}</Text>}
            </View>
            {i < steps.length - 1 && <View style={[styles.stepLine, { backgroundColor: lineDone ? color.success : color.border }]} />}
          </View>
          {!compact && (
            <View style={styles.stepTextBox}>
              <Text style={[styles.stepLabel, active && { color: color.primary }]} numberOfLines={1}>{s.label}</Text>
              {!!s.detail && <Text style={styles.stepDetail} numberOfLines={1}>{s.detail}</Text>}
            </View>
          )}
        </Pressable>
      );
    })}
  </View>
);

// ---------------------------------------------------------------------------------------------
export const KeyValue: React.FC<{ label: string; value: string; hint?: string; valueStyle?: StyleProp<TextStyle> }> = ({
  label, value, hint, valueStyle,
}) => (
  <View style={styles.kv}>
    <Text style={styles.kvLabel}>{label}</Text>
    <Text style={[styles.kvValue, tabular, valueStyle]}>{value}</Text>
    {!!hint && <Text style={styles.kvHint}>{hint}</Text>}
  </View>
);

// ---------------------------------------------------------------------------------------------
/** Anillo de avance (0 a 1) con contenido al centro. */
export const ProgressRing: React.FC<{
  value: number; size?: number; stroke?: number; tint?: string; track?: string; children?: React.ReactNode;
  accessibilityLabel?: string;
}> = ({ value, size = 44, stroke = 4, tint = color.primary, track = color.border, children, accessibilityLabel }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
          accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill as any}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        {v > 0 && (
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={tint} strokeWidth={stroke} fill="none" strokeLinecap="round"
                  strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - v)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        )}
      </Svg>
      {children}
    </View>
  );
};

// ---------------------------------------------------------------------------------------------
const AVATAR_TONES = ['#1D4ED8', '#0369A1', '#047857', '#B45309', '#6D28D9', '#BE123C', '#0E7490', '#4338CA'];

/** Avatar con las iniciales o el código del paciente (color estable según el texto). */
export const Avatar: React.FC<{ label: string; size?: number; muted?: boolean }> = ({ label, size = 40, muted }) => {
  const text = (label || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?';
  let h = 0;
  for (const ch of label || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tint = muted ? color.textMuted : AVATAR_TONES[h % AVATAR_TONES.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: `${tint}14`,
      borderWidth: 1, borderColor: `${tint}33`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: tint, fontSize: Math.round(size * (text.length > 2 ? 0.3 : 0.36)), fontWeight: weight.heavy }}>{text}</Text>
    </View>
  );
};

// ---------------------------------------------------------------------------------------------
/** Bloque gris que "respira" mientras carga (en lugar de una rueda). */
export const Skeleton: React.FC<{ height?: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle>; radius?: number }> = ({
  height = 16, width = '100%', style, radius: r = radius.sm,
}) => {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: false }),
      Animated.timing(v, { toValue: 0.55, duration: 700, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, v]);
  return <Animated.View style={[{ height, width, borderRadius: r, backgroundColor: color.surfaceMuted, opacity: v }, style]} />;
};

/** Varias filas de esqueleto, para listas. */
export const SkeletonList: React.FC<{ rows?: number; height?: number }> = ({ rows = 3, height = 64 }) => (
  <View style={{ gap: space.sm }} accessibilityLabel="Cargando">
    {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} height={height} radius={radius.md} />)}
  </View>
);

// ---------------------------------------------------------------------------------------------
export const EmptyState: React.FC<{
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; title: string; text?: string; action?: React.ReactNode;
  tone?: Tone; compact?: boolean;
}> = ({ icon, title, text, action, tone = 'primary', compact }) => {
  const t = toneColors[tone];
  return (
    <View style={[styles.empty, compact && { paddingVertical: space.lg }]}>
      <View style={[styles.emptyIcon, { backgroundColor: t.bg, borderColor: t.border }]}>
        <MaterialCommunityIcons name={icon} size={28} color={t.fg} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!text && <Text style={styles.emptyText}>{text}</Text>}
      {action}
    </View>
  );
};

// ---------------------------------------------------------------------------------------------
/** Fila tocable de lista con contenido a la izquierda, texto y accesorio a la derecha. */
export const ListItem: React.FC<{
  title: string; subtitle?: string; left?: React.ReactNode; right?: React.ReactNode; onPress?: () => void;
  accessibilityLabel?: string; selected?: boolean; chevron?: boolean;
}> = ({ title, subtitle, left, right, onPress, accessibilityLabel, selected, chevron = true }) => (
  <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
             accessibilityLabel={accessibilityLabel || title} accessibilityState={{ selected: !!selected }}
             style={(state: any) => [styles.listItem, state.hovered && { borderColor: color.borderStrong, ...shadow.sm },
               state.pressed && { transform: [{ scale: 0.995 }] }, selected && { borderColor: color.primary, backgroundColor: color.primarySoft }]}>
    {left}
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.listTitle} numberOfLines={1}>{title}</Text>
      {!!subtitle && <Text style={styles.listSubtitle} numberOfLines={1}>{subtitle}</Text>}
    </View>
    {right}
    {onPress && chevron && <Ionicons name="chevron-forward" size={18} color={color.textMuted} />}
  </Pressable>
);

// ---------------------------------------------------------------------------------------------
/** Mosaico de una lectura del dispositivo: valor real o "--" con el motivo. */
export const VitalTile: React.FC<{
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  tint: string;
  label: string;
  value: string | null;
  unit: string;
  hint: string;
  source?: string;
  style?: StyleProp<ViewStyle>;
}> = ({ icon, tint, label, value, unit, hint, source, style }) => (
  <View style={[styles.tile, style]} accessibilityLabel={`${label}: ${value ? `${value} ${unit}` : 'sin dato'}. ${hint}`}>
    <View style={styles.tileHead}>
      <View style={[styles.tileIcon, { backgroundColor: `${tint}14` }]}>
        <MaterialCommunityIcons name={icon} size={18} color={tint} />
      </View>
      <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>
    </View>
    <View style={styles.valueRow}>
      <Text style={[styles.value, tabular, !value && { color: color.textMuted }]}>{value ?? '--'}</Text>
      <Text style={styles.unit}>{unit}</Text>
    </View>
    <Text style={[styles.hint, !value && { color: color.textMuted }]} numberOfLines={2}>{hint}</Text>
    {!!source && <Text style={styles.source}>{source}</Text>}
  </View>
);

const styles = StyleSheet.create({
  button: {
    minHeight: touch, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    cursor: 'pointer' as any,
  },
  iconButton: {
    borderRadius: radius.md, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer' as any,
  },
  buttonLg: { minHeight: 52, paddingHorizontal: space.xl, borderRadius: radius.md + 2 },
  buttonSm: { minHeight: 36, paddingHorizontal: space.md, gap: 6 },
  buttonText: { fontSize: font.sm, fontWeight: weight.bold },
  card: {
    backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border,
    marginBottom: space.lg, ...shadow.sm,
  },
  cardElevated: { borderRadius: radius.xl, ...shadow.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, marginBottom: space.md },
  kicker: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  sectionTitle: { fontSize: font.xl, fontWeight: weight.heavy, color: color.text, letterSpacing: -0.5 },
  sectionSubtitle: { fontSize: font.sm, color: color.textSecondary, marginTop: 4, lineHeight: 20 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'center',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: font.xs, fontWeight: weight.bold },
  banner: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, marginBottom: space.lg },
  bannerTitle: { fontSize: font.sm, fontWeight: weight.heavy, marginBottom: 2 },
  bannerText: { fontSize: font.sm, color: color.text, lineHeight: 20 },
  segment: {
    flexDirection: 'row', backgroundColor: color.surfaceMuted, borderRadius: radius.md, padding: 3, gap: 3,
    alignSelf: 'flex-start', borderWidth: 1, borderColor: color.border,
  },
  segmentItem: {
    flexDirection: 'row', gap: 6, minHeight: 38, minWidth: 64, paddingHorizontal: space.md, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer' as any, borderWidth: 1, borderColor: 'transparent',
  },
  segmentItemActive: { backgroundColor: color.surface, borderColor: color.primary, ...shadow.sm },
  segmentText: { fontSize: font.sm, fontWeight: weight.medium, color: color.textSecondary },
  segmentTextActive: { color: color.primary, fontWeight: weight.heavy },
  stepper: { flexDirection: 'row', marginBottom: space.lg },
  step: {
    flex: 1, minWidth: 0, paddingVertical: space.sm, paddingHorizontal: space.xs, borderRadius: radius.md,
    cursor: 'pointer' as any, minHeight: touch,
  },
  stepCompact: { alignItems: 'stretch', paddingHorizontal: 0 },
  stepActive: { backgroundColor: color.primarySoft },
  stepTrack: { flexDirection: 'row', alignItems: 'center' },
  stepDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginLeft: space.sm },
  stepDotBig: { width: 32, height: 32, borderRadius: 16 },
  stepLine: { flex: 1, height: 2, borderRadius: 1, marginHorizontal: space.sm },
  stepTextBox: { marginTop: space.sm, paddingHorizontal: space.sm, minWidth: 0 },
  stepNum: { fontSize: font.xs, fontWeight: weight.heavy },
  stepLabel: { fontSize: font.sm, fontWeight: weight.bold, color: color.text },
  stepDetail: { fontSize: font.xs, color: color.textMuted, marginTop: 1 },
  kv: { flex: 1, minWidth: 120 },
  kvLabel: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.medium },
  kvValue: { fontSize: font.lg, color: color.text, fontWeight: weight.heavy, marginTop: 2 },
  kvHint: { fontSize: font.xs, color: color.textSecondary, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg, gap: space.sm },
  emptyIcon: { width: 64, height: 64, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  emptyTitle: { fontSize: font.md, fontWeight: weight.heavy, color: color.text, textAlign: 'center' },
  emptyText: { fontSize: font.sm, color: color.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 420 },
  listItem: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingHorizontal: space.lg, paddingVertical: space.sm,
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, cursor: 'pointer' as any,
  },
  listTitle: { fontSize: font.md, fontWeight: weight.bold, color: color.text },
  listSubtitle: { fontSize: font.xs, color: color.textMuted, marginTop: 2 },
  tile: {
    flexGrow: 1, flexBasis: 160, minHeight: 132, padding: space.lg, backgroundColor: color.surface,
    borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, ...shadow.sm,
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tileIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { flex: 1, fontSize: font.sm, fontWeight: weight.bold, color: color.text },
  valueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: space.md },
  value: { fontSize: font.xxl, lineHeight: 36, fontWeight: weight.heavy, color: color.text, letterSpacing: -0.5 },
  unit: { fontSize: font.sm, color: color.textSecondary, fontWeight: weight.bold, marginBottom: 4 },
  hint: { fontSize: font.xs, color: color.textSecondary, marginTop: space.xs, lineHeight: 16 },
  source: { fontSize: font.xs, color: color.textMuted, marginTop: space.xs },
});
