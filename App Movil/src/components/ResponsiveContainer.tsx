import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { CONTENT_MAX_WIDTH, useLayout } from '../hooks/useLayout';

/** Centra el contenido con un ancho máximo para que no se estire en pantallas grandes. */
export const Centered: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({ children, style }) => (
  <View style={[styles.centered, style]}>{children}</View>
);

/**
 * Dos columnas en pantallas anchas; una debajo de la otra en celular y tablet vertical.
 * `leftWeight` controla qué tan ancha es la columna izquierda (por defecto mitad y mitad).
 */
export const Columns: React.FC<{
  left: React.ReactNode;
  right: React.ReactNode;
  leftWeight?: number;
  gap?: number;
}> = ({ left, right, leftWeight = 1, gap = 16 }) => {
  const { twoColumns } = useLayout();
  if (!twoColumns) {
    return (
      <View>
        {left}
        {right}
      </View>
    );
  }
  return (
    <View style={[styles.row, { gap }]}>
      <View style={{ flex: leftWeight, minWidth: 0 }}>{left}</View>
      <View style={{ flex: 1, minWidth: 0 }}>{right}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  centered: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
});
