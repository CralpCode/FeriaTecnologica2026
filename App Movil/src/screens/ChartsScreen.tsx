import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons, Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';
import { TrendChart } from '../components/TrendChart';
import { TimeRange } from '../types/vitals';
import { ExportService } from '../services/exportService';

type MetricFilter = 'heartRate' | 'bloodOxygen' | 'hrv' | 'stressLevel';

export const ChartsScreen: React.FC = () => {
  const { history, selectedRange, setSelectedRange, aiReport } = useVitals();
  const [selectedMetric, setSelectedMetric] = useState<MetricFilter>('heartRate');
  const [exportingType, setExportingType] = useState<'excel' | 'pdf' | 'png' | null>(null);
  const [exportFeedback, setExportFeedback] = useState<{ text: string; isError: boolean } | null>(null);

  const ranges: { id: TimeRange; label: string }[] = [
    { id: '24h', label: '24 Horas' },
    { id: '7d', label: '7 Días' },
    { id: '30d', label: '30 Días' },
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
      label: 'Índice de Estrés (experimental)',
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
      {/* 1. Selector de Rango Temporal Clínico (24 Horas / 7 Días / 30 Días) */}
      <View style={styles.rangeSelectorCard}>
        <View style={styles.rangeTabs}>
          {ranges.map((r) => {
            const isActive = selectedRange === r.id;
            return (
              <TouchableOpacity
                key={r.id}
                activeOpacity={0.8}
                style={[styles.rangeTab, isActive && styles.rangeTabActive]}
                onPress={() => setSelectedRange(r.id)}
              >
                <Text style={[styles.rangeTabText, isActive && styles.rangeTabTextActive]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 2. Selector de Métrica */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.metricsSelector}>
        {metrics.map((m) => {
          const isSelected = selectedMetric === m.id;
          return (
            <TouchableOpacity
              key={m.id}
              activeOpacity={0.8}
              style={[
                styles.metricChip,
                isSelected && { backgroundColor: m.color, borderColor: m.color },
              ]}
              onPress={() => setSelectedMetric(m.id)}
            >
              <MaterialCommunityIcons
                name={m.icon}
                size={18}
                color={isSelected ? '#FFFFFF' : Colors.textSecondary}
              />
              <Text style={[styles.metricChipText, isSelected && styles.metricChipTextActive]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* 3. Gráfica Principal de Tendencia */}
      <TrendChart
        data={history}
        metricKey={selectedMetric}
        title={currentMetricConfig.label}
        unit={currentMetricConfig.unit}
        color={currentMetricConfig.color}
      />

      {/* 4. Barra de Exportación de Datos (Excel, PDF, PNG) */}
      <View style={styles.exportSection}>
        <View style={styles.exportHeader}>
          <MaterialCommunityIcons name="file-export-outline" size={20} color={Colors.primary} />
          <Text style={styles.exportTitle}>Exportar Telemetría</Text>
        </View>
        <Text style={styles.exportSubtitle}>
          Descarga o comparte los registros de {selectedRange === '24h' ? '24 horas' : selectedRange === '7d' ? '7 días' : '30 días'} en formatos estándar:
        </Text>

        <View style={styles.exportButtonsGrid}>
          {/* Botón Excel */}
          <TouchableOpacity
            style={[styles.exportBtn, styles.excelBtn]}
            onPress={handleExportExcel}
            activeOpacity={0.8}
            disabled={exportingType !== null}
          >
            {exportingType === 'excel' ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <FontAwesome5 name="file-excel" size={16} color="#FFFFFF" />
                <Text style={styles.exportBtnText}>Excel (.xlsx)</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Botón PDF */}
          <TouchableOpacity
            style={[styles.exportBtn, styles.pdfBtn]}
            onPress={handleExportPdf}
            activeOpacity={0.8}
            disabled={exportingType !== null}
          >
            {exportingType === 'pdf' ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <FontAwesome5 name="file-pdf" size={16} color="#FFFFFF" />
                <Text style={styles.exportBtnText}>Informe PDF</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Botón PNG */}
          <TouchableOpacity
            style={[styles.exportBtn, styles.pngBtn]}
            onPress={handleExportPng}
            activeOpacity={0.8}
            disabled={exportingType !== null}
          >
            {exportingType === 'png' ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <MaterialCommunityIcons name="image-outline" size={18} color="#FFFFFF" />
                <Text style={styles.exportBtnText}>Gráfica PNG</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Feedback / Notificación de exportación */}
        {exportFeedback && (
          <View
            style={[
              styles.feedbackBanner,
              exportFeedback.isError ? styles.feedbackError : styles.feedbackSuccess,
            ]}
          >
            <Ionicons
              name={exportFeedback.isError ? 'alert-circle' : 'checkmark-circle'}
              size={18}
              color={exportFeedback.isError ? '#DC2626' : '#16A34A'}
            />
            <Text
              style={[
                styles.feedbackText,
                { color: exportFeedback.isError ? '#991B1B' : '#166534' },
              ]}
            >
              {exportFeedback.text}
            </Text>
          </View>
        )}
      </View>

      {/* 5. Tarjeta de Información Fisiológica */}
      <View style={styles.infoCard}>
        <View style={styles.infoHeader}>
          <Ionicons name="information-circle" size={20} color={Colors.primary} />
          <Text style={styles.infoTitle}>Acerca de este Parámetro</Text>
        </View>
        <Text style={styles.infoDesc}>{currentMetricConfig.info}</Text>
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
    paddingBottom: 36,
    width: '100%',
    maxWidth: 1000,
    alignSelf: 'center',
  },
  rangeSelectorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 4,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  rangeTabs: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 2,
    gap: 4,
  },
  rangeTab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  rangeTabActive: {
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  rangeTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  rangeTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  metricsSelector: {
    gap: 8,
    paddingBottom: 14,
  },
  metricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  metricChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  metricChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  exportSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  exportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  exportTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  exportSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 12,
    lineHeight: 16,
  },
  exportButtonsGrid: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  exportBtn: {
    flex: 1,
    minWidth: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  excelBtn: {
    backgroundColor: '#16A34A',
  },
  pdfBtn: {
    backgroundColor: '#DC2626',
  },
  pngBtn: {
    backgroundColor: '#2563EB',
  },
  exportBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    gap: 8,
    borderWidth: 1,
  },
  feedbackSuccess: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  feedbackError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  feedbackText: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  infoDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});
