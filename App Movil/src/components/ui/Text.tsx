import React, { createContext, forwardRef, useContext } from 'react';
import { StyleSheet, Text as RNText, TextProps } from 'react-native';
import { familyFor } from '../../theme/fonts';

/** Indica que el texto está dentro de otro Text (hereda la letra si no pide otro grosor). */
const InsideText = createContext(false);

/**
 * Text de la app: igual al de React Native, pero con Inter del grosor pedido.
 * Respeta un fontFamily explícito (p. ej. íconos o monoespaciada) y el texto anidado sin grosor propio.
 */
export const Text = forwardRef<React.ComponentRef<typeof RNText>, TextProps>(({ style, children, ...rest }, ref) => {
  const nested = useContext(InsideText);
  const flat = StyleSheet.flatten(style) || {};
  const pickFamily = !flat.fontFamily && (!nested || flat.fontWeight !== undefined);
  // Cada grosor es su propio archivo: fontWeight queda en 'normal' para que el navegador no lo engrose dos veces.
  const fontStyle = pickFamily ? { fontFamily: familyFor(flat.fontWeight as any), fontWeight: 'normal' as const } : null;
  return (
    <RNText ref={ref} {...rest} style={fontStyle ? [style, fontStyle] : style}>
      <InsideText.Provider value>{children}</InsideText.Provider>
    </RNText>
  );
});
Text.displayName = 'Text';
