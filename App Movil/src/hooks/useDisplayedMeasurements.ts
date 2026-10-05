import { useEffect, useRef, useState } from 'react';
import type { VitalSigns } from '../types/vitals';
import { MeasurementDisplayCache } from '../services/measurementDisplay';

export function useDisplayedMeasurements(vitals: VitalSigns, sessionId: string) {
  const [tick, setTick] = useState(Date.now());
  const cache = useRef(new MeasurementDisplayCache());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // A packet received after the previous timer tick must not appear to be from the future.
  const now = Math.max(tick, Date.now());
  return { now, readings: cache.current.update(vitals, sessionId, now) };
}
