import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { VitalStatus } from '../types/vitals';

interface MetricCardProps {
  title: string;
  value: string | number;
  unit: string;
  icon?: any;
  iconName?: any;
  iconColor?: string;
  color?: string;
  softColor?: string;
  status: VitalStatus;
  statusText: string;
  subtitle?: string;
  customVisual?: React.ReactNode;
  onPress?: () => void;
  fullWidth?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  unit,
  icon,
  iconName,
  iconColor,
  color,
  softColor,
  status,
  statusText,
  subtitle,
  customVisual,
  onPress,
  fullWidth = false,
}) => {
  const finalIcon = iconName || icon || 'heart-pulse';
  const finalColor = color || iconColor || Colors.primary;
  const finalSoftColor = softColor || `${finalColor}18`;

  const iconScale = useRef(new Animated.Value(1)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const liveDotOpacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    let breathAnimation: Animated.CompositeAnimation;

    if (finalIcon === 'heart-pulse' || title.toLowerCase().includes('cardíaco')) {
      // Latido cardíaco fisiológico bifásico (Lub-Dub ventricular) 100% continuo sin cortes ni saltos
      breathAnimation = Animated.loop(
        Animated.sequence([
          // Primer latido sistólico (Lub)
          Animated.timing(iconScale, {
            toValue: 1.25,
            duration: 140,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(iconScale, {
            toValue: 1.05,
            duration: 120,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          // Segundo latido sistólico (Dub)
          Animated.timing(iconScale, {
            toValue: 1.20,
            duration: 130,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(iconScale, {
            toValue: 1.0,
            duration: 180,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          // Pausa diastólica de reposo fisiológico
          Animated.delay(450),
        ])
      );
    } else {
      // Respiración suave y continua para otras métricas
      breathAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(iconScale, {
            toValue: 1.10,
            duration: 1200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(iconScale, {
            toValue: 1.0,
            duration: 1200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );
    }

    const dotAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(liveDotOpacity, {
          toValue: 1.0,
          duration: 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(liveDotOpacity, {
          toValue: 0.35,
          duration: 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    breathAnimation.start();
    dotAnimation.start();

    return () => {
      breathAnimation.stop();
      dotAnimation.stop();
    };
  }, [finalIcon, title, iconScale, liveDotOpacity]);

  const handlePressIn = () => {
    Animated.spring(pressScale, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 30,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(pressScale, {
      toValue: 1.0,
      useNativeDriver: true,
      friction: 4,
    }).start();
  };

  const getStatusBadgeStyle = () => {
    switch (status) {
      case 'critical':
        return { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA' };
      case 'caution':
        return { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' };
      default:
        return { bg: '#F0FDF4', text: '#16A34A', border: '#DCFCE7' };
    }
  };

  const badge = getStatusBadgeStyle();

  return (
    <Animated.View
      style={[
        fullWidth ? styles.fullWrapper : styles.halfWrapper,
        { transform: [{ scale: pressScale }] },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.card,
          status === 'critical' && styles.criticalBorder,
        ]}
      >
        {/* Cabecera de la tarjeta: Icono animado y Badge */}
        <View style={styles.headerRow}>
          <Animated.View
            style={[
              styles.iconWrapper,
              { backgroundColor: finalSoftColor, borderColor: `${finalColor}30`, transform: [{ scale: iconScale }] },
            ]}
          >
            <MaterialCommunityIcons name={finalIcon} size={20} color={finalColor} />
          </Animated.View>

          <View style={[styles.statusBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
            <Animated.View style={[styles.statusDot, { backgroundColor: badge.text, opacity: liveDotOpacity }]} />
            <Text style={[styles.statusBadgeText, { color: badge.text }]}>{statusText}</Text>
          </View>
        </View>

        {/* Título de la métrica */}
        <Text style={styles.titleText}>{title}</Text>

        {/* Valor principal y unidad */}
        <View style={styles.valueRow}>
          <Text style={[styles.valueText, { color: status === 'critical' ? '#DC2626' : Colors.textPrimary }]}>
            {value}
          </Text>
          <Text style={styles.unitText}>{unit}</Text>
        </View>

        {/* Subtítulo o rango */}
        {subtitle && <Text style={styles.subtitleText}>{subtitle}</Text>}

        {/* Barra de telemetría activa en la base */}
        <View style={styles.miniProgressTrack}>
          <Animated.View
            style={[
              styles.miniProgressBar,
              {
                backgroundColor: finalColor,
                opacity: liveDotOpacity,
              },
            ]}
          />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  halfWrapper: {
    width: '48%',
    marginBottom: 8,
  },
  fullWrapper: {
    width: '100%',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  criticalBorder: {
    borderColor: '#DC2626',
    borderWidth: 1.5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  iconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  titleText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  valueText: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginRight: 5,
  },
  unitText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  subtitleText: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 6,
  },
  miniProgressTrack: {
    height: 3,
    backgroundColor: '#F1F5F9',
    borderRadius: 1.5,
    marginTop: 10,
    overflow: 'hidden',
  },
  miniProgressBar: {
    height: '100%',
    width: '75%',
    borderRadius: 1.5,
  },
});
