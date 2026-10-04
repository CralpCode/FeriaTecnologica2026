import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './ui/Text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useVitals } from '../context/VitalsContext';

/** Franja visible cuando la app no puede comunicarse con el servidor (la Mac). */
export const ConnectionBanner: React.FC = () => {
  const { isBackendOnline } = useVitals();
  if (isBackendOnline) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <MaterialCommunityIcons name="server-network-off" size={18} color="#FFFFFF" />
      <Text style={styles.text}>
        Sin conexión con el servidor SpiroScan. Reintentando… Revisa que la Mac esté encendida y en la misma red.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.danger,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  text: { flex: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
