/**
 * Componentes base de la interfaz (estilo clínico claro y sobrio). Úsalos en lugar de estilos sueltos.
 */
import React from 'react';
import {
  ActivityIndicator, StyleProp, StyleSheet, Text, TextStyle, TouchableOpacity, View, ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, radius, space, toneColors, touch, Tone, weight } from '../../theme/tokens';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------------------------------------
export const Button: React.FC<{
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}> = ({ label, onPress, variant = 'primary', icon, loading, disabled, size = 'md', full, style, accessibilityLabel }) => {
  const v = BUTTON[variant];
  const inactive = disabled || loading;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={inactive}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={[styles.button, size === 'lg' && styles.buttonLg, v.box, full && { alignSelf: 'stretch' },
        inactive && { opacity: 0.55 }, style]}
    >
      {loading ? <ActivityIndicator color={v.fg} size="small" />
        : icon ? <Ionicons name={icon} size={size === 'lg' ? 20 : 18} color={v.fg} /> : null}
      <Text style={[styles.buttonText, size === 'lg' && { fontSize: font.md }, { color: v.fg }]}>{label}</Text>
    </TouchableOpacity>
  );
};

const BUTTON: Record<string, { box: ViewStyle; fg: string }> = {
  primary: { box: { backgroundColor: color.primary, borderColor: color.primary }, fg: color.textOnPrimary },
  secondary: { box: { backgroundColor: color.surface, borderColor: color.borderStrong }, fg: color.text },
  ghost: { box: { backgroundColor: 'transparent', borderColor: 'transparent' }, fg: color.primary },
  danger: { box: { backgroundColor: color.danger, borderColor: color.danger }, fg: color.textOnPrimary },
};

// ---------------------------------------------------------------------------------------------
export const Card: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: Tone; padded?: boolean }> = ({
  children, style, tone, padded = true,
}) => (
  <View style={[styles.card, padded && { padding: space.lg },
    tone && { backgroundColor: toneColors[tone].bg, borderColor: toneColors[tone].border }, style]}>
    {children}
  </View>
);

// ---------------------------------------------------------------------------------------------
export const SectionHeader: React.FC<{ title: string; subtitle?: string; right?: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({
  title, subtitle, right, style,
}) => (
  <View style={[styles.sectionHeader, style]}>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {!!subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </View>
    {right}
  </View>
);

// ---------------------------------------------------------------------------------------------
export const StatusPill: React.FC<{ label: string; tone?: Tone; icon?: IconName; style?: StyleProp<ViewStyle> }> = ({
  label, tone = 'neutral', icon, style,
}) => {
  const t = toneColors[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }, style]}>
      {icon && <Ionicons name={icon} size={13} color={t.fg} />}
      <Text style={[styles.pillText, { color: t.fg }]}>{label}</Text>
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
/** Respuesta Sí / No / No sé (null = no sé, se conserva como desconocido). */
export const SegmentedControl = <T extends string | boolean | null>({
  options, value, onChange, disabled, accessibilityLabel,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) => (
  <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
    {options.map((o) => {
      const active = o.value === value;
      return (
        <TouchableOpacity
          key={String(o.label)}
          onPress={() => onChange(o.value)}
          disabled={disabled}
          accessibilityRole="radio"
          accessibilityState={{ checked: active, disabled: !!disabled }}
          accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}: ${o.label}` : o.label}
          style={[styles.segmentItem, active && styles.segmentItemActive]}
        >
          <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{o.label}</Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

export const YES_NO_UNKNOWN: { label: string; value: boolean | null }[] = [
  { label: 'Sí', value: true }, { label: 'No', value: false }, { label: 'No sé', value: null },
];

// ---------------------------------------------------------------------------------------------
export type StepState = 'done' | 'pending' | 'warn' | 'current';

/** Barra de pasos: se puede tocar cualquier paso (no obliga a un orden rígido). */
export const Stepper: React.FC<{
  steps: { key: string; label: string; state: StepState; detail?: string }[];
  current: number;
  onSelect: (index: number) => void;
  compact?: boolean;
}> = ({ steps, current, onSelect, compact }) => (
  <View style={[styles.stepper, compact && styles.stepperCompact]} accessibilityRole="tablist">
    {steps.map((s, i) => {
      const active = i === current;
      const tone = s.state === 'done' ? color.success : s.state === 'warn' ? color.warning : active ? color.primary : color.borderStrong;
      return (
        <TouchableOpacity
          key={s.key}
          onPress={() => onSelect(i)}
          accessibilityRole="tab"
          accessibilityState={{ selected: active }}
          accessibilityLabel={`Paso ${i + 1}: ${s.label}${s.state === 'done' ? ', completo' : s.state === 'warn' ? ', revisar' : ''}`}
          style={[styles.step, compact && styles.stepCompact, active && styles.stepActive]}
        >
          <View style={[styles.stepDot, { borderColor: tone, backgroundColor: s.state === 'done' || s.state === 'warn' ? tone : active ? color.primary : color.surface }]}>
            {s.state === 'done' ? <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              : s.state === 'warn' ? <Ionicons name="alert" size={14} color="#FFFFFF" />
              : <Text style={[styles.stepNum, { color: active ? '#FFFFFF' : color.textMuted }]}>{i + 1}</Text>}
          </View>
          {!compact && (
            <View style={{ minWidth: 0, flexShrink: 1 }}>
              <Text style={[styles.stepLabel, active && { color: color.primary }]} numberOfLines={1}>{s.label}</Text>
              {!!s.detail && <Text style={styles.stepDetail} numberOfLines={1}>{s.detail}</Text>}
            </View>
          )}
        </TouchableOpacity>
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
    <Text style={[styles.kvValue, valueStyle]}>{value}</Text>
    {!!hint && <Text style={styles.kvHint}>{hint}</Text>}
  </View>
);

const styles = StyleSheet.create({
  button: {
    minHeight: touch, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    cursor: 'pointer' as any,
  },
  buttonLg: { minHeight: 52, paddingHorizontal: space.xl },
  buttonText: { fontSize: font.sm, fontWeight: weight.bold },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, marginBottom: space.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, marginBottom: space.md },
  sectionTitle: { fontSize: font.lg, fontWeight: weight.heavy, color: color.text, letterSpacing: -0.3 },
  sectionSubtitle: { fontSize: font.sm, color: color.textSecondary, marginTop: 2, lineHeight: 20 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1,
  },
  pillText: { fontSize: font.xs, fontWeight: weight.bold },
  banner: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, marginBottom: space.lg },
  bannerTitle: { fontSize: font.sm, fontWeight: weight.heavy, marginBottom: 2 },
  bannerText: { fontSize: font.sm, color: color.text, lineHeight: 20 },
  segment: {
    flexDirection: 'row', backgroundColor: color.surfaceMuted, borderRadius: radius.md, padding: 3, gap: 3,
    alignSelf: 'flex-start',
  },
  segmentItem: {
    minHeight: 38, minWidth: 64, paddingHorizontal: space.md, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer' as any,
  },
  segmentItemActive: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.primary },
  segmentText: { fontSize: font.sm, fontWeight: weight.medium, color: color.textSecondary },
  segmentTextActive: { color: color.primary, fontWeight: weight.heavy },
  stepper: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg, flexWrap: 'wrap' },
  stepperCompact: { flexWrap: 'nowrap', justifyContent: 'space-between' },
  step: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, paddingHorizontal: space.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface,
    minHeight: touch, flexGrow: 1, flexBasis: 140, cursor: 'pointer' as any,
  },
  stepCompact: { flexBasis: 'auto', flexGrow: 0, paddingHorizontal: space.sm, justifyContent: 'center', minWidth: touch },
  stepActive: { borderColor: color.primary, backgroundColor: color.primarySoft },
  stepDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stepNum: { fontSize: font.xs, fontWeight: weight.heavy },
  stepLabel: { fontSize: font.sm, fontWeight: weight.bold, color: color.text },
  stepDetail: { fontSize: font.xs, color: color.textMuted },
  kv: { flex: 1, minWidth: 120 },
  kvLabel: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.medium },
  kvValue: { fontSize: font.lg, color: color.text, fontWeight: weight.heavy, marginTop: 2 },
  kvHint: { fontSize: font.xs, color: color.textSecondary, marginTop: 2 },
});
