import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
export type StepAction = {
  label: string; onPress: () => void; icon?: IconName; loading?: boolean; disabled?: boolean;
  variant?: 'primary' | 'secondary';
} | null;

export const StepActionContext = createContext<(a: StepAction) => void>(() => {});

/**
 * Cada paso declara su acción principal ("Guardar y continuar", "Continuar a pulmón"…).
 * La pantalla la muestra fija abajo en celular y al final del paso en pantallas grandes.
 * Siempre llama a la versión más reciente de onPress (sin datos viejos).
 */
export function useStepAction(action: StepAction) {
  const register = useContext(StepActionContext);
  const ref = useRef(action);
  ref.current = action;
  const key = action ? `${action.label}|${action.icon}|${!!action.loading}|${!!action.disabled}|${action.variant}` : '';
  useEffect(() => {
    register(ref.current ? { ...ref.current, onPress: () => ref.current?.onPress() } : null);
  }, [key, register]);
  useEffect(() => () => register(null), [register]);
}

