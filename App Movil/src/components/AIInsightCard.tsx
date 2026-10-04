import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { AIAnalysisReport } from '../types/vitals';

interface AIInsightCardProps {
  report: AIAnalysisReport | null;
  onAskAI?: () => void;
}

export const AIInsightCard: React.FC<AIInsightCardProps> = ({ report, onAskAI }) => {
  const robotScale = useRef(new Animated.Value(1)).current;
  const btnScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const robotAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(robotScale, {
          toValue: 1.12,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(robotScale, {
          toValue: 1.0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );

    robotAnim.start();

    return () => {
      robotAnim.stop();
    };
  }, [robotScale]);

  if (!report) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.aiIconBadge, { backgroundColor: '#EFF6FF', borderColor: Colors.primary }]}>
              <MaterialCommunityIcons name="robot" size={20} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.headerTitle}>Asistente de orientación</Text>
              <Text style={styles.timestampText}>Monitoreo Automático</Text>
            </View>
          </View>
        </View>
        <Text style={styles.summaryText}>
          Conecta el dispositivo para ver la evaluación por reglas de tus signos vitales.
        </Text>
      </View>
    );
  }

  const isAlert = report.status === 'critical';
  const isCaution = report.status === 'caution';
  const accentColor = isAlert ? Colors.danger : isCaution ? Colors.warning : Colors.aiPurple;

  const anomalies: string[] = report.anomaliesDetected || [];
  const recommendations: string[] = report.recommendations || [];
  const title = report.title || 'Evaluación de Salud';
  const summary = report.summary || 'Monitoreo biomédico activo.';

  return (
    <View style={[styles.container, isAlert && styles.alertContainer]}>
      {/* Cabecera IA */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Animated.View
            style={[
              styles.aiIconBadge,
              { backgroundColor: accentColor + '20', borderColor: accentColor, transform: [{ scale: robotScale }] },
            ]}
          >
            <MaterialCommunityIcons name="robot-excited" size={20} color={accentColor} />
          </Animated.View>
          <View>
            <View style={styles.tagRow}>
              <Text style={styles.headerTitle}>Valoración orientativa</Text>
              <View style={styles.liveBadge}>
                <Text style={styles.liveText}>ORIENTACIÓN</Text>
              </View>
            </View>
            <Text style={styles.timestampText}>Sin probabilidad de enfermedad validada</Text>
          </View>
        </View>


      </View>

      {/* Título y Resumen Clínico */}
      <Text style={styles.reportTitle}>{title}</Text>
      <Text style={styles.summaryText}>{summary}</Text>

      {/* Anomalías si existen */}
      {anomalies.length > 0 && (
        <View style={styles.anomaliesBox}>
          <View style={styles.anomaliesTitleRow}>
            <Ionicons name="warning-outline" size={14} color={accentColor} />
            <Text style={[styles.anomaliesTitle, { color: accentColor }]}>Observaciones Detectadas:</Text>
          </View>
          {anomalies.map((anomaly, idx) => (
            <View key={idx} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: accentColor }]} />
              <Text style={styles.anomalyItemText}>{anomaly}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Recomendaciones médicas preventivas */}
      {recommendations.length > 0 && (
        <View style={styles.recommendationsBox}>
          <Text style={styles.recTitle}>Recomendaciones:</Text>
          {recommendations.slice(0, 2).map((rec, idx) => (
            <View key={idx} style={styles.bulletRow}>
              <Ionicons name="checkmark-circle-outline" size={14} color={Colors.success} style={{ marginRight: 6 }} />
              <Text style={styles.recText}>{rec}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Auscultación Pulmonar Clínica (ICBHI Modelo IA) */}
      {report.acoustic_analysis && (
        <View
          style={[
            styles.acousticBox,
            report.acoustic_analysis.is_abnormal ? styles.acousticBoxAlert : styles.acousticBoxNormal,
          ]}
        >
          <View style={styles.acousticHeaderRow}>
            <View style={styles.acousticTitleGroup}>
              <MaterialCommunityIcons
                name="stethoscope"
                size={16}
                color={report.acoustic_analysis.is_abnormal ? Colors.danger : Colors.success}
              />
              <Text style={styles.acousticTitle}>Auscultación Pulmonar (ICBHI IA)</Text>
            </View>
            <View
              style={[
                styles.acousticBadge,
                {
                  backgroundColor: report.acoustic_analysis.is_abnormal ? '#FEE2E2' : '#DCFCE7',
                },
              ]}
            >
              <Text
                style={[
                  styles.acousticBadgeText,
                  { color: report.acoustic_analysis.is_abnormal ? '#B91C1C' : '#15803D' },
                ]}
              >
                {report.acoustic_analysis.prediction}
              </Text>
            </View>
          </View>
          <Text style={styles.acousticDetailText}>
            Resultado acústico del modelo. No es certeza de diagnóstico ni identifica una enfermedad.
          </Text>
        </View>
      )}

      {/* Botón interactivo de acción */}
      {onAskAI && (
        <Animated.View style={{ transform: [{ scale: btnScale }] }}>
          <TouchableOpacity
            style={styles.chatButton}
            activeOpacity={0.85}
            onPress={onAskAI}
            onPressIn={() => Animated.spring(btnScale, { toValue: 0.96, useNativeDriver: true }).start()}
            onPressOut={() => Animated.spring(btnScale, { toValue: 1.0, useNativeDriver: true }).start()}
          >
            <Ionicons name="chatbubbles-outline" size={16} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={styles.chatButtonText}>Preguntar al asistente sobre estos datos</Text>
            <Ionicons name="chevron-forward" size={16} color="#FFF" />
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    marginBottom: 16,
    shadowColor: Colors.aiPurple,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  alertContainer: {
    borderColor: Colors.danger,
    borderWidth: 1.5,
    backgroundColor: '#FEF2F2',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aiIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginRight: 10,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  liveBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  liveText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.aiPurple,
  },
  timestampText: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
  },
  scoreNumber: {
    fontSize: 18,
    fontWeight: '800',
  },
  scoreUnit: {
    fontSize: 11,
    color: Colors.textMuted,
    marginLeft: 2,
    fontWeight: '600',
  },
  reportTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  summaryText: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  anomaliesBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  anomaliesTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  anomaliesTitle: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    marginRight: 8,
  },
  anomalyItemText: {
    fontSize: 12,
    color: Colors.textPrimary,
    flex: 1,
    lineHeight: 17,
  },
  recommendationsBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  recTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  recText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 17,
  },
  chatButton: {
    backgroundColor: Colors.aiPurple,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  chatButtonText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  acousticBox: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  acousticBoxNormal: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  acousticBoxAlert: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  acousticHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  acousticTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  acousticTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginLeft: 6,
  },
  acousticBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  acousticBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  acousticDetailText: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
});
