import React from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { LOGO_MARK_D, LOGO_WORD_D } from './logoPaths';

/** Colores del logo: azul marino a verde, de izquierda a derecha. */
export const BRAND = { navy: '#0E385F', teal: '#1C7F8A', green: '#20BE8C' };

const Gradient: React.FC<{ id: string }> = ({ id }) => (
  <Defs>
    <LinearGradient id={id} gradientUnits="userSpaceOnUse" x1="425" y1="0" x2="612" y2="0">
      <Stop offset="0" stopColor={BRAND.navy} />
      <Stop offset="0.6" stopColor={BRAND.teal} />
      <Stop offset="1" stopColor={BRAND.green} />
    </LinearGradient>
  </Defs>
);

/** Solo los pulmones con el chip y el corazón (cabecera, íconos). */
export const LogoMark: React.FC<{ size: number }> = ({ size }) => (
  <Svg width={size} height={size} viewBox="363 66 308 308" accessibilityLabel="SpiroScan">
    <Gradient id="spiroscan-mark" />
    <Path d={LOGO_MARK_D} fill="url(#spiroscan-mark)" fillRule="evenodd" />
  </Svg>
);

/** Logo completo con la palabra "SpiroScan" (pantalla de carga). */
export const LogoFull: React.FC<{ width: number }> = ({ width }) => (
  <Svg width={width} height={(width * 454) / 676} viewBox="171 66 676 454" accessibilityLabel="SpiroScan">
    <Gradient id="spiroscan-full" />
    <Path d={LOGO_MARK_D + LOGO_WORD_D} fill="url(#spiroscan-full)" fillRule="evenodd" />
  </Svg>
);
