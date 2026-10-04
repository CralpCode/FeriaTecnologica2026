import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text } from '../components/ui/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';
import { TrendChart } from '../components/TrendChart';
import { TimeRange } from '../types/vitals';
import { ExportService } from '../services/exportService';
import { Centered } from '../components/ResponsiveContainer';
import { Banner, Button, Card, SectionHeader, SegmentedControl } from '../components/ui';
import { color, font, radius, space, weight } from '../theme/tokens';

type MetricFilter = 'heartRate' | 'bloodOxygen' | 'hrv' | 'stressLevel';

export const ChartsScreen: React.FC = () => {
  const { history, selectedRange, setSelectedRange, aiReport } = useVitals();
  const [selectedMetric, setSelectedMetric] = useState<MetricFilter>('heartRate');
  const [exportingType, setExportingType] = useState<'excel' | 'pdf' | 'png' | null>(null);
  const [exportFeedback, setExportFeedback] = useState<{ text: string; isError: boolean } | null>(null);

  const ranges: { id: TimeRange; label: string }[] = [
    { id: '24h', label: '24 horas' },
    { id: '7d', label: '7 días' },
    { id: '30d', label: '30 días' },
  ];

  const metrics: {
    id: MetricFilter;
    label: string;
    unit: string;
    color: string;
    icon: any;
    info: string;
  }[] = [
    {
      id: 'heartRate',
      label: 'Pulsaciones (BPM)',
      unit: 'BPM',
      color: Colors.heartRate,
      icon: 'heart-pulse',
      info: 'Medido en vivo por el sensor óptico MAX30102 a partir de la onda de pulso (PPG).',
    },
    {
      id: 'bloodOxygen',
      label: 'Oxígeno (SpO2)',
      unit: '% SpO2',
      color: Colors.oxygen,
      icon: 'water-percent',
      info: 'Saturación periférica de oxígeno por oximetría de pulso (luz roja 660 nm e infrarroja 880 nm).',
    },
    {
      id: 'hrv',
      label: 'Variabilidad (HRV)',
      unit: 'ms',
      color: Colors.pressure,
      icon: 'heart-flash',
      info: 'Variación del intervalo entre latidos detectados por el sensor óptico. Medición de referencia, no validada clínicamente.',
    },
    {
      id: 'stressLevel',
      label: 'Índice de estrés (experimental)',
      unit: '/100',
      color: Colors.stress,
      icon: 'brain',
      info: 'Índice experimental calculado en el firmware a partir del pulso y el nivel sonoro. No es una medición validada.',
    },
  ];

  const currentMetricConfig = metrics.find((m) => m.id === selectedMetric) || metrics[0];

  const showNotification = (text: string, isError: boolean = false) => {
    setExportFeedback({ text, isError });
    setTimeout(() => {
      setExportFeedback(null);
    }, 4500);
  };

  const handleExportExcel = async () => {
    try {
      setExportingType('excel');
      const result = await ExportService.exportToExcel({
        metricKey: selectedMetric,
        history,
        metricName: currentMetricConfig.label,
        metricUnit: currentMetricConfig.unit,
        selectedRange,
        aiReport,
      });
      showNotification(result.message, !result.success);
    } catch (e: any) {
      showNotification('Error al exportar a Excel', true);
    } finally {
      setExportingType(null);
    }
  };

  const handleExportPdf = async () => {
    try {
      setExportingType('pdf');
      const result = await ExportService.exportToPdf({
        metricKey: selectedMetric,
        history,
        metricName: currentMetricConfig.label,
        metricUnit: currentMetricConfig.unit,
        selectedRange,
        aiReport,
      });
      showNotification(result.message, !result.success);
    } catch (e: any) {
      showNotification('Error al generar PDF', true);
    } finally {
      setExportingType(null);
    }
  };

  const handleExportPng = async () => {
    try {
      setExportingType('png');
      const result = await ExportService.exportToPng({
        metricKey: selectedMetric,
        history,
        metricName: currentMetricConfig.label,
        metricUnit: currentMetricConfig.unit,
        selectedRange,
        aiReport,
      });
      showNotification(result.message, !result.success);
    } catch (e: any) {
      showNotification('Error al exportar PNG', true);
    } finally {
      setExportingType(null);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Centered>
        <SectionHeader title="Gráficas" subtitle="Tendencias del paciente abierto. Solo se grafican lecturas válidas del dispositivo." />

        <View style={{ marginBottom: space.md }}>
          <SegmentedControl options={ranges.map((r) => ({ label: r.label, value: r.id }))} value={selectedRange}
                            onChange={setSelectedRange} accessibilityLabel="Periodo" stretch />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.metricsSelector}>
          {metrics.map((m) => {
            const isSelected = selectedMetric === m.id;
            return (
              <Pressable key={m.id} onPress={() => setSelectedMetric(m.id)} accessibilityRole="button" accessibilityState={{ selected: isSelected }}
                         style={(st: any) => [styles.metricChip, st.hovered && !isSelected && { backgroundColor: color.surfaceMuted },
                           isSelected && { backgroundColor: `${m.color}12`, borderColor: m.color }]}>
                <MaterialCommunityIcons name={m.icon} size={18} color={isSelected ? m.color : color.textSecondary} />
                <Text style={[styles.metricChipText, isSelected && { color: m.color, fontWeight: weight.heavy }]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <TrendChart
          data={history}
          metricKey={selectedMetric}
          title={currentMetricConfig.label}
          unit={currentMetricConfig.unit}
          color={currentMetricConfig.color}
        />

        <Card elevated>
          <View style={styles.exportHeader}>
            <View style={styles.exportIcon}><MaterialCommunityIcons name="file-export-outline" size={20} color={color.primary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.exportTitle}>Exportar telemetría</Text>
              <Text style={styles.exportSubtitle}>
                Registros de {selectedRange === '24h' ? '24 horas' : selectedRange === '7d' ? '7 días' : '30 días'} en formatos estándar.
              </Text>
            </View>
          </View>
          <View style={styles.exportButtonsGrid}>
            <Button label="Excel (.xlsx)" icon="grid-outline" variant="secondary" onPress={handleExportExcel}
                    loading={exportingType === 'excel'} disabled={exportingType !== null} style={styles.exportBtn} />
            <Button label="Informe PDF" icon="document-text-outline" variant="secondary" onPress={handleExportPdf}
                    loading={exportingType === 'pdf'} disabled={exportingType !== null} style={styles.exportBtn} />
            <Button label="Gráfica PNG" icon="image-outline" variant="secondary" onPress={handleExportPng}
                    loading={exportingType === 'png'} disabled={exportingType !== null} style={styles.exportBtn} />
          </View>
          {exportFeedback && (
            <Banner tone={exportFeedback.isError ? 'danger' : 'success'} text={exportFeedback.text} style={{ marginTop: space.md, marginBottom: 0 }} />
          )}
        </Card>

        <Banner tone="info" title="Acerca de este parámetro" text={currentMetricConfig.info} />
      </Centered>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.lg, paddingBottom: space.xxl },
  metricsSelector: { gap: space.sm, paddingBottom: space.md },
  metricChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill,
    borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, cursor: 'pointer' as any,
  },
  metricChipText: { fontSize: font.sm, color: color.textSecondary, fontWeight: weight.medium },
  exportHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  exportIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.primarySoft, alignItems: 'center', justifyContent: 'center' },
  exportTitle: { fontSize: font.md, fontWeight: weight.heavy, color: color.text },
  exportSubtitle: { fontSize: font.xs, color: color.textSecondary, marginTop: 2 },
  exportButtonsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  exportBtn: { flexGrow: 1, flexBasis: 150 },
});
