import React from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Text } from './ui/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { color as T } from '../theme/tokens';

export type TabScreen = 'consulta' | 'dashboard' | 'alerts' | 'history' | 'charts' | 'ai';

export interface NavProps {
  currentTab: TabScreen;
  onSelectTab: (tab: TabScreen) => void;
  hasAlert?: boolean;
  alertsCount?: number;
}

/** Pestañas de la app: las usan la barra inferior (celular) y la lateral (tablet y computadora). */
export const NAV_TABS: { id: TabScreen; label: string; icon: string }[] = [
  { id: 'consulta', label: 'Consulta', icon: 'stethoscope' },
  { id: 'dashboard', label: 'Monitoreo', icon: 'heart-pulse' },
  { id: 'history', label: 'Historial', icon: 'folder-account-outline' },
  { id: 'alerts', label: 'Alertas', icon: 'bell-outline' },
  { id: 'ai', label: 'Asistente', icon: 'robot-outline' },
];

export const tabColor = (id: TabScreen) => (id === 'ai' ? T.ai : T.primary);

export const BottomNavBar: React.FC<NavProps> = ({ currentTab, onSelectTab, hasAlert = false, alertsCount = 0 }) => (
  <View style={styles.container} accessibilityRole="tablist">
    <View style={styles.innerBar}>
      {NAV_TABS.map((tab) => {
        const isActive = currentTab === tab.id;
        const color = isActive ? tabColor(tab.id) : Colors.textMuted;
        const badge = tab.id === 'alerts' && alertsCount > 0;
        return (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tabButton, isActive && styles.tabButtonActive]}
            activeOpacity={0.65}
            onPress={() => onSelectTab(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={badge ? `${tab.label}, ${alertsCount} activas` : tab.label}
          >
            <View style={styles.iconContainer}>
              <MaterialCommunityIcons name={tab.icon as any} size={24} color={color} />
              {badge && <View style={[styles.alertBadge, hasAlert && styles.alertBadgeCritical]} />}
            </View>
            <Text
              style={[
                styles.tabLabel,
                { color: isActive ? tabColor(tab.id) : T.textSecondary, fontWeight: isActive ? '800' : '500' },
              ]}
            >
              {tab.label}
            </Text>
            {isActive && <View style={[styles.activeIndicator, { backgroundColor: tabColor(tab.id) }]} />}
          </TouchableOpacity>
        );
      })}
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    paddingTop: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 8,
  },
  innerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 },
  tabButton: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    position: 'relative',
    cursor: 'pointer' as any,
  },
  tabButtonActive: { backgroundColor: T.primarySoft, borderRadius: 12 },
  iconContainer: { position: 'relative', marginBottom: 3 },
  alertBadge: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Colors.danger,
  },
  alertBadgeCritical: { width: 11, height: 11, borderRadius: 6 },
  tabLabel: { fontSize: 12 },
  activeIndicator: { position: 'absolute', bottom: -2, width: 20, height: 3, borderRadius: 2 },
});
