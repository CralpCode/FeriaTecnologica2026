import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NAV_TABS, NavProps, tabColor } from './BottomNavBar';
import { useVitals } from '../context/VitalsContext';
import { useConsultaProgress } from '../hooks/useConsultaProgress';
import { color, font, radius, space, weight } from '../theme/tokens';
import { Avatar, ProgressRing } from './ui';

/** Navegación lateral para computadora y tablet horizontal (mismas pestañas que la barra inferior). */
export const SideNavBar: React.FC<NavProps & { compact?: boolean; onOpenConsulta?: (step: number) => void }> = ({
  currentTab, onSelectTab, hasAlert = false, alertsCount = 0, compact = false, onOpenConsulta,
}) => {
  const { isBackendOnline } = useVitals();
  const progress = useConsultaProgress();
  const next = progress.steps.findIndex((s, i) => i < 5 && s.state !== 'done');
  const target = next === -1 ? 5 : next;
  const code = progress.steps[0].detail;

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View accessibilityRole="tablist" style={{ gap: 4 }}>
        {NAV_TABS.map((tab) => {
          const isActive = currentTab === tab.id;
          const tint = isActive ? tabColor(tab.id) : color.textSecondary;
          const badge = tab.id === 'alerts' && alertsCount > 0;
          return (
            <Pressable
              key={tab.id}
              style={(s: any) => [styles.item, compact && styles.itemCompact, s.hovered && !isActive && { backgroundColor: color.surfaceMuted },
                isActive && { backgroundColor: tab.id === 'ai' ? color.aiSoft : color.primarySoft }]}
              onPress={() => onSelectTab(tab.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={badge ? `${tab.label}, ${alertsCount} activas` : tab.label}
            >
              <View>
                <MaterialCommunityIcons name={tab.icon as any} size={22} color={tint} />
                {badge && compact && <View style={[styles.badgeDot, hasAlert && styles.badgeCritical]} />}
              </View>
              {!compact && <Text style={[styles.label, { color: tint, fontWeight: isActive ? weight.heavy : weight.medium }]}>{tab.label}</Text>}
              {!compact && badge && (
                <View style={[styles.countPill, hasAlert && { backgroundColor: color.danger }]}>
                  <Text style={styles.countText}>{alertsCount}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      <View style={{ flex: 1 }} />

      {/* Consulta en curso: paciente, avance y acceso directo al siguiente paso */}
      {progress.named && onOpenConsulta && (
        compact ? (
          <Pressable onPress={() => onOpenConsulta(target)} accessibilityRole="button"
                     accessibilityLabel={`Consulta de ${code}: ${progress.completed} de 5 pasos. Ir a ${progress.steps[target].label}`}
                     style={styles.compactCard}>
            <ProgressRing value={progress.completed / 5} size={44} stroke={4}>
              <Text style={styles.compactRingText}>{progress.completed}</Text>
            </ProgressRing>
          </Pressable>
        ) : (
          <Pressable onPress={() => onOpenConsulta(target)} accessibilityRole="button"
                     accessibilityLabel={`Ir a la consulta de ${code}, paso ${progress.steps[target].label}`}
                     style={(s: any) => [styles.card, s.hovered && { borderColor: color.primary }]}>
            <View style={styles.cardRow}>
              <Avatar label={code} size={34} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cardKicker}>Consulta en curso</Text>
                <Text style={styles.cardCode} numberOfLines={1}>{code}</Text>
              </View>
              <ProgressRing value={progress.completed / 5} size={34} stroke={3}>
                <Text style={styles.cardRing}>{progress.completed}</Text>
              </ProgressRing>
            </View>
            <Text style={styles.cardNext} numberOfLines={1}>
              {next === -1 ? 'Lista para ver el resultado →' : `Siguiente: ${progress.steps[target].label} →`}
            </Text>
          </Pressable>
        )
      )}

      <View style={[styles.server, compact && { justifyContent: 'center' }]}
            accessibilityLabel={isBackendOnline ? 'Servidor en línea' : 'Sin conexión con el servidor'}>
        <View style={[styles.serverDot, { backgroundColor: isBackendOnline ? color.success : color.danger }]} />
        {!compact && <Text style={styles.serverText}>{isBackendOnline ? 'Servidor en línea' : 'Sin servidor'}</Text>}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 220, backgroundColor: color.surface, borderRightWidth: 1, borderRightColor: color.border,
    paddingVertical: space.md, paddingHorizontal: space.sm + 2,
  },
  containerCompact: { width: 76, alignItems: 'center' },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 46, paddingHorizontal: space.md,
    borderRadius: radius.md, cursor: 'pointer' as any,
  },
  itemCompact: { width: 56, justifyContent: 'center', paddingHorizontal: 0 },
  label: { flex: 1, fontSize: font.sm },
  badgeDot: { position: 'absolute', top: -2, right: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: color.warning },
  badgeCritical: { width: 11, height: 11, borderRadius: 6, backgroundColor: color.danger },
  countPill: {
    minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.warning,
  },
  countText: { color: '#FFFFFF', fontSize: font.xs, fontWeight: weight.heavy },
  card: {
    borderWidth: 1, borderColor: color.border, backgroundColor: color.bg, borderRadius: radius.lg, padding: space.md,
    marginBottom: space.md, cursor: 'pointer' as any,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardKicker: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.bold },
  cardCode: { fontSize: font.sm, color: color.text, fontWeight: weight.heavy },
  cardRing: { fontSize: font.xs, fontWeight: weight.heavy, color: color.text },
  cardNext: { fontSize: font.xs, color: color.primary, fontWeight: weight.bold, marginTop: space.sm },
  compactCard: { marginBottom: space.md, cursor: 'pointer' as any },
  compactRingText: { fontSize: font.sm, fontWeight: weight.heavy, color: color.text },
  server: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 32 },
  serverDot: { width: 8, height: 8, borderRadius: 4 },
  serverText: { fontSize: font.xs, color: color.textMuted, fontWeight: weight.medium },
});
