import React, { useState } from 'react';
import { View, StyleSheet, Platform, StatusBar as RNStatusBar } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from './src/theme/colors';
import { VitalsProvider, useVitals } from './src/context/VitalsContext';
import { Header } from './src/components/Header';
import { BottomNavBar, TabScreen } from './src/components/BottomNavBar';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { ChartsScreen } from './src/screens/ChartsScreen';
import { AIAssistantScreen } from './src/screens/AIAssistantScreen';

const MainAppContent: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<TabScreen>('dashboard');
  const { aiReport } = useVitals();
  const insets = useSafeAreaInsets();

  const hasCriticalAlert = aiReport?.status === 'critical';
  const paddingTop = Platform.OS === 'android' ? (RNStatusBar.currentHeight || 0) : (insets?.top || 0);

  return (
    <View style={[styles.root, { paddingTop }]}>
      <StatusBar style="dark" />

      {/* Cabecera común */}
      <Header />

      {/* Contenido según pestaña seleccionada */}
      <View style={styles.screenContainer}>
        {currentTab === 'dashboard' && (
          <DashboardScreen
            onNavigateToAI={() => setCurrentTab('ai')}
            onNavigateToCharts={() => setCurrentTab('charts')}
          />
        )}
        {currentTab === 'charts' && <ChartsScreen />}
        {currentTab === 'ai' && <AIAssistantScreen />}
      </View>

      {/* Barra de navegación inferior */}
      <BottomNavBar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        hasAlert={hasCriticalAlert}
      />
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <VitalsProvider>
        <MainAppContent />
      </VitalsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  screenContainer: {
    flex: 1,
  },
});
