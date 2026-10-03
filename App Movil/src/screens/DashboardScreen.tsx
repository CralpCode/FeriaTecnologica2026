import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
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

interface CardiacScanResult {
  avgBpm: number;
  avgSpo2: number;
  minSpo2: number;
  avgSystolic: number;
  avgDiastolic: number;
  avgHrv: number;
  avgStress: number;
  rhythmDiagnosis: string;
  oxygenDiagnosis: string;
  samplesCount: number;
  completedAt: string;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  onNavigateToAI,
  onNavigateToPulmonary,
  onNavigateToCharts,
}) => {
  const {
    vitals,
    aiReport,
    wakeDevice,
    startCardiacScan: startCardiacScanBle,
    startContinuousMode,
    powerOffDevice,
    stopScan,
  } = useVitals();

  const isLive = vitals.heartRate > 0;

  // Estado del Chequeo Cardíaco Acotado (20 segundos)
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'completed'>('idle');
  const [scanSecondsLeft, setScanSecondsLeft] = useState<number>(20);
  const [scanResult, setScanResult] = useState<CardiacScanResult | null>(null);
  const [samplesCountLive, setSamplesCountLive] = useState<number>(0);
  const scanSamplesRef = useRef<Array<{
    bpm: number;
    spo2: number;
    systolic: number;
    diastolic: number;
    stress: number;
    hrv: number;
  }>>([]);
  const scanTimerRef = useRef<any>(null);
  const isCountingDownRef = useRef(false);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Colección de muestras fisiológicas durante la ventana de 20s
  useEffect(() => {
    if (scanState === 'scanning' && vitals.heartRate > 0) {
      scanSamplesRef.current.push({
        bpm: vitals.heartRate,
        spo2: vitals.bloodOxygen,
        systolic: vitals.systolicPressure,
        diastolic: vitals.diastolicPressure,
        stress: vitals.stressLevel,
        hrv: vitals.hrv,
      });
      setSamplesCountLive(scanSamplesRef.current.length);
    }
  }, [vitals, scanState]);

  const finishCardiacScan = useCallback(() => {
    isCountingDownRef.current = false;
    const samples = scanSamplesRef.current;
    if (samples.length >= 2) {
      const avgBpm = Math.round(samples.reduce((a, b) => a + b.bpm, 0) / samples.length);
      const avgSpo2 = Number((samples.reduce((a, b) => a + b.spo2, 0) / samples.length).toFixed(1));
      const minSpo2 = Number(Math.min(...samples.map((s) => s.spo2)).toFixed(1));
      const avgSystolic = Math.round(samples.reduce((a, b) => a + b.systolic, 0) / samples.length);
      const avgDiastolic = Math.round(samples.reduce((a, b) => a + b.diastolic, 0) / samples.length);
      const avgHrv = Math.round(samples.reduce((a, b) => a + b.hrv, 0) / samples.length);
      const avgStress = Math.round(samples.reduce((a, b) => a + b.stress, 0) / samples.length);

      let rhythmDiagnosis = 'Ritmo Sinusal Estable y Normal';
      if (avgBpm > 105) rhythmDiagnosis = 'Taquicardia Sinusal Frecuente';
      else if (avgBpm < 52) rhythmDiagnosis = 'Bradicardia Sinusal Fisiológica';

      let oxygenDiagnosis = 'Saturación Tisular Óptima';
      if (avgSpo2 < 90) oxygenDiagnosis = 'Alerta: Hipoxemia Severa';
      else if (avgSpo2 < 95) oxygenDiagnosis = 'Saturación en Rango Límite';

      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

      setScanResult({
        avgBpm,
        avgSpo2,
        minSpo2,
        avgSystolic,
        avgDiastolic,
        avgHrv,
        avgStress,
        rhythmDiagnosis,
        oxygenDiagnosis,
        samplesCount: samples.length,
        completedAt: timeStr,
      });
    } else {
      setScanResult(null);
    }
    setScanState('completed');
  }, []);

  const startCardiacScan = useCallback(async (sendBleCommand: boolean = true) => {
    if (sendBleCommand) {
      try {
        await startCardiacScanBle();
      } catch {}
    }

    setScanResult(null);
    scanSamplesRef.current = [];
    setSamplesCountLive(0);
    setScanSecondsLeft(20);
    setScanState('scanning');
    isCountingDownRef.current = false;
    progressAnim.setValue(0);

    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }, [startCardiacScanBle, progressAnim]);

  // Inicio del conteo clínico de 20s SOLAMENTE tras fijar y calibrar el pulso cardíaco
  useEffect(() => {
    if (scanState !== 'scanning') return;

    const isPulseLocked = Boolean(vitals.cardiac_locked || (vitals.heartRate && vitals.heartRate > 0));

    if (isPulseLocked && !isCountingDownRef.current) {
      console.log('[Dashboard] ¡Pulso cardíaco fijado y calibrado! Iniciando conteo clínico de 20s...');
      isCountingDownRef.current = true;

      progressAnim.setValue(0);
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 20000,
        useNativeDriver: false,
      }).start();

      let seconds = 20;
      setScanSecondsLeft(20);

      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      scanTimerRef.current = setInterval(() => {
        seconds -= 1;
        setScanSecondsLeft(seconds);

        if (seconds <= 0) {
          if (scanTimerRef.current) clearInterval(scanTimerRef.current);
          scanTimerRef.current = null;
          isCountingDownRef.current = false;
          finishCardiacScan();
        }
      }, 1000);
    }
  }, [scanState, vitals.cardiac_locked, vitals.heartRate, progressAnim, finishCardiacScan]);

  // Sincronización reactiva si se presiona el botón físico K1 (Corazón) o combo K1+K2 (Infinito) en el ESP32
  useEffect(() => {
    if (vitals.scan_mode === 'cardiac' && scanState !== 'scanning') {
      console.log('[Dashboard] Botón físico K1 (Corazón) presionado en ESP32: Sincronizando interfaz...');
      startCardiacScan(false);
    } else if (vitals.scan_mode === 'none' && scanState === 'scanning' && isCountingDownRef.current) {
      // El ESP32 finalizó su protocolo clínico de 20s
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
      isCountingDownRef.current = false;
      finishCardiacScan();
    } else if (vitals.scan_mode === 'continuous') {
      // Si el ESP32 entró en Modo Infinito, cancelar cualquier conteo de 20s y poner interfaz en reposo activo
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
      isCountingDownRef.current = false;
      if (scanState !== 'idle') {
        setScanState('idle');
      }
    }
  }, [vitals.scan_mode, scanState, startCardiacScan, finishCardiacScan]);

  const cancelCardiacScan = useCallback(() => {
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    scanTimerRef.current = null;
    isCountingDownRef.current = false;
    progressAnim.stopAnimation();
    setScanState('idle');
    try {
      stopScan();
    } catch {}
  }, [progressAnim, stopScan]);

  useEffect(() => {
    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    };
  }, []);

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

      {/* MODO INFINITO / TIEMPO REAL CONTINUO ACTIVO */}
      {vitals.scan_mode === 'continuous' && scanState !== 'scanning' && (
        <View style={[styles.cardiacActionCard, styles.continuousActiveCard]}>
          <View style={styles.cardiacActionHeader}>
            <View style={styles.cardiacBadgeRow}>
              <View style={[styles.cardiacPill, { backgroundColor: '#EDE9FE' }]}>
                <Ionicons name="infinite" size={14} color="#7C3AED" />
                <Text style={[styles.cardiacPillText, { color: '#7C3AED' }]}>MODO INFINITO EN VIVO</Text>
              </View>
              <View style={styles.liveIndicatorDot} />
            </View>
            <Text style={styles.cardiacActionTitle}>Monitoreo Continuo en Tiempo Real</Text>
            <Text style={styles.cardiacActionSub}>
              El dispositivo está transmitiendo constantemente sin límite de tiempo (activado por K1+K2 en la pulsera o desde la app).
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <TouchableOpacity
              style={[styles.cardiacStartBtn, { flex: 1, backgroundColor: '#EF4444', marginTop: 0 }]}
              activeOpacity={0.85}
              onPress={() => powerOffDevice()}
            >
              <Ionicons name="power" size={18} color="#FFFFFF" />
              <Text style={styles.cardiacStartBtnText}>Apagar / Reposo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cardiacStartBtn, { flex: 1, backgroundColor: '#E11D48', marginTop: 0 }]}
              activeOpacity={0.85}
              onPress={() => startCardiacScan(true)}
            >
              <Ionicons name="timer-outline" size={18} color="#FFFFFF" />
              <Text style={styles.cardiacStartBtnText}>Chequeo (20s)</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 1b. BOTÓN Y CONTROL DEL CHEQUEO CARDÍACO POR TIEMPO (20 SEGUNDOS) */}
      {scanState === 'idle' && vitals.scan_mode !== 'continuous' && (
        <View style={styles.cardiacActionCard}>
          <View style={styles.cardiacActionHeader}>
            <View style={styles.cardiacBadgeRow}>
              <View style={styles.cardiacPill}>
                <Ionicons name="timer-outline" size={13} color="#E11D48" />
                <Text style={styles.cardiacPillText}>PROTOCOLO ESTANDARIZADO 20s</Text>
              </View>
              {vitals.power === 'standby' && (
                <View style={[styles.cardiacPill, { backgroundColor: '#F1F5F9', marginLeft: 6 }]}>
                  <Ionicons name="moon-outline" size={12} color="#64748B" />
                  <Text style={[styles.cardiacPillText, { color: '#64748B' }]}>HARDWARE EN REPOSO</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardiacActionTitle}>Chequeo Cardíaco Acotado (20s)</Text>
            <Text style={styles.cardiacActionSub}>
              Muestrea y promedia con rigor clínico ritmo cardíaco, SpO2 y tensión durante 20s. Actívalo con K1 (IO17) o inicia el Modo Infinito pulsando K1 y K2 simultáneamente.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.cardiacStartBtn}
            activeOpacity={0.85}
            onPress={() => startCardiacScan(true)}
          >
            <MaterialCommunityIcons name="heart-pulse" size={22} color="#FFFFFF" />
            <Text style={styles.cardiacStartBtnText}>Iniciar Chequeo Cardíaco (20s)</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <TouchableOpacity
              style={[styles.secondaryActionBtn, { flex: 1.2 }]}
              activeOpacity={0.85}
              onPress={() => {
                setScanState('idle');
                setScanResult(null);
                startContinuousMode();
              }}
            >
              <Ionicons name="infinite" size={16} color="#7C3AED" />
              <Text style={styles.secondaryActionBtnText}>Modo Infinito</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryActionBtn, { flex: 1 }]}
              activeOpacity={0.85}
              onPress={() => powerOffDevice()}
            >
              <Ionicons name="power" size={16} color="#64748B" />
              <Text style={[styles.secondaryActionBtnText, { color: '#64748B' }]}>Apagar Todo</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {scanState === 'scanning' && (
        <View style={[styles.cardiacActionCard, styles.cardiacScanningCard]}>
          <View style={styles.cardiacScanHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color="#E11D48" />
              <Text style={styles.cardiacScanningTitle}>
                {isCountingDownRef.current || vitals.heartRate > 0
                  ? 'Adquiriendo Constantes Clínicas...'
                  : 'Calibrando Sensor Cardíaco...'}
              </Text>
            </View>
            <View style={styles.countdownBadge}>
              <Text style={styles.countdownBadgeText}>
                {isCountingDownRef.current || vitals.heartRate > 0
                  ? `${scanSecondsLeft}s restantes`
                  : '20s (Esperando pulso...)'}
              </Text>
            </View>
          </View>

          {/* Barra de progreso */}
          <View style={styles.progressBarTrack}>
            <Animated.View
              style={[
                styles.progressBarFill,
                {
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>

          <View style={styles.scanningStatusRow}>
            <Ionicons
              name={vitals.heartRate > 0 ? "checkmark-circle" : "finger-print"}
              size={16}
              color={vitals.heartRate > 0 ? "#10B981" : "#F59E0B"}
            />
            <Text style={styles.scanningStatusText} numberOfLines={1}>
              {vitals.heartRate > 0
                ? `Pulso fijado: ${vitals.heartRate} LPM (${samplesCountLive} muestras)`
                : (vitals.finger
                    ? 'Dedo detectado. Calibrando pulso y filtro óptico...'
                    : 'Coloque el dedo firmemente sobre el sensor MAX30102...')}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.cancelScanBtn}
            onPress={cancelCardiacScan}
          >
            <Text style={styles.cancelScanBtnText}>Cancelar Chequeo</Text>
          </TouchableOpacity>
        </View>
      )}

      {scanState === 'completed' && scanResult && (
        <View style={[styles.cardiacActionCard, styles.cardiacSummaryCard]}>
          <View style={styles.cardiacSummaryHeader}>
            <View style={styles.summaryTitleRow}>
              <View style={styles.checkCircle}>
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.summaryTitle}>Chequeo Cardíaco Concluido</Text>
                <Text style={styles.summaryTimestamp}>Finalizado a las {scanResult.completedAt} ({scanResult.samplesCount} muestras)</Text>
              </View>
            </View>
            <View style={[styles.diagnosisBadge, { backgroundColor: scanResult.avgBpm > 105 || scanResult.avgSpo2 < 90 ? '#FEF2F2' : '#F0FDF4' }]}>
              <Text style={[styles.diagnosisBadgeText, { color: scanResult.avgBpm > 105 || scanResult.avgSpo2 < 90 ? '#EF4444' : '#15803D' }]}>
                {scanResult.rhythmDiagnosis}
              </Text>
            </View>
          </View>

          {/* Grid de Métricas Promediadas */}
          <View style={styles.summaryGrid}>
            <View style={styles.summaryMetricItem}>
              <Text style={styles.summaryMetricLabel}>Frecuencia Media</Text>
              <Text style={styles.summaryMetricVal}>{scanResult.avgBpm} <Text style={styles.summaryMetricUnit}>LPM</Text></Text>
              <Text style={styles.summaryMetricSub}>{scanResult.avgBpm >= 60 && scanResult.avgBpm <= 100 ? 'Rango Normal' : 'Fuera de rango'}</Text>
            </View>
            <View style={styles.summaryMetricItem}>
              <Text style={styles.summaryMetricLabel}>Saturación SpO2</Text>
              <Text style={styles.summaryMetricVal}>{scanResult.avgSpo2} <Text style={styles.summaryMetricUnit}>%</Text></Text>
              <Text style={styles.summaryMetricSub}>Mínimo: {scanResult.minSpo2}%</Text>
            </View>
            <View style={styles.summaryMetricItem}>
              <Text style={styles.summaryMetricLabel}>Presión Arterial</Text>
              <Text style={styles.summaryMetricVal}>{scanResult.avgSystolic}/{scanResult.avgDiastolic} <Text style={styles.summaryMetricUnit}>mmHg</Text></Text>
              <Text style={styles.summaryMetricSub}>Estimación PTT</Text>
            </View>
            <View style={styles.summaryMetricItem}>
              <Text style={styles.summaryMetricLabel}>HRV / Estrés</Text>
              <Text style={styles.summaryMetricVal}>{scanResult.avgHrv} <Text style={styles.summaryMetricUnit}>ms</Text></Text>
              <Text style={styles.summaryMetricSub}>Estrés: {scanResult.avgStress}/100</Text>
            </View>
          </View>

          <View style={styles.summaryActionsRow}>
            <TouchableOpacity
              style={styles.repeatBtn}
              activeOpacity={0.85}
              onPress={() => startCardiacScan(true)}
            >
              <Ionicons name="refresh" size={16} color="#FFFFFF" />
              <Text style={styles.repeatBtnText}>Repetir Chequeo (20s)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.continuousBtn}
              activeOpacity={0.85}
              onPress={() => {
                setScanState('idle');
                setScanResult(null);
                startContinuousMode();
              }}
            >
              <Text style={styles.continuousBtnText}>Modo Infinito</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {scanState === 'completed' && !scanResult && (
        <View style={[styles.cardiacActionCard, styles.cardiacWarningCard]}>
          <View style={styles.warningHeaderRow}>
            <Ionicons name="warning" size={24} color="#D97706" />
            <View style={{ flex: 1 }}>
              <Text style={styles.warningTitle}>Muestras Insuficientes</Text>
              <Text style={styles.warningSub}>
                No se detectó el dedo en el sensor MAX30102 durante los 20 segundos de escaneo.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.retryBtn}
            activeOpacity={0.85}
            onPress={() => startCardiacScan(true)}
          >
            <Ionicons name="refresh" size={16} color="#FFFFFF" />
            <Text style={styles.retryBtnText}>Reintentar Chequeo Cardíaco (20s)</Text>
          </TouchableOpacity>
        </View>
      )}

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
              <Text style={styles.pulmonaryCardTitle} numberOfLines={1}>Auscultación Pulmonar Digital</Text>
              <Text style={styles.pulmonaryCardSub} numberOfLines={1}>
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
    minHeight: 76,
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
    height: 16,
    overflow: 'hidden',
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
  // Estilos del Chequeo Cardíaco Acotado (20s)
  cardiacActionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#FFE4E6',
    shadowColor: '#E11D48',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardiacScanningCard: {
    borderColor: '#FDA4AF',
    backgroundColor: '#FFF1F2',
  },
  cardiacSummaryCard: {
    borderColor: '#BBF7D0',
    backgroundColor: '#FFFFFF',
  },
  cardiacWarningCard: {
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
  },
  cardiacActionHeader: {
    marginBottom: 12,
  },
  cardiacBadgeRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  cardiacPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF1F2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  cardiacPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#E11D48',
    letterSpacing: 0.5,
  },
  cardiacActionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  cardiacActionSub: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
    marginTop: 3,
  },
  cardiacStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#E11D48',
    paddingVertical: 13,
    borderRadius: 12,
    shadowColor: '#E11D48',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  cardiacStartBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  cardiacScanHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardiacScanningTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#BE123C',
  },
  countdownBadge: {
    backgroundColor: '#E11D48',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  countdownBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#FECDD3',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#E11D48',
    borderRadius: 4,
  },
  scanningStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  scanningStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    flex: 1,
  },
  cancelScanBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#FFE4E6',
  },
  cancelScanBtnText: {
    color: '#BE123C',
    fontSize: 12,
    fontWeight: '700',
  },
  cardiacSummaryHeader: {
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  summaryTimestamp: {
    fontSize: 11,
    color: '#64748B',
  },
  diagnosisBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  diagnosisBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  summaryMetricItem: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  summaryMetricLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  summaryMetricVal: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginVertical: 2,
  },
  summaryMetricUnit: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  summaryMetricSub: {
    fontSize: 10,
    color: '#64748B',
  },
  summaryActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  repeatBtn: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#E11D48',
    paddingVertical: 10,
    borderRadius: 10,
  },
  repeatBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  continuousBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    paddingVertical: 10,
    borderRadius: 10,
  },
  continuousBtnText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
  warningHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#92400E',
  },
  warningSub: {
    fontSize: 12,
    color: '#78350F',
    marginTop: 2,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#D97706',
    paddingVertical: 11,
    borderRadius: 10,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  continuousActiveCard: {
    borderColor: '#C4B5FD',
    backgroundColor: '#FAF5FF',
  },
  liveIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginLeft: 6,
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 9,
    borderRadius: 10,
  },
  secondaryActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7C3AED',
  },
});
