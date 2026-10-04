import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { NAV_TABS, NavProps, tabColor } from './BottomNavBar';

/** Navegación lateral para computadora y tablet horizontal (mismas pestañas que la barra inferior). */
export const SideNavBar: React.FC<NavProps & { compact?: boolean }> = ({
  currentTab, onSelectTab, hasAlert = false, alertsCount = 0, compact = false,
}) => (
  <View style={[styles.container, compact && styles.containerCompact]} accessibilityRole="tablist">
    {NAV_TABS.map((tab) => {
      const isActive = currentTab === tab.id;
      const color = isActive ? tabColor(tab.id) : Colors.textSecondary;
      const badge = tab.id === 'alerts' && alertsCount > 0;
      return (
        <TouchableOpacity
          key={tab.id}
          style={[styles.item, compact && styles.itemCompact, isActive && styles.itemActive]}
          onPress={() => onSelectTab(tab.id)}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityState={{ selected: isActive }}
          accessibilityLabel={badge ? `${tab.label}, ${alertsCount} activas` : tab.label}
        >
          {isActive && <View style={[styles.activeBar, { backgroundColor: tabColor(tab.id) }]} />}
          <View>
            <MaterialCommunityIcons name={tab.icon as any} size={22} color={color} />
            {badge && <View style={[styles.badgeDot, hasAlert && styles.badgeCritical]} />}
          </View>
          {!compact && (
            <Text style={[styles.label, { color, fontWeight: isActive ? '800' : '600' }]}>{tab.label}</Text>
          )}
          {!compact && badge && (
            <View style={[styles.countPill, hasAlert && { backgroundColor: Colors.danger }]}>
              <Text style={styles.countText}>{alertsCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  container: {
    width: 208,
    backgroundColor: Colors.card,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    paddingVertical: 12,
    paddingHorizontal: 10,
    gap: 4,
  },
  containerCompact: { width: 76, alignItems: 'center' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    position: 'relative',
    cursor: 'pointer' as any,
  },
  itemCompact: { width: 56, justifyContent: 'center', paddingHorizontal: 0 },
  itemActive: { backgroundColor: Colors.background },
  activeBar: { position: 'absolute', left: -10, top: 10, bottom: 10, width: 4, borderRadius: 2 },
  label: { flex: 1, fontSize: 14 },
  badgeDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Colors.danger,
  },
  badgeCritical: { width: 11, height: 11, borderRadius: 6 },
  countPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.warning,
  },
  countText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});
