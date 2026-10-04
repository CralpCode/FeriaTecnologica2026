import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';

export type TabScreen = 'dashboard' | 'auscultation' | 'alerts' | 'history' | 'charts' | 'ai';

interface BottomNavBarProps {
  currentTab: TabScreen;
  onSelectTab: (tab: TabScreen) => void;
  hasAlert?: boolean;
  alertsCount?: number;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({ currentTab, onSelectTab, hasAlert = false, alertsCount = 0 }) => {
  const tabs = [
    {
      id: 'dashboard' as TabScreen,
      label: 'Monitoreo',
      iconFamily: 'MaterialCommunityIcons',
      iconName: 'heart-pulse',
    },
    {
      id: 'auscultation' as TabScreen,
      label: 'Auscultar',
      iconFamily: 'MaterialCommunityIcons',
      iconName: 'stethoscope',
    },
    {
      id: 'alerts' as TabScreen,
      label: 'Alertas',
      iconFamily: 'MaterialCommunityIcons',
      iconName: 'bell-outline',
      badge: alertsCount > 0,
    },
    {
      id: 'history' as TabScreen,
      label: 'Historial',
      iconFamily: 'MaterialCommunityIcons',
      iconName: 'folder-account-outline',
    },
    {
      id: 'ai' as TabScreen,
      label: 'Asistente',
      iconFamily: 'MaterialCommunityIcons',
      iconName: 'robot-outline',
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.innerBar}>
        {tabs.map((tab) => {
          const isActive = currentTab === tab.id;
          const activeColor = tab.id === 'ai' ? Colors.aiPurple : Colors.heartRate;

          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tabButton, isActive && styles.tabButtonActive]}
              activeOpacity={0.65}
              onPress={() => onSelectTab(tab.id)}
            >
              <View style={styles.iconContainer}>
                {tab.iconFamily === 'Ionicons' ? (
                  <Ionicons
                    name={tab.iconName as any}
                    size={24}
                    color={isActive ? activeColor : Colors.textMuted}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name={tab.iconName as any}
                    size={24}
                    color={isActive ? activeColor : Colors.textMuted}
                  />
                )}

                {tab.badge && <View style={[styles.alertBadge, hasAlert && styles.alertBadgeCritical]} />}
              </View>

              <Text
                style={[
                  styles.tabLabel,
                  { color: isActive ? activeColor : Colors.textSecondary, fontWeight: isActive ? '800' : '600' },
                ]}
              >
                {tab.label}
              </Text>

              {isActive && <View style={[styles.activeIndicator, { backgroundColor: activeColor }]} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
    paddingTop: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 8,
  },
  innerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    position: 'relative',
    cursor: 'pointer' as any,
  },
  tabButtonActive: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
  },
  iconContainer: {
    position: 'relative',
    marginBottom: 4,
  },
  alertBadge: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#DC2626',
  },
  alertBadgeCritical: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  tabLabel: {
    fontSize: 11,
  },
  activeIndicator: {
    position: 'absolute',
    bottom: -2,
    width: 20,
    height: 3,
    borderRadius: 2,
  },
});
