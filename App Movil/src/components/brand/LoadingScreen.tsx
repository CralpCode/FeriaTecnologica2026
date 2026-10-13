import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LogoFull } from './Logo';

/** Pantalla de carga con el logo (celular). En la web se ve la de public/index.html. */
export const LoadingScreen: React.FC = () => {
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [appear]);
  const scale = appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  return (
    <View style={styles.root} accessibilityLabel="Cargando SpiroScan">
      <Animated.View style={{ opacity: appear, transform: [{ scale }] }}>
        <LogoFull width={260} />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
});
