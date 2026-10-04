import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator, Linking,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';
import { useClinical } from '../context/ClinicalContext';
import { apiService } from '../services/api';
import { focusStates, doneCount, FOCUS_ORDER } from '../services/consulta';
import { AuscultationMode, PatientContext } from '../types/vitals';
import { ClinicalAssessmentPanel } from './ClinicalAssessmentPanel';

type StepState = 'done' | 'pending' | 'warn';

const LEVEL_LABEL: Record<string, { text: string; color: string }> = {
  rojo: { text: 'ROJO', color: Colors.danger },
  amarillo: { text: 'AMARILLO', color: Colors.warning },
  verde: { text: 'VERDE', color: Colors.success },
  gris: { text: 'SIN DATOS', color: Colors.textSecondary },
};

const contextSaved = (c: PatientContext | null) =>
  !!c && (c.age_years !== null || c.at_rest !== null || c.altitude_m !== null
    || Object.values(c.symptoms || {}).some((v) => v !== null)
    || Object.values(c.history || {}).some((v) => v !== null));

/**
 * Pasos de la consulta (paciente → datos → pulso → corazón → pulmón → informe) con su avance.
 * Usa los datos que ya existen y lleva a las pantallas de siempre.
 */
export const ConsultaChecklist: React.FC<{ onOpenAuscultation: (mode: AuscultationMode) => void }> = ({
  onOpenAuscultation,
}) => {
  const { currentSessionId, connectedType, connectViaServer } = useVitals();
  const { recordings, triage } = useClinical();
  const [context, setContext] = useState<PatientContext | null>(null);
  const [showData, setShowData] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const loadContext = useCallback(() => {
    apiService.getPatientContext(currentSessionId).then(setContext).catch(() => setContext(null));
  }, [currentSessionId]);
  useEffect(() => { setContext(null); loadContext(); }, [loadContext]);

  const heart = useMemo(() => focusStates(recordings, 'corazon'), [recordings]);
  const lung = useMemo(() => focusStates(recordings, 'pulmon'), [recordings]);
  const heartDone = doneCount('corazon', heart);
  const lungDone = doneCount('pulmon', lung);
  const heartRetry = FOCUS_ORDER.corazon.some((f) => heart[f] === 'repetir');
  const lungRetry = FOCUS_ORDER.pulmon.some((f) => lung[f] === 'repetir');
  const pulse = triage?.datos_usados?.vitales_ultimo_minuto?.fc ?? null;
  const level = LEVEL_LABEL[triage?.nivel || 'gris'];

  const steps: { key: string; title: string; detail: string; state: StepState; action?: () => void; actionLabel?: string }[] = [
    { key: 'paciente', title: 'Paciente', detail: currentSessionId, state: 'done' },
    {
      key: 'datos', title: 'Datos y síntomas',
      detail: contextSaved(context) ? 'Guardados (se pueden corregir)' : 'Edad, reposo y síntomas (Sí / No / No sé)',
      state: contextSaved(context) ? 'done' : 'pending', action: () => setShowData(true),
      actionLabel: contextSaved(context) ? 'Revisar' : 'Llenar',
    },
    {
      key: 'pulso', title: 'Pulso',
      detail: pulse !== null ? `Pulso válido en uso: ${pulse} BPM`
        : connectedType === 'none' ? 'Conecta el dispositivo (una sola vez) y coloca el dedo en la banda'
        : 'Coloca el dedo en la banda y espera unos segundos',
      state: pulse !== null ? 'done' : 'pending',
      // Una vez conectado, la conexión se mantiene al cambiar de paciente
      ...(connectedType === 'none' ? { action: () => { connectViaServer(); }, actionLabel: 'Conectar' } : {}),
    },
    {
      key: 'corazon', title: `Corazón ${heartDone}/4`,
      detail: heartRetry ? 'Hay un foco por repetir (calidad insuficiente)' : heartDone === 4 ? 'Los 4 focos grabados' : 'Graba AV, PV, TV y MV',
      state: heartDone === 4 ? 'done' : heartRetry ? 'warn' : 'pending',
      action: () => onOpenAuscultation('corazon'), actionLabel: heartDone === 4 ? 'Ver' : 'Grabar',
    },
    {
      key: 'pulmon', title: `Pulmón ${lungDone} ${lungDone === 1 ? 'zona' : 'zonas'}`,
      detail: lungRetry ? 'Hay una zona por repetir' : lungDone >= 2 ? 'Zonas grabadas' : 'Al menos 1 zona; mejor izquierda y derecha',
      state: lungDone >= 1 && !lungRetry ? 'done' : lungRetry ? 'warn' : 'pending',
      action: () => onOpenAuscultation('pulmon'), actionLabel: lungDone >= 1 ? 'Ver' : 'Grabar',
    },
  ];
  const doneSteps = steps.filter((s) => s.state === 'done').length;

  const report = async () => {
    setGenerating(true);
    setReportError(null);
    try {
      const r = await apiService.createReportFor(currentSessionId);
      Linking.openURL(apiService.reportPdfUrl(r));
    } catch (e: any) {
      setReportError(`No se pudo generar el informe: ${e?.message || e}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={() => setCollapsed((v) => !v)} accessibilityRole="button"
                        accessibilityState={{ expanded: !collapsed }}>
        <MaterialCommunityIcons name="clipboard-check-outline" size={18} color={Colors.primary} />
        <Text style={styles.title}>Consulta · {doneSteps}/{steps.length} pasos</Text>
        <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={18} color={Colors.textSecondary} />
      </TouchableOpacity>

      {!collapsed && steps.map((s, i) => (
        <View key={s.key} style={styles.row}>
          <View style={[styles.badge, s.state === 'done' ? styles.badgeDone : s.state === 'warn' ? styles.badgeWarn : styles.badgePending]}>
            {s.state === 'done' ? <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              : s.state === 'warn' ? <Ionicons name="alert" size={14} color="#FFFFFF" />
              : <Text style={styles.badgeText}>{i + 1}</Text>}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.stepTitle}>{s.title}</Text>
            <Text style={styles.stepDetail} numberOfLines={2}>{s.detail}</Text>
          </View>
          {s.action && (
            <TouchableOpacity style={styles.action} onPress={s.action} accessibilityRole="button">
              <Text style={styles.actionText}>{s.actionLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      {!collapsed && (
        <View style={[styles.row, styles.lastRow]}>
          <View style={[styles.badge, { backgroundColor: level.color }]}>
            <Ionicons name="flag" size={13} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.stepTitle}>Resultado: <Text style={{ color: level.color }}>{level.text}</Text></Text>
            <Text style={styles.stepDetail}>Semáforo e informe PDF de esta consulta</Text>
          </View>
          <TouchableOpacity style={[styles.action, styles.reportBtn]} onPress={report} disabled={generating} accessibilityRole="button">
            {generating ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.reportText}>Informe PDF</Text>}
          </TouchableOpacity>
        </View>
      )}
      {reportError && <Text style={styles.error}>{reportError}</Text>}

      <Modal visible={showData} transparent animationType="fade" onRequestClose={() => setShowData(false)}>
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Datos y síntomas · {currentSessionId}</Text>
              <TouchableOpacity onPress={() => { setShowData(false); loadContext(); }} accessibilityRole="button"
                                accessibilityLabel="Cerrar" style={styles.close}>
                <Ionicons name="close" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
              <ClinicalAssessmentPanel onSaved={loadContext} />
            </ScrollView>
            <Text style={styles.saveHint}>Para guardar, usa "Guardar y evaluar esta sesión" al final del formulario.</Text>
            <TouchableOpacity style={styles.doneBtn} onPress={() => { setShowData(false); loadContext(); }} accessibilityRole="button">
              <Text style={styles.closeText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  title: { flex: 1, fontSize: 14, fontWeight: '800', color: Colors.textPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  lastRow: { marginTop: 2 },
  badge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeDone: { backgroundColor: Colors.success },
  badgeWarn: { backgroundColor: Colors.warning },
  badgePending: { backgroundColor: Colors.backgroundSecondary, borderWidth: 1, borderColor: Colors.border },
  badgeText: { fontSize: 11, fontWeight: '800', color: Colors.textSecondary },
  stepTitle: { fontSize: 13, fontWeight: '800', color: Colors.textPrimary },
  stepDetail: { fontSize: 12, color: Colors.textSecondary },
  action: { minHeight: 34, paddingHorizontal: 12, borderRadius: 10, backgroundColor: Colors.primarySoft, justifyContent: 'center' },
  actionText: { fontSize: 12, fontWeight: '800', color: Colors.primary },
  reportBtn: { backgroundColor: Colors.aiPurple, minWidth: 96, alignItems: 'center' },
  reportText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  error: { fontSize: 12, color: Colors.danger, marginTop: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 12 },
  modalCard: { width: '100%', maxWidth: 720, maxHeight: '92%', backgroundColor: Colors.background, borderRadius: 18, padding: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  modalTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: Colors.textPrimary },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  doneBtn: { minHeight: 42, borderRadius: 12, backgroundColor: Colors.backgroundSecondary, borderWidth: 1, borderColor: Colors.border,
             alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  closeText: { fontSize: 13, fontWeight: '800', color: Colors.textSecondary },
  saveHint: { fontSize: 11, color: Colors.textSecondary, marginTop: 6, textAlign: 'center' },
});
