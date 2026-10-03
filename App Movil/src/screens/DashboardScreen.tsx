import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';
import { MetricCard } from '../components/MetricCard';
import { HospitalEcgMonitor } from '../components/HospitalEcgMonitor';
import { AIInsightCard } from '../components/AIInsightCard';

interface DashboardScreenProps {
  onNavigateToAI: () => void;
  onNavigateToPulmonary?: () => void;
  onNavigateToCharts: () => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  onNavigateToAI,
  onNavigateToPulmonary,
  onNavigateToCharts,
}) => {
  const { vitals, aiReport } = useVitals();

  const isLive = vitals.heartRate > 0;

  const getHeartStatus = () => {
    if (!isLive) return { text: 'En Espera', status: 'normal' };
    if (vitals.heartRate > 120 || vitals.heartRate < 45) return { text: 'Taquicardia', status: 'critical' };
    if (vitals.heartRate > 100 || vitals.heartRate < 55) return { text: 'Elevado', status: 'caution' };
    return { text: 'Óptimo', status: 'normal' };
  };

  const getOxygenStatus = () => {
    if (!isLive) return { text: 'En Espera', status: 'normal' };
    if (vitals.bloodOxygen < 90) return { text: 'Crítico (<90%)', status: 'critical' };
    if (vitals.bloodOxygen < 95) return { text: 'Aceptable', status: 'caution' };
    return { text: 'Óptimo', status: 'normal' };
  };

  const getPressureStatus = () => {
    if (!isLive) return { text: 'En Espera', status: 'normal' };
    if (vitals.systolicPressure >= 135 || vitals.diastolicPressure >= 88) return { text: 'Elevada', status: 'caution' };
    return { text: 'Normal', status: 'normal' };
  };

  const getStressStatus = () => {
    if (!isLive) return { text: 'En Espera', status: 'normal' };
    if (vitals.stressLevel > 70) return { text: 'Alto', status: 'caution' };
    if (vitals.stressLevel > 40) return { text: 'Moderado', status: 'normal' };
    return { text: 'Bajo', status: 'normal' };
  };

  const getAudioStatus = () => {
    const rms = vitals.audio_rms || 0;
    if (!isLive) return { text: 'En Espera', status: 'normal' };
    if (rms > 45) return { text: 'Ruidoso', status: 'caution' };
    if (rms > 25) return { text: 'Voz / Audio', status: 'normal' };
    return { text: 'Silencioso', status: 'normal' };
  };

  const heartStatus = getHeartStatus();
  const oxygenStatus = getOxygenStatus();
  const pressureStatus = getPressureStatus();
  const stressStatus = getStressStatus();
  const audioStatus = getAudioStatus();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* 1. MONITOR ECG HOSPITALARIO A 60 FPS (ÚNICO Y PRINCIPAL) */}
      <HospitalEcgMonitor
        heartRate={vitals.heartRate}
        bloodOxygen={vitals.bloodOxygen}
        systolicPressure={vitals.systolicPressure}
        diastolicPressure={vitals.diastolicPressure}
        audioDecibels={vitals.audio_rms || 0}
        isAlert={heartStatus.status === 'critical'}
      />

      {/* 2. TARJETA DE ANÁLISIS MÉDICO IA */}
      <TouchableOpacity activeOpacity={0.9} onPress={onNavigateToAI}>
        <AIInsightCard report={aiReport} onAskAI={onNavigateToAI} />
      </TouchableOpacity>

      {/* 2b. TARJETA DESTACADA: MÓDULO IA PULMONAR & AUSCULTACIÓN INMP441 */}
      {onNavigateToPulmonary && (
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={onNavigateToPulmonary}
          style={styles.pulmonaryBannerCard}
        >
          <View style={styles.pulmonaryBannerLeft}>
            <View style={styles.pulmonaryIconCircle}>
              <MaterialCommunityIcons name="lungs" size={24} color="#0D9488" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.pulmonaryTagRow}>
                <Text style={styles.pulmonaryTagText}>PREDICCIÓN NEUMOLÓGICA IA</Text>
                <View style={styles.pulmonaryLiveDot} />
              </View>
              <Text style={styles.pulmonaryCardTitle}>Auscultación Pulmonar Digital</Text>
              <Text style={styles.pulmonaryCardSub}>
                {vitals.audio_rms ? `${vitals.audio_rms.toFixed(1)} dB RMS` : '0.0 dB'} · Detección de Asma, Neumonía y EPOC
              </Text>
            </View>
          </View>
          <View style={styles.pulmonaryArrowBtn}>
            <Ionicons name="chevron-forward" size={18} color="#0D9488" />
          </View>
        </TouchableOpacity>
      )}

      {/* 3. PARÁMETROS EN VIVO */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Métricas de Sensores Físicos</Text>
        <TouchableOpacity onPress={onNavigateToCharts} style={styles.seeMoreBtn}>
          <Text style={styles.seeMoreText}>Ver Gráficas</Text>
          <Ionicons name="chevron-forward" size={14} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        {/* Ritmo Cardíaco */}
        <MetricCard
          title="Ritmo Cardíaco"
          value={isLive ? vitals.heartRate : '--'}
          unit="BPM"
          status={heartStatus.status as any}
          statusText={heartStatus.text}
          icon="heart-pulse"
          color={Colors.heartRate}
          softColor="#FFE4E6"
          subtitle="Sensor MAX30102"
        />

        {/* Oxígeno en Sangre */}
        <MetricCard
          title="Oxígeno en Sangre"
          value={isLive ? vitals.bloodOxygen.toFixed(1) : '--'}
          unit="% SpO2"
          status={oxygenStatus.status as any}
          statusText={oxygenStatus.text}
          icon="water-percent"
          color={Colors.oxygen}
          softColor="#E0F2FE"
          subtitle="Espectrometría Óptica"
        />

        {/* Presión Arterial */}
        <MetricCard
          title="Presión Arterial"
          value={isLive ? `${vitals.systolicPressure}/${vitals.diastolicPressure}` : '--/--'}
          unit="mmHg"
          status={pressureStatus.status as any}
          statusText={pressureStatus.text}
          icon="heart-flash"
          color={Colors.pressure}
          softColor="#EDE9FE"
          subtitle="Algoritmo PTT"
        />

        {/* Micrófono Bio-Acústico (Acceso directo a IA Pulmonar) */}
        <MetricCard
          title="Micrófono Bio-Acústico"
          value={isLive && vitals.audio_rms ? vitals.audio_rms.toFixed(1) : '--'}
          unit="dB"
          status={audioStatus.status as any}
          statusText={audioStatus.text}
          icon="microphone"
          color="#0D9488"
          softColor="#CCFBF1"
          subtitle="Tocar para IA Pulmonar →"
          onPress={onNavigateToPulmonary}
        />

        {/* Estrés Autonómico */}
        <MetricCard
          title="Estrés Autonómico"
          value={isLive ? vitals.stressLevel : '--'}
          unit="/100"
          status={stressStatus.status as any}
          statusText={stressStatus.text}
          icon="brain"
          color={Colors.stress}
          softColor="#FEF3C7"
          subtitle="Variabilidad HRV"
        />

        {/* Temperatura */}
        <MetricCard
          title="Temperatura Cutánea"
          value={isLive ? `${vitals.temperature.toFixed(1)}°` : '--'}
          unit="°C"
          status="normal"
          statusText="Estable"
          icon="thermometer"
          color="#F59E0B"
          softColor="#FFFBEB"
          subtitle="Sensor Térmico"
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  seeMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  seeMoreText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  pulmonaryBannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#99F6E4',
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  pulmonaryBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  pulmonaryIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F0FDFA',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  pulmonaryTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  pulmonaryTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0D9488',
    letterSpacing: 0.5,
  },
  pulmonaryLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  pulmonaryCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  pulmonaryCardSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  pulmonaryArrowBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0FDFA',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
});
