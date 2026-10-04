import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';
import { MetricCard } from '../components/MetricCard';
import { HospitalEcgMonitor } from '../components/HospitalEcgMonitor';
import { AIInsightCard } from '../components/AIInsightCard';
import { TriageCard } from '../components/TriageCard';
import { measurementValidity } from '../services/measurementQuality';
import { useClinical } from '../context/ClinicalContext';

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

  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const valid = measurementValidity(vitals, now);
  const isLive = valid.heartRate;
  const audioAvailable = vitals.source === 'real' && vitals.audioUnit === 'dBFS'
    && Number.isFinite(vitals.audio_rms) && vitals.audio_rms < 0 && now - Date.parse(vitals.timestamp) < 10000;

  const getHeartStatus = () => ({ text: valid.heartRate ? 'Pulso medido; interpretar con edad y reposo' : 'Sin lectura válida', status: 'insufficient_data' });
  const getOxygenStatus = () => ({ text: valid.bloodOxygen ? 'Estimación calibrada' : 'No disponible sin calibración', status: 'insufficient_data' });
  const getHrvStatus = () => ({ text: 'No disponible', status: 'insufficient_data' });
  const getStressStatus = () => ({ text: 'No disponible', status: 'insufficient_data' });
  const getAudioStatus = () => ({ text: audioAvailable ? 'Nivel digital; no presión sonora' : 'Sin lectura de audio', status: 'insufficient_data' });

  const heartStatus = getHeartStatus();
  const oxygenStatus = getOxygenStatus();
  const hrvStatus = getHrvStatus();
  const stressStatus = getStressStatus();
  const audioStatus = getAudioStatus();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {connectedType === 'demo_icbhi' && (
        <View style={styles.demoBanner}>
          <Ionicons name="flask-outline" size={16} color="#6B21A8" />
          <Text style={styles.demoBannerText}>
            Modo demostración: audio real de ICBHI 2017; el pulso y la SpO2 son datos de ejemplo.
          </Text>
        </View>
      )}

      {/* 0. SEMÁFORO DE TRIAJE (SpO2 + pulso + corazón + pulmón) */}
      <TriageCard triage={triage} />

      {/* 1. MONITOR DE PULSO (animación al ritmo medido) */}
      <HospitalEcgMonitor
        heartRate={vitals.heartRate}
        bloodOxygen={vitals.bloodOxygen}
        audioDecibels={0}
        isAlert={heartStatus.status === 'critical'}
      />

      {/* 2. TARJETA DE ANÁLISIS MÉDICO IA */}
      <TouchableOpacity activeOpacity={0.9} onPress={onNavigateToAI}>
        <AIInsightCard report={aiReport} onAskAI={onNavigateToAI} />
      </TouchableOpacity>

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
          value={valid.bloodOxygen ? vitals.bloodOxygen.toFixed(1) : '--'}
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
          value="--"
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
          value={audioAvailable ? vitals.audio_rms.toFixed(1) : '--'}
          unit="dBFS"
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
          value="--"
          unit="/100"
          status={stressStatus.status as any}
          statusText={stressStatus.text}
          icon="brain"
          color={Colors.stress}
          softColor="#FEF3C7"
          subtitle="Estimación no validada"
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
