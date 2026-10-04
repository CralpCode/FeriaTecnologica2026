import React, { useState } from 'react';
import { View, StyleSheet, Platform, StatusBar as RNStatusBar } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from './src/theme/colors';
import { VitalsProvider } from './src/context/VitalsContext';
import { ClinicalProvider, useClinical } from './src/context/ClinicalContext';
import { Header } from './src/components/Header';
import { BottomNavBar, TabScreen } from './src/components/BottomNavBar';
import { SideNavBar } from './src/components/SideNavBar';
import { ConnectionBanner } from './src/components/ConnectionBanner';
import { useLayout } from './src/hooks/useLayout';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { ChartsScreen } from './src/screens/ChartsScreen';
import { AIAssistantScreen } from './src/screens/AIAssistantScreen';
import { AuscultationScreen } from './src/screens/AuscultationScreen';
import { AlertsScreen } from './src/screens/AlertsScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { AuscultationMode } from './src/types/vitals';

const MainAppContent: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<TabScreen>('dashboard');
  const [auscultationMode, setAuscultationMode] = useState<AuscultationMode>('corazon');
  const { hasCriticalAlert, activeAlertsCount } = useClinical();
  const insets = useSafeAreaInsets();
  const { useSideNav, isDesktop } = useLayout();
  const nav = {
    currentTab,
    onSelectTab: setCurrentTab,
    hasAlert: hasCriticalAlert,
    alertsCount: activeAlertsCount,
  };

  const paddingTop = Platform.OS === 'android' ? (RNStatusBar.currentHeight || 0) : (insets?.top || 0);

  return (
    <View style={[styles.root, { paddingTop }]}>
      <StatusBar style="dark" />

      {/* Cabecera común */}
      <Header onNewPatient={() => setCurrentTab('dashboard')} />

      <ConnectionBanner />

      <View style={styles.body}>
        {/* Navegación lateral en computadora y tablet horizontal */}
        {useSideNav && <SideNavBar {...nav} compact={!isDesktop} />}

      {/* Contenido según pestaña seleccionada */}
      <View style={styles.screenContainer}>
        {currentTab === 'dashboard' && (
          <DashboardScreen
            onNavigateToAI={() => setCurrentTab('ai')}
            onNavigateToCharts={() => setCurrentTab('charts')}
            onOpenAuscultation={(mode) => {
              setAuscultationMode(mode);
              setCurrentTab('auscultation');
            }}
          />
        )}
        {currentTab === 'auscultation' && <AuscultationScreen initialMode={auscultationMode} />}
        {currentTab === 'alerts' && <AlertsScreen />}
        {currentTab === 'history' && <HistoryScreen />}
        {currentTab === 'charts' && <ChartsScreen />}
        {currentTab === 'ai' && <AIAssistantScreen />}
      </View>
      </View>

      {/* Barra de navegación inferior (celular y tablet vertical) */}
      {!useSideNav && <BottomNavBar {...nav} />}
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <VitalsProvider>
        <ClinicalProvider>
          <MainAppContent />
        </ClinicalProvider>
      </VitalsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
  },
  screenContainer: {
    flex: 1,
    minWidth: 0,
  },
});
