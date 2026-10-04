import React, { useState } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, TouchableOpacity } from 'react-native';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { Colors } from '../theme/colors';
import { VitalsHistoryPoint } from '../types/vitals';

interface TrendChartProps {
  data: VitalsHistoryPoint[];
  metricKey: 'heartRate' | 'bloodOxygen' | 'hrv' | 'stressLevel';
  title: string;
  unit: string;
  color: string;
}

const CHART_HEIGHT = 180;
const PADDING_TOP = 25;
const PADDING_BOTTOM = 30;
const PADDING_LEFT = 35;
const PADDING_RIGHT = 20;

export const TrendChart: React.FC<TrendChartProps> = ({ data, metricKey, title, unit, color }) => {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(280, width - 40);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  data = (data || []).filter((point) => point.source === 'real' && point.signalQuality === 'good'
    && typeof point.sampleAgeMs === 'number' && point.sampleAgeMs >= 0 && point.sampleAgeMs <= 15000
    && ((metricKey === 'heartRate' && point.heartRateValid === true && point.heartRate > 0)
      || (metricKey === 'bloodOxygen' && point.bloodOxygenValid === true && point.spo2Calibrated === true && point.bloodOxygen > 0)
      || (metricKey === 'hrv' && point.validity?.hrv === true && typeof point.hrv === 'number' && point.hrv >= 0)));
  if (!data || data.length === 0) {
    return (
      <View style={[styles.card, styles.emptyContainer]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.emptyText}>Recibiendo telemetría en tiempo real para generar tendencias...</Text>
      </View>
    );
  }

  const values = data.map((d) => Number(d[metricKey] || 0)).filter((v) => !isNaN(v));
  if (values.length === 0) {
    return (
      <View style={[styles.card, styles.emptyContainer]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.emptyText}>Esperando lecturas de sensores...</Text>
      </View>
    );
  }

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const avgVal = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

  const range = maxVal - minVal || 1;
  const yMin = Math.floor(minVal - range * 0.15);
  const yMax = Math.ceil(maxVal + range * 0.15);
  const effectiveHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const effectiveWidth = chartWidth - PADDING_LEFT - PADDING_RIGHT;

  const points = data.map((point, index) => {
    const x = PADDING_LEFT + (index / Math.max(1, data.length - 1)) * effectiveWidth;
    const val = Number(point[metricKey] || 0);
    const norm = (yMax - yMin > 0) ? (val - yMin) / (yMax - yMin) : 0.5;
    const y = CHART_HEIGHT - PADDING_BOTTOM - norm * effectiveHeight;
    return { x, y, value: val, label: point.timeLabel || '' };
  });

  const createSmoothPath = () => {
    if (points.length < 2) {
      if (points.length === 1) {
        return `M ${points[0].x} ${points[0].y} L ${chartWidth - PADDING_RIGHT} ${points[0].y}`;
      }
      return '';
    }
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cx = (p0.x + p1.x) / 2;
      d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
  };

  const linePath = createSmoothPath();

  const areaPath = points.length > 0 ? `
    ${linePath}
    L ${points[points.length - 1].x} ${CHART_HEIGHT - PADDING_BOTTOM}
    L ${points[0].x} ${CHART_HEIGHT - PADDING_BOTTOM}
    Z
  ` : '';

  const selectedPoint = selectedIndex !== null && points[selectedIndex] ? points[selectedIndex] : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.statSummary}>
            Promedio: <Text style={{ color, fontWeight: '700' }}>{avgVal} {unit}</Text>
          </Text>
        </View>

        <View style={styles.minMaxContainer}>
          <View style={styles.pillBadge}>
            <Text style={styles.pillLabel}>Mín</Text>
            <Text style={styles.pillVal}>{minVal}</Text>
          </View>
          <View style={[styles.pillBadge, { marginLeft: 6 }]}>
            <Text style={styles.pillLabel}>Máx</Text>
            <Text style={styles.pillVal}>{maxVal}</Text>
          </View>
        </View>
      </View>

      {selectedPoint && (
        <View style={styles.tooltip}>
          {selectedPoint.label ? <Text style={styles.tooltipTime}>{selectedPoint.label}</Text> : null}
          <Text style={[styles.tooltipValue, { color }]}>
            {selectedPoint.value} {unit}
          </Text>
        </View>
      )}

      <Svg width={chartWidth} height={CHART_HEIGHT}>
        <Defs>
          <LinearGradient id="chartAreaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <Stop offset="100%" stopColor={color} stopOpacity={0.0} />
          </LinearGradient>
        </Defs>

        <Line
          x1={PADDING_LEFT}
          y1={PADDING_TOP}
          x2={chartWidth - PADDING_RIGHT}
          y2={PADDING_TOP}
          stroke="#E2E8F0"
          strokeDasharray={[4, 4]}
          strokeWidth={1}
        />
        <Line
          x1={PADDING_LEFT}
          y1={CHART_HEIGHT / 2}
          x2={chartWidth - PADDING_RIGHT}
          y2={CHART_HEIGHT / 2}
          stroke="#E2E8F0"
          strokeDasharray={[4, 4]}
          strokeWidth={1}
        />
        <Line
          x1={PADDING_LEFT}
          y1={CHART_HEIGHT - PADDING_BOTTOM}
          x2={chartWidth - PADDING_RIGHT}
          y2={CHART_HEIGHT - PADDING_BOTTOM}
          stroke="#E2E8F0"
          strokeWidth={1}
        />

        <SvgText x={PADDING_LEFT - 6} y={PADDING_TOP + 4} fill={Colors.textMuted} fontSize={10} textAnchor="end">
          {yMax}
        </SvgText>
        <SvgText x={PADDING_LEFT - 6} y={CHART_HEIGHT - PADDING_BOTTOM} fill={Colors.textMuted} fontSize={10} textAnchor="end">
          {yMin}
        </SvgText>

        {areaPath ? <Path d={areaPath} fill="url(#chartAreaGradient)" /> : null}
        {linePath ? <Path d={linePath} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" /> : null}

        {points.map((p, idx) => {
          const isSelected = selectedIndex === idx;
          return (
            <React.Fragment key={idx}>
              <Circle
                cx={p.x}
                cy={p.y}
                r={isSelected ? 6 : 4}
                fill={isSelected ? '#FFF' : color}
                stroke="#FFFFFF"
                strokeWidth={2}
              />
              {(points.length <= 7 || idx % Math.ceil(points.length / 5) === 0 || idx === points.length - 1) && p.label && (
                <SvgText
                  x={p.x}
                  y={CHART_HEIGHT - 10}
                  fill={Colors.textSecondary}
                  fontSize={10}
                  textAnchor="middle"
                >
                  {p.label}
                </SvgText>
              )}
            </React.Fragment>
          );
        })}
      </Svg>

      <View style={styles.touchOverlay}>
        {points.map((_, idx) => (
          <TouchableOpacity
            key={idx}
            style={styles.touchTarget}
            onPress={() => setSelectedIndex(idx === selectedIndex ? null : idx)}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    position: 'relative',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  emptyContainer: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  statSummary: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  minMaxContainer: {
    flexDirection: 'row',
  },
  pillBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
  },
  pillLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  pillVal: {
    fontSize: 12,
    color: Colors.textPrimary,
    fontWeight: '700',
  },
  tooltip: {
    position: 'absolute',
    top: 55,
    right: 20,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  tooltipTime: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginRight: 6,
  },
  tooltipValue: {
    fontSize: 12,
    fontWeight: '800',
  },
  touchOverlay: {
    position: 'absolute',
    top: PADDING_TOP + 45,
    left: PADDING_LEFT + 16,
    right: PADDING_RIGHT + 16,
    height: CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM,
    flexDirection: 'row',
  },
  touchTarget: {
    flex: 1,
    height: '100%',
  },
});
