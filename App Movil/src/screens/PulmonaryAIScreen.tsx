import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';
import { apiService } from '../services/api';
import { PulmonaryReport } from '../types/vitals';

export const PulmonaryAIScreen: React.FC = () => {
  const { vitals, isBackendOnline } = useVitals();

  const [report, setReport] = useState<PulmonaryReport | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalyzedTime, setLastAnalyzedTime] = useState<string>('Recién iniciado');

  // Protocolo Guiado de Auscultación (10 segundos)
  const [isProtocolRunning, setIsProtocolRunning] = useState(false);
  const [protocolSecondsLeft, setProtocolSecondsLeft] = useState(10);
  const [protocolStage, setProtocolStage] = useState<'idle' | 'inhale' | 'hold' | 'exhale' | 'classify'>('idle');

  // Animaciones para pulsación de onda y pulmones
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const lungScale = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<any>(null);

  // Foco anatómico seleccionado para guía didáctica
  const [selectedFocus, setSelectedFocus] = useState<'tracheal' | 'apical' | 'basal'>('apical');

  // Referencia a vitals para no recrear runAnalysis en cada paquete entrante de telemetría
  const vitalsRef = useRef(vitals);
  useEffect(() => {
    vitalsRef.current = vitals;
  }, [vitals]);

  // Cargar análisis médico de forma controlada y sin parpadeos
  const runAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    try {
      const res = await apiService.getPulmonaryAnalysis(vitalsRef.current);
      setReport(res);
      const now = new Date();
      setLastAnalyzedTime(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`);
    } catch (err) {
      console.warn('Error al analizar fonometría pulmonar:', err);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  useEffect(() => {
    runAnalysis();
    // Re-evaluar automáticamente cada 10 segundos para no alterar la pantalla constantemente
    const autoInterval = setInterval(() => {
      if (!isProtocolRunning) {
        runAnalysis();
      }
    }, 10000);
    return () => clearInterval(autoInterval);
  }, [runAnalysis, isProtocolRunning]);

  // Animación del medidor de pulso/onda
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  // Manejador del Protocolo de Auscultación de 10 Segundos
  const startAuscultationProtocol = () => {
    if (isProtocolRunning) return;
    setIsProtocolRunning(true);
    setProtocolSecondsLeft(10);
    setProtocolStage('inhale');

    // Animación de pulmones inflando
    Animated.timing(lungScale, {
      toValue: 1.25,
      duration: 3000,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();

    let counter = 10;
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      counter -= 1;
      setProtocolSecondsLeft(counter);

      if (counter > 7) {
        setProtocolStage('inhale');
      } else if (counter > 5) {
        setProtocolStage('hold');
      } else if (counter > 2) {
        setProtocolStage('exhale');
        // Pulmones desinflando
        Animated.timing(lungScale, {
          toValue: 0.95,
          duration: 3000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }).start();
      } else if (counter > 0) {
        setProtocolStage('classify');
      } else {
        // Finalizado
        if (timerRef.current) clearInterval(timerRef.current);
        setIsProtocolRunning(false);
        setProtocolStage('idle');
        Animated.timing(lungScale, {
          toValue: 1.0,
          duration: 400,
          useNativeDriver: true,
        }).start();
        runAnalysis();
      }
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Suavizado EMA para visualización estable de decibelios y picos (sin sacudidas en pantalla)
  const [smoothedRms, setSmoothedRms] = useState(vitals.audio_rms || 0);
  const [smoothedPeak, setSmoothedPeak] = useState(vitals.audio_peak || 0);
  const lastRmsUpdateRef = useRef(Date.now());

  useEffect(() => {
    const rawRms = vitals.audio_rms || 0;
    const rawPeak = vitals.audio_peak || 0;
    const now = Date.now();

    // Limitar la cadencia de actualización visual a máx 1 vez cada 180ms
    if (now - lastRmsUpdateRef.current < 180) {
      return;
    }
    lastRmsUpdateRef.current = now;

    setSmoothedRms((prev) => {
      // Zona muerta (deadband) si el cambio de ruido es mínimo (< 0.4 dB) para no mover números
      if (Math.abs(prev - rawRms) < 0.4) return prev;
      return Math.round((prev * 0.65 + rawRms * 0.35) * 10) / 10;
    });

    setSmoothedPeak((prev) => {
      if (Math.abs(prev - rawPeak) < 250) return prev;
      return Math.round(prev * 0.6 + rawPeak * 0.4);
    });
  }, [vitals.audio_rms, vitals.audio_peak]);

  // Interpretación cualitativa de intensidad sonora con histeresis para evitar oscilación de textos
  const getAcousticInterpretation = () => {
    const r = smoothedRms;
    if (r < 25) return { label: 'Silencio / Reposo', color: '#64748B', desc: 'Murmullo apenas perceptible' };
    if (r < 50) return { label: 'Flujo Normal', color: '#10B981', desc: 'Ventilación alveolar limpia' };
    if (r < 66) return { label: 'Flujo Aumentado', color: '#0284C7', desc: 'Sonido bronquial fisiológico' };
    if (r < 78) return { label: 'Turbulencia Elevada', color: '#F59E0B', desc: 'Posible fricción o sibilancia' };
    return { label: 'Pico Intenso / Tos', color: '#EF4444', desc: 'Evento paroxístico o choque de aire' };
  };

  const acousticStatus = getAcousticInterpretation();

  // Datos de probabilidades con colores clínicos
  const probabilities = report?.probabilities || {
    normal: 88,
    asthma: 5,
    pneumonia: 3,
    copd: 2,
    bronchitis: 2,
  };

  const pathologies = [
    {
      key: 'normal',
      name: 'Patrón Eupneico (Normal)',
      sub: 'Murmullo vesicular limpio sin ruidos agregados',
      pct: probabilities.normal,
      barColor: '#10B981',
      bgBar: '#D1FAE5',
      icon: 'check-decagram',
    },
    {
      key: 'asthma',
      name: 'Asma / Sibilancias',
      sub: 'Sonidos sibilantes de alta frecuencia o broncoespasmo',
      pct: probabilities.asthma,
      barColor: '#F59E0B',
      bgBar: '#FEF3C7',
      icon: 'weather-windy',
    },
    {
      key: 'pneumonia',
      name: 'Neumonía / Infiltrados',
      sub: 'Estertores crepitantes o consolidación con hipoxemia',
      pct: probabilities.pneumonia,
      barColor: '#EF4444',
      bgBar: '#FEE2E2',
      icon: 'virus-outline',
    },
    {
      key: 'copd',
      name: 'EPOC / Obstrucción Crónica',
      sub: 'Espiración prolongada y atenuación vesicular',
      pct: probabilities.copd,
      barColor: '#8B5CF6',
      bgBar: '#EDE9FE',
      icon: 'lungs',
    },
    {
      key: 'bronchitis',
      name: 'Bronquitis / Tos Paroxística',
      sub: 'Picos acústicos abruptos y secreción traqueobronquial',
      pct: probabilities.bronchitis,
      barColor: '#0284C7',
      bgBar: '#E0F2FE',
      icon: 'waveform',
    },
  ];

  // Cálculo de nivel VU dinámico (0 a 12 barras) con valor suavizado
  const vuBarsCount = 12;
  const activeBars = Math.min(vuBarsCount, Math.max(1, Math.round((smoothedRms / 85) * vuBarsCount)));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* 1. HERO BANNER: MÓDULO INTELIGENCIA ARTIFICIAL PULMONAR */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <View style={styles.heroIconBadge}>
            <MaterialCommunityIcons name="lungs" size={26} color="#0D9488" />
          </View>
          <View style={styles.heroTitleContainer}>
            <View style={styles.heroBadgeRow}>
              <View style={styles.aiPill}>
                <MaterialCommunityIcons name="chip" size={12} color="#0D9488" />
                <Text style={styles.aiPillText}>IA BIO-ACÚSTICA INMP441</Text>
              </View>
              <View style={[styles.networkPill, isBackendOnline ? styles.networkPillOnline : styles.networkPillOffline]}>
                <Text style={[styles.networkPillText, { color: isBackendOnline ? '#15803D' : '#64748B' }]}>
                  {isBackendOnline ? 'NUBE CLOUDFLARE' : 'MOTOR OFFLINE'}
                </Text>
              </View>
            </View>
            <Text style={styles.heroTitle}>Auscultación Neumológica IA</Text>
            <Text style={styles.heroSubtitle}>
              Análisis fonomecánico del micrófono digital correlacionado con SpO2 y frecuencia cardíaca.
            </Text>
          </View>
        </View>

        {/* HEALTH SCORE PULMONAR & DIAGNÓSTICO PRINCIPAL */}
        <View style={styles.scoreContainer}>
          <View style={styles.scoreCircle}>
            <Text style={styles.scoreNumber}>{report ? report.health_score : '--'}</Text>
            <Text style={styles.scoreOutOf}>/100</Text>
            <Text style={styles.scoreLabel}>Salud Pulmonar</Text>
          </View>

          <View style={styles.diagnosticSummary}>
            <Text style={styles.diagnosticLabel}>Diagnóstico IA Estimado:</Text>
            <Text style={styles.diagnosticTitle} numberOfLines={2}>
              {report?.primary_prediction || 'Evaluando patrón respiratorio...'}
            </Text>
            <View style={styles.diagnosticMetaRow}>
              <View style={styles.confidenceBadge}>
                <Ionicons name="shield-checkmark" size={13} color="#0D9488" />
                <Text style={styles.confidenceText}>Confianza {report?.confidence || 94}%</Text>
              </View>
              <Text style={styles.lastSyncText}>Sync: {lastAnalyzedTime}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 2. VU-METER Y VISUALIZADOR ACÚSTICO EN VIVO */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="microphone-variant" size={20} color="#0D9488" />
            <Text style={styles.cardTitle}>Bio-Acústica en Tiempo Real (I2S)</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: `${acousticStatus.color}20` }]}>
            <View style={[styles.statusDot, { backgroundColor: acousticStatus.color }]} />
            <Text style={[styles.statusBadgeText, { color: acousticStatus.color }]} numberOfLines={1}>
              {acousticStatus.label}
            </Text>
          </View>
        </View>

        <View style={styles.acousticMetricsGrid}>
          <View style={styles.acousticMetricItem}>
            <Text style={styles.acousticMetricLabel}>Intensidad Sonora</Text>
            <View style={styles.acousticValueRow}>
              <Text style={styles.acousticMetricValue}>{smoothedRms.toFixed(1)}</Text>
              <Text style={styles.acousticMetricUnit}>dB RMS</Text>
            </View>
            <Text style={styles.acousticMetricSub} numberOfLines={1}>{acousticStatus.desc}</Text>
          </View>

          <View style={styles.acousticMetricItem}>
            <Text style={styles.acousticMetricLabel}>Amplitud Pico</Text>
            <View style={styles.acousticValueRow}>
              <Text style={styles.acousticMetricValue}>{smoothedPeak.toLocaleString()}</Text>
              <Text style={styles.acousticMetricUnit}>raw</Text>
            </View>
            <Text style={styles.acousticMetricSub}>Microfono INMP441</Text>
          </View>
        </View>

        {/* BARRAS DINÁMICAS VU-METER */}
        <View style={styles.vuMeterContainer}>
          <View style={styles.vuBarsRow}>
            {Array.from({ length: vuBarsCount }).map((_, idx) => {
              const isBarActive = idx < activeBars;
              // Gradiente de color según la altura: Verde (0-6) -> Amarillo (7-9) -> Rojo (10-11)
              let barColor = '#10B981';
              if (idx >= 9) barColor = '#EF4444';
              else if (idx >= 6) barColor = '#F59E0B';

              return (
                <View
                  key={idx}
                  style={[
                    styles.vuBar,
                    {
                      height: 12 + idx * 3.2,
                      backgroundColor: isBarActive ? barColor : '#E2E8F0',
                      opacity: isBarActive ? 1 : 0.45,
                    },
                  ]}
                />
              );
            })}
          </View>
          <View style={styles.vuScaleRow}>
            <Text style={styles.vuScaleLabel}>0 dB (Silencio)</Text>
            <Text style={styles.vuScaleLabel}>45 dB (Respiración)</Text>
            <Text style={styles.vuScaleLabel}>90 dB (Tos/Pico)</Text>
          </View>
        </View>
      </View>

      {/* 3. PROTOCOLO DE AUSCULTACIÓN GUIADA DE 10 SEGUNDOS */}
      <View style={[styles.card, styles.protocolCard]}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="timer-sand" size={20} color="#0D9488" />
            <Text style={styles.cardTitle}>Protocolo Clínico de Auscultación</Text>
          </View>
          {isProtocolRunning && (
            <View style={styles.timerBadge}>
              <Text style={styles.timerBadgeText}>{protocolSecondsLeft}s restantes</Text>
            </View>
          )}
        </View>

        <Text style={styles.protocolDesc}>
          Prueba estandarizada de 10 segundos para aislar ruidos adventicios (sibilancias, crepitantes o estertores).
        </Text>

        {/* Escenario Activo Durante la Prueba */}
        {isProtocolRunning ? (
          <View style={styles.protocolActiveContainer}>
            <Animated.View style={[styles.lungAnimationWrapper, { transform: [{ scale: lungScale }] }]}>
              <MaterialCommunityIcons
                name="lungs"
                size={70}
                color={
                  protocolStage === 'inhale'
                    ? '#0284C7'
                    : protocolStage === 'hold'
                    ? '#F59E0B'
                    : protocolStage === 'exhale'
                    ? '#10B981'
                    : '#0D9488'
                }
              />
            </Animated.View>

            <View style={styles.stageInstructions}>
              {protocolStage === 'inhale' && (
                <>
                  <Text style={[styles.stageTitle, { color: '#0284C7' }]}>1. INSPIRACIÓN PROFUNDA</Text>
                  <Text style={styles.stageSubtitle}>Inhale aire lenta y profundamente llenando sus pulmones.</Text>
                </>
              )}
              {protocolStage === 'hold' && (
                <>
                  <Text style={[styles.stageTitle, { color: '#F59E0B' }]}>2. MANTENGA EL AIRE</Text>
                  <Text style={styles.stageSubtitle}>Sostenga la respiración brevemente sin toser.</Text>
                </>
              )}
              {protocolStage === 'exhale' && (
                <>
                  <Text style={[styles.stageTitle, { color: '#10B981' }]}>3. ESPIRACIÓN CONTROLADA</Text>
                  <Text style={styles.stageSubtitle}>Exhale suave y prolongadamente cerca del micrófono.</Text>
                </>
              )}
              {protocolStage === 'classify' && (
                <>
                  <Text style={[styles.stageTitle, { color: '#0D9488' }]}>4. PROCESANDO CON IA</Text>
                  <Text style={styles.stageSubtitle}>Correlacionando espectro de audio, SpO2 y frecuencia cardíaca...</Text>
                </>
              )}
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.startProtocolBtn}
            activeOpacity={0.8}
            onPress={startAuscultationProtocol}
          >
            <MaterialCommunityIcons name="play-circle-outline" size={22} color="#FFFFFF" />
            <Text style={styles.startProtocolBtnText}>Iniciar Test Guiado (10s)</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 4. DESGLOSE PREDICTIVO DE ENFERMEDADES PULMONARES (IA) */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="chart-box-outline" size={20} color="#0D9488" />
            <Text style={styles.cardTitle}>Desglose Predictivo de Patologías</Text>
          </View>
          <TouchableOpacity
            onPress={runAnalysis}
            disabled={isAnalyzing}
            style={styles.refreshPill}
          >
            {isAnalyzing ? (
              <ActivityIndicator size="small" color="#0D9488" />
            ) : (
              <>
                <Ionicons name="refresh" size={13} color="#0D9488" />
                <Text style={styles.refreshPillText}>Recalcular</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.pathologyIntro}>
          Probabilidades computadas mediante redes neuronales de clasificación acústica y biomarcadores multimodales:
        </Text>

        <View style={styles.pathologyList}>
          {pathologies.map((item) => (
            <View key={item.key} style={styles.pathologyCard}>
              <View style={styles.pathologyHeaderRow}>
                <View style={styles.pathologyTitleGroup}>
                  <MaterialCommunityIcons name={item.icon as any} size={18} color={item.barColor} />
                  <View style={{ marginLeft: 8 }}>
                    <Text style={styles.pathologyName}>{item.name}</Text>
                    <Text style={styles.pathologySub}>{item.sub}</Text>
                  </View>
                </View>
                <View style={[styles.probabilityBadge, { backgroundColor: item.bgBar }]}>
                  <Text style={[styles.probabilityText, { color: item.barColor }]}>
                    {item.pct.toFixed(1)}%
                  </Text>
                </View>
              </View>

              {/* Barra de progreso */}
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.min(100, Math.max(3, item.pct))}%`,
                      backgroundColor: item.barColor,
                    },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* 5. CORRELACIÓN MULTIMODAL DE SENSORES */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="layers-outline" size={20} color="#0D9488" />
            <Text style={styles.cardTitle}>Biomarcadores Pulmonares Asociados</Text>
          </View>
        </View>

        <View style={styles.sensorGrid}>
          <View style={styles.sensorCard}>
            <View style={[styles.sensorIconCircle, { backgroundColor: '#E0F2FE' }]}>
              <Ionicons name="water" size={18} color="#0284C7" />
            </View>
            <Text style={styles.sensorLabel}>SpO2 Pulmonar</Text>
            <Text style={styles.sensorValue}>
              {vitals.bloodOxygen > 0 ? `${vitals.bloodOxygen.toFixed(1)}%` : '--'}
            </Text>
            <Text style={styles.sensorStatus}>
              {vitals.bloodOxygen >= 95 ? 'Oxigenación Normal' : vitals.bloodOxygen > 0 ? 'Hipoxemia Detectada' : 'En espera'}
            </Text>
          </View>

          <View style={styles.sensorCard}>
            <View style={[styles.sensorIconCircle, { backgroundColor: '#FFE4E6' }]}>
              <Ionicons name="heart" size={18} color="#E11D48" />
            </View>
            <Text style={styles.sensorLabel}>Esfuerzo Cardíaco</Text>
            <Text style={styles.sensorValue}>
              {vitals.heartRate > 0 ? `${vitals.heartRate} LPM` : '--'}
            </Text>
            <Text style={styles.sensorStatus}>
              {vitals.heartRate > 100 ? 'Taquicardia Reactiva' : vitals.heartRate > 0 ? 'Ritmo Estable' : 'En espera'}
            </Text>
          </View>

          <View style={styles.sensorCard}>
            <View style={[styles.sensorIconCircle, { backgroundColor: '#EDE9FE' }]}>
              <MaterialCommunityIcons name="waveform" size={18} color="#7C3AED" />
            </View>
            <Text style={styles.sensorLabel}>Audio I2S RMS</Text>
            <Text style={styles.sensorValue}>{smoothedRms.toFixed(1)} dB</Text>
            <Text style={styles.sensorStatus}>INMP441 Digital</Text>
          </View>

          <View style={styles.sensorCard}>
            <View style={[styles.sensorIconCircle, { backgroundColor: '#FEF3C7' }]}>
              <MaterialCommunityIcons name="speedometer" size={18} color="#D97706" />
            </View>
            <Text style={styles.sensorLabel}>Tensión PTT</Text>
            <Text style={styles.sensorValue}>
              {vitals.systolicPressure > 0 ? `${vitals.systolicPressure}/${vitals.diastolicPressure}` : '--/--'}
            </Text>
            <Text style={styles.sensorStatus}>mmHg</Text>
          </View>
        </View>
      </View>

      {/* 6. GUÍA DIDÁCTICA: POSICIONAMIENTO ANATÓMICO DEL SENSOR */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="human" size={20} color="#0D9488" />
            <Text style={styles.cardTitle}>Guía Didáctica de Auscultación</Text>
          </View>
        </View>

        <Text style={styles.anatomyIntro}>
          Para obtener la máxima nitidez fonomecánica, coloque el micrófono INMP441 en uno de los focos recomendados:
        </Text>

        <View style={styles.focusTabsRow}>
          <TouchableOpacity
            style={[styles.focusTab, selectedFocus === 'apical' && styles.focusTabActive]}
            onPress={() => setSelectedFocus('apical')}
          >
            <Text style={[styles.focusTabText, selectedFocus === 'apical' && styles.focusTabTextActive]}>
              Foco Apical
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.focusTab, selectedFocus === 'tracheal' && styles.focusTabActive]}
            onPress={() => setSelectedFocus('tracheal')}
          >
            <Text style={[styles.focusTabText, selectedFocus === 'tracheal' && styles.focusTabTextActive]}>
              Foco Traqueal
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.focusTab, selectedFocus === 'basal' && styles.focusTabActive]}
            onPress={() => setSelectedFocus('basal')}
          >
            <Text style={[styles.focusTabText, selectedFocus === 'basal' && styles.focusTabTextActive]}>
              Foco Basal
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.focusDetailBox}>
          {selectedFocus === 'apical' && (
            <>
              <Text style={styles.focusDetailTitle}>Foco Subclavicular Apical (Tórax Anterior)</Text>
              <Text style={styles.focusDetailDesc}>
                Ubicación: Justo debajo de la clavícula en el segundo espacio intercostal. Óptimo para evaluar los lóbulos superiores pulmonares y ruidos sibilantes tempranos de asma.
              </Text>
            </>
          )}
          {selectedFocus === 'tracheal' && (
            <>
              <Text style={styles.focusDetailTitle}>Foco Laringotraqueal (Cuello Anterior)</Text>
              <Text style={styles.focusDetailDesc}>
                Ubicación: Sobre la horquilla esternal o cartílago cricoides. Proporciona sonido tubular rudo de alta intensidad, excelente para detectar estridor y tos paroxística.
              </Text>
            </>
          )}
          {selectedFocus === 'basal' && (
            <>
              <Text style={styles.focusDetailTitle}>Foco Basal Posterior (Infraescapular)</Text>
              <Text style={styles.focusDetailDesc}>
                Ubicación: Espalda en los espacios intercostales inferiores bajo la escápula. Fundamental para registrar crepitantes finos de neumonía y acumulación de líquido alveolar.
              </Text>
            </>
          )}
        </View>
      </View>

      {/* 7. HALLAZGOS Y RECOMENDACIONES CLÍNICAS */}
      {report && (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MaterialCommunityIcons name="clipboard-pulse-outline" size={20} color="#0D9488" />
              <Text style={styles.cardTitle}>Hallazgos y Sugerencias IA</Text>
            </View>
          </View>

          {report.findings.length > 0 && (
            <View style={styles.bulletsSection}>
              <Text style={styles.bulletsHeading}>Hallazgos Fonomecánicos:</Text>
              {report.findings.map((f, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Ionicons name="medical" size={14} color="#0D9488" style={{ marginTop: 2 }} />
                  <Text style={styles.bulletText}>{f}</Text>
                </View>
              ))}
            </View>
          )}

          {report.recommendations.length > 0 && (
            <View style={[styles.bulletsSection, { marginTop: 14 }]}>
              <Text style={styles.bulletsHeading}>Recomendaciones Preventivas:</Text>
              {report.recommendations.map((r, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Ionicons name="checkmark-circle" size={15} color="#10B981" style={{ marginTop: 2 }} />
                  <Text style={styles.bulletText}>{r}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.disclaimerBox}>
            <Ionicons name="information-circle" size={16} color="#64748B" />
            <Text style={styles.disclaimerText}>
              Herramienta de demostración para feria tecnológica. No sustituye una espirometría ni auscultación médica profesional.
            </Text>
          </View>
        </View>
      )}
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
    paddingBottom: 36,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#CCFBF1',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  heroIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  heroTitleContainer: {
    flex: 1,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  aiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDFA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#99F6E4',
  },
  aiPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0D9488',
    letterSpacing: 0.5,
  },
  networkPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  networkPillOnline: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  networkPillOffline: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  networkPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  heroSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginTop: 4,
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 16,
  },
  scoreCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#F0FDFA',
    borderWidth: 3,
    borderColor: '#0D9488',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  scoreNumber: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0D9488',
    lineHeight: 28,
  },
  scoreOutOf: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
  },
  scoreLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#0D9488',
    marginTop: 2,
  },
  diagnosticSummary: {
    flex: 1,
  },
  diagnosticLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  diagnosticTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: 3,
    marginBottom: 6,
  },
  diagnosticMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  confidenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  confidenceText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0D9488',
  },
  lastSyncText: {
    fontSize: 10,
    color: '#94A3B8',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    height: 28,
    minWidth: 135,
    justifyContent: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  acousticMetricsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  acousticMetricItem: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    minHeight: 88,
  },
  acousticMetricLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  acousticValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginVertical: 4,
    height: 30,
  },
  acousticMetricValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0D9488',
    fontVariant: ['tabular-nums'],
  },
  acousticMetricUnit: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '700',
  },
  acousticMetricSub: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '500',
    height: 14,
  },
  vuMeterContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  vuBarsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 52,
    paddingHorizontal: 4,
  },
  vuBar: {
    flex: 1,
    marginHorizontal: 2.5,
    borderRadius: 3,
  },
  vuScaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  vuScaleLabel: {
    fontSize: 9,
    color: '#94A3B8',
    fontWeight: '600',
  },
  protocolCard: {
    borderColor: '#99F6E4',
    backgroundColor: '#FAFEFD',
  },
  protocolDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 14,
  },
  timerBadge: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  timerBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  protocolActiveContainer: {
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  lungAnimationWrapper: {
    marginBottom: 12,
  },
  stageInstructions: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  stageTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  stageSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
  },
  startProtocolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0D9488',
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  startProtocolBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  refreshPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  refreshPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0D9488',
  },
  pathologyIntro: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  pathologyList: {
    gap: 10,
  },
  pathologyCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  pathologyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  pathologyTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  pathologyName: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  pathologySub: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  probabilityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  probabilityText: {
    fontSize: 12,
    fontWeight: '900',
  },
  progressBarTrack: {
    height: 7,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  sensorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  sensorCard: {
    width: '48%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  sensorIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  sensorLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  sensorValue: {
    fontSize: 17,
    fontWeight: '900',
    color: Colors.textPrimary,
    marginTop: 2,
    marginBottom: 2,
  },
  sensorStatus: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0D9488',
  },
  anatomyIntro: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 12,
    lineHeight: 17,
  },
  focusTabsRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
    gap: 4,
  },
  focusTab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 8,
  },
  focusTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  focusTabText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  focusTabTextActive: {
    color: '#0D9488',
    fontWeight: '800',
  },
  focusDetailBox: {
    backgroundColor: '#F0FDFA',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  focusDetailTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0D9488',
    marginBottom: 4,
  },
  focusDetailDesc: {
    fontSize: 11,
    color: '#334155',
    lineHeight: 16,
  },
  bulletsSection: {
    marginTop: 4,
  },
  bulletsHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 5,
  },
  bulletText: {
    flex: 1,
    fontSize: 11,
    color: '#334155',
    lineHeight: 16,
  },
  disclaimerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  disclaimerText: {
    flex: 1,
    fontSize: 10,
    color: '#64748B',
    lineHeight: 14,
  },
});
