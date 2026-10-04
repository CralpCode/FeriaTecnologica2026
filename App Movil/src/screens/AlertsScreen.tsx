import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Text } from '../components/ui/Text';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useClinical } from '../context/ClinicalContext';
import { apiService } from '../services/api';
import { AlertSeverity, ClinicalAlert, SessionReport } from '../types/vitals';
import { Centered, Columns } from '../components/ResponsiveContainer';
import { useLayout } from '../hooks/useLayout';
import { Button, Card, EmptyState, SectionHeader, StatusPill } from '../components/ui';
import { color, radius, space } from '../theme/tokens';

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
  const { twoColumns } = useLayout();
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [showSeen, setShowSeen] = useState(false);

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

  const renderAlert = (a: ClinicalAlert) => {
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
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Centered>
      <Columns
        leftWeight={1.2}
        left={
          <View>
      <SectionHeader title="Alertas de la sesión"
                     subtitle="Las deciden reglas fijas y la red neuronal de audio; la IA de lenguaje solo redacta el texto."
                     right={<StatusPill label={`${activeAlertsCount} activas`} tone={activeAlertsCount ? 'warning' : 'neutral'}
                                        dot={isLiveConnected} />} />

      {alerts.length === 0 && (
        <Card><EmptyState icon="bell-check-outline" tone="success" title="Sin alertas en esta sesión"
                          text="Si una grabación o una lectura lo amerita, la alerta aparecerá aquí al momento." /></Card>
      )}

      {(['critical', 'caution', 'info'] as AlertSeverity[]).map((sev) => {
        const group = alerts.filter((a) => a.severity === sev && !a.acknowledged);
        if (!group.length) return null;
        return (
          <View key={sev}>
            <Text style={[styles.groupTitle, { color: SEVERITY[sev].color }]}>
              {{ critical: 'Críticas', caution: 'Precaución', info: 'Avisos' }[sev]} ({group.length})
            </Text>
            {group.map(renderAlert)}
          </View>
        );
      })}
      {alerts.some((a) => a.acknowledged) && (
        <TouchableOpacity style={styles.seenHead} onPress={() => setShowSeen((v) => !v)} accessibilityRole="button"
                          accessibilityState={{ expanded: showSeen }}>
          <Text style={styles.groupTitle}>Vistas ({alerts.filter((a) => a.acknowledged).length})</Text>
          <Ionicons name={showSeen ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      )}
      {showSeen && alerts.filter((a) => a.acknowledged).map(renderAlert)}

          </View>
        }
        right={
          <View>
      {/* Informe de sesión */}
      <SectionHeader title="Informe de la sesión" style={!twoColumns ? { marginTop: space.lg } : undefined} />
      <Card elevated>
        <View style={styles.reportHead}>
          <View style={styles.reportIcon}><MaterialCommunityIcons name="file-document-outline" size={22} color={color.primary} /></View>
          <Text style={[styles.note, { flex: 1, marginVertical: 0 }]}>
            Resume signos vitales, grabaciones y alertas. Si hubo hallazgos, incluye una nota de referencia para personal de salud.
          </Text>
        </View>
        <Button label={generating ? 'Redactando informe…' : 'Generar informe PDF'} icon="document-text-outline" onPress={handleReport}
                loading={generating} full style={{ marginTop: space.md }} />
        {reportError && <Text style={styles.errorText}>{reportError}</Text>}

        {report && (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.reportText}>{report.content.resumen}</Text>
            {report.content.hallazgos.map((h, i) => (
              <Text key={i} style={styles.reportItem}>• {h}</Text>
            ))}
            <Text style={[styles.reportText, { fontWeight: '700', marginTop: 6 }]}>{report.content.recomendacion}</Text>
            <Button label="Abrir PDF" icon="open-outline" variant="ai" onPress={() => Linking.openURL(apiService.reportPdfUrl(report))}
                    full style={{ marginTop: space.md }} />
          </View>
        )}
      </Card>
          </View>
        }
      />
      </Centered>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  reportHead: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  reportIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.primarySoft, alignItems: 'center', justifyContent: 'center' },
  groupTitle: { fontSize: 13, fontWeight: '800', color: Colors.textSecondary, marginTop: 12, marginBottom: 8, letterSpacing: 0.3 },
  seenHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
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
  alertTime: { fontSize: 12, color: Colors.textMuted },
  alertMessage: { fontSize: 13, color: Colors.textPrimary, lineHeight: 19 },
  alertAction: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginTop: 4, fontWeight: '600' },
  alertFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  alertMeta: { fontSize: 12, color: Colors.textMuted },
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
