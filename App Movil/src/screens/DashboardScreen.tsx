import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';
import { MetricCard } from '../components/MetricCard';
import { HospitalEcgMonitor } from '../components/HospitalEcgMonitor';
import { AIInsightCard } from '../components/AIInsightCard';
import { TriageCard } from '../components/TriageCard';
import { useClinical } from '../context/ClinicalContext';
import { Centered, Columns } from '../components/ResponsiveContainer';

interface DashboardScreenProps {
  onNavigateToAI: () => void;
  onNavigateToCharts: () => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  onNavigateToAI,
  onNavigateToCharts,
}) => {
  const { vitals, aiReport, connectedType } = useVitals();
  const { triage } = useClinical();

  const isLive = vitals.heartRate > 0;

  const getHeartStatus = () => {
    if (!isLive) return { text: 'En Espera', status: 'normal' };
    if (vitals.heartRate > 120) return { text: 'Muy alto', status: 'critical' };
    if (vitals.heartRate < 45) return { text: 'Muy bajo', status: 'critical' };
    if (vitals.heartRate > 100 || vitals.heartRate < 55) return { text: 'Fuera de rango', status: 'caution' };
    return { text: 'En rango', status: 'normal' };
  };

  const getOxygenStatus = () => {
    if (!isLive) return { text: 'En Espera', status: 'normal' };
    if (vitals.bloodOxygen <= 0) return { text: 'Sin lectura', status: 'normal' };
    if (vitals.bloodOxygen < 90) return { text: 'Muy baja (<90%)', status: 'critical' };
    if (vitals.bloodOxygen < 94) return { text: 'Reducida', status: 'caution' };
    return { text: 'En rango', status: 'normal' };
  };

  const getHrvStatus = () => {
    if (!isLive || !vitals.hrv) return { text: 'En Espera', status: 'normal' };
    return { text: 'Medido', status: 'normal' };
  };

  const getStressStatus = () => {
    if (!isLive) return { text: 'En Espera', status: 'normal' };
    return { text: 'Experimental', status: 'normal' };
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
  const hrvStatus = getHrvStatus();
  const stressStatus = getStressStatus();
  const audioStatus = getAudioStatus();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Centered>
      {connectedType === 'demo_icbhi' && (
        <View style={styles.demoBanner}>
          <Ionicons name="flask-outline" size={16} color="#6B21A8" />
          <Text style={styles.demoBannerText}>
            Modo demostración: audio real de ICBHI 2017; el pulso y la SpO2 son datos de ejemplo.
          </Text>
        </View>
      )}

      <Columns
        leftWeight={1.15}
        left={
          <View>
      {/* 0. SEMÁFORO DE TRIAJE (SpO2 + pulso + corazón + pulmón) */}
      <TriageCard triage={triage} />

      {/* 1. MONITOR DE PULSO (animación al ritmo medido) */}
      <HospitalEcgMonitor
        heartRate={vitals.heartRate}
        bloodOxygen={vitals.bloodOxygen}
        audioDecibels={vitals.audio_rms || 0}
        isAlert={heartStatus.status === 'critical'}
      />

      {/* 2. TARJETA DE ANÁLISIS MÉDICO IA */}
      <TouchableOpacity activeOpacity={0.9} onPress={onNavigateToAI}>
        <AIInsightCard report={aiReport} onAskAI={onNavigateToAI} />
      </TouchableOpacity>
          </View>
        }
        right={
          <View>

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
          value={isLive && vitals.bloodOxygen > 0 ? vitals.bloodOxygen.toFixed(1) : '--'}
          unit="% SpO2"
          status={oxygenStatus.status as any}
          statusText={oxygenStatus.text}
          icon="water-percent"
          color={Colors.oxygen}
          softColor="#E0F2FE"
          subtitle="Oximetría de pulso"
        />

        {/* Variabilidad de la frecuencia cardíaca */}
        <MetricCard
          title="Variabilidad (HRV)"
          value={isLive && vitals.hrv ? vitals.hrv : '--'}
          unit="ms"
          status={hrvStatus.status as any}
          statusText={hrvStatus.text}
          icon="heart-flash"
          color={Colors.pressure}
          softColor="#EDE9FE"
          subtitle="Intervalo entre latidos"
        />

        {/* Micrófono Bio-Acústico */}
        <MetricCard
          title="Micrófono Bio-Acústico"
          value={isLive && vitals.audio_rms ? vitals.audio_rms.toFixed(1) : '--'}
          unit="dB"
          status={audioStatus.status as any}
          statusText={audioStatus.text}
          icon="microphone"
          color="#6366F1"
          softColor="#EEF2FF"
          subtitle="Audio I2S INMP441"
        />

        {/* Estrés Autonómico */}
        <MetricCard
          title="Índice de Estrés"
          value={isLive ? vitals.stressLevel : '--'}
          unit="/100"
          status={stressStatus.status as any}
          statusText={stressStatus.text}
          icon="brain"
          color={Colors.stress}
          softColor="#FEF3C7"
          subtitle="Estimación no validada"
        />

      </View>
          </View>
        }
      />
      </Centered>
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
  demoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FAF5FF',
    borderColor: '#C4B5FD',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  demoBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#6B21A8',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
});
