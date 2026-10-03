import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useClinical } from '../context/ClinicalContext';
import { apiService } from '../services/api';
import { AlertSeverity, SessionReport } from '../types/vitals';

const SEVERITY: Record<AlertSeverity, { label: string; color: string; soft: string; icon: string }> = {
  critical: { label: 'Crítica', color: Colors.danger, soft: Colors.dangerSoft, icon: 'alert-octagon' },
  caution: { label: 'Precaución', color: Colors.warning, soft: Colors.warningSoft, icon: 'alert' },
  info: { label: 'Aviso', color: Colors.primary, soft: Colors.primarySoft, icon: 'information' },
};

const time = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
};

export const AlertsScreen: React.FC = () => {
  const { alerts, activeAlertsCount, acknowledgeAlert, isLiveConnected } = useClinical();
  const [report, setReport] = useState<SessionReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const handleReport = async () => {
    setGenerating(true);
    setReportError(null);
    try {
      setReport(await apiService.createSessionReport());
    } catch (e: any) {
      setReportError(`No se pudo generar el informe: ${e?.message || e}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Alertas de la sesión ({activeAlertsCount} activas)</Text>
        <View style={[styles.liveDot, { backgroundColor: isLiveConnected ? Colors.success : Colors.textMuted }]} />
      </View>
      <Text style={styles.note}>
        Las alertas las decide un conjunto de reglas fijas y la red neuronal de audio. La IA de lenguaje solo redacta el texto.
      </Text>

      {alerts.length === 0 && (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="bell-check-outline" size={36} color={Colors.textMuted} />
          <Text style={styles.note}>Sin alertas en esta sesión.</Text>
        </View>
      )}

      {alerts.map((a) => {
        const s = SEVERITY[a.severity] || SEVERITY.info;
        return (
          <View
            key={a.id}
            style={[styles.alertCard, { borderLeftColor: s.color, opacity: a.acknowledged ? 0.55 : 1 }]}
          >
            <View style={styles.alertHeader}>
              <MaterialCommunityIcons name={s.icon as any} size={18} color={s.color} />
              <Text style={[styles.alertTitle, { color: s.color }]}>{a.title}</Text>
              <Text style={styles.alertTime}>{time(a.created_at)}</Text>
            </View>
            <Text style={styles.alertMessage}>{a.message}</Text>
            {!!a.action && <Text style={styles.alertAction}>→ {a.action}</Text>}
            <View style={styles.alertFooter}>
              <Text style={styles.alertMeta}>
                {s.label}
                {a.llm_generated ? ' · texto redactado por IA local' : ''}
              </Text>
              {!a.acknowledged ? (
                <TouchableOpacity style={styles.ackBtn} onPress={() => acknowledgeAlert(a.id).catch(() => {})}>
                  <Ionicons name="checkmark" size={14} color={Colors.primary} />
                  <Text style={styles.ackText}>Marcar vista</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.alertMeta}>Vista</Text>
              )}
            </View>
          </View>
        );
      })}

      {/* Informe de sesión */}
      <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Informe de la sesión</Text>
      <View style={styles.reportCard}>
        <Text style={styles.note}>
          Resume signos vitales, grabaciones y alertas. Si hubo hallazgos, incluye una nota de referencia para personal de salud.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleReport} disabled={generating} activeOpacity={0.8}>
          {generating ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <MaterialCommunityIcons name="file-document-outline" size={18} color="#FFFFFF" />
          )}
          <Text style={styles.primaryBtnText}>{generating ? 'Redactando informe…' : 'Generar informe PDF'}</Text>
        </TouchableOpacity>
        {reportError && <Text style={styles.errorText}>{reportError}</Text>}

        {report && (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.reportText}>{report.content.resumen}</Text>
            {report.content.hallazgos.map((h, i) => (
              <Text key={i} style={styles.reportItem}>• {h}</Text>
            ))}
            <Text style={[styles.reportText, { fontWeight: '700', marginTop: 6 }]}>{report.content.recomendacion}</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: Colors.aiPurple }]}
              onPress={() => Linking.openURL(apiService.reportPdfUrl(report))}
            >
              <Ionicons name="open-outline" size={16} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>Abrir PDF</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary, marginBottom: 6 },
  liveDot: { width: 9, height: 9, borderRadius: 5 },
  note: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, marginBottom: 10 },
  empty: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  alertCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 5,
    padding: 12,
    marginBottom: 10,
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  alertTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  alertTime: { fontSize: 11, color: Colors.textMuted },
  alertMessage: { fontSize: 13, color: Colors.textPrimary, lineHeight: 19 },
  alertAction: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginTop: 4, fontWeight: '600' },
  alertFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  alertMeta: { fontSize: 11, color: Colors.textMuted },
  ackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: Colors.primarySoft,
  },
  ackText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  reportCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 8,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  errorText: { color: Colors.danger, fontSize: 12, marginTop: 8 },
  reportText: { fontSize: 13, color: Colors.textPrimary, lineHeight: 19 },
  reportItem: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
});
