# Revisión de las reglas del semáforo y las alertas

Documento para que un **profesor o profesional de salud** revise las reglas fijas de SpiroScan antes de la feria.
Son reglas escritas por el equipo, no una IA entrenada. Todas viven en `Backend/triage.py` y `Backend/alerts.py`.

**Cómo usarlo:** marcar ✔ si la regla está bien o anotar el valor sugerido en la última columna.

## 1. Semáforo de triaje (`triage.py`)
Se calcula con la **mediana del último minuto** de lecturas (mínimo 3 lecturas válidas), más la última grabación
de corazón y la última de pulmón de la sesión.

| Nivel | Regla actual | ¿OK? / valor sugerido |
|---|---|---|
| 🔴 ROJO | SpO2 < 90 % | |
| 🔴 ROJO | Hallazgo pulmonar (crepitantes, sibilancias, patrón no sano o modelo base patológico) **y** SpO2 < 94 % | |
| 🟡 AMARILLO | SpO2 entre 90 y 93 % | |
| 🟡 AMARILLO | Pulso > 120 BPM o < 45 BPM | |
| 🟡 AMARILLO | Posible soplo (red neuronal del corazón sobre su umbral) → sugerir ecocardiograma | |
| 🟡 AMARILLO | Hallazgo pulmonar con SpO2 ≥ 94 % | |
| 🟢 VERDE | Hay datos y ninguna regla anterior se cumple | |
| ⚪ GRIS | Sin lecturas suficientes ni grabaciones | |

## 2. Alertas en vivo (`alerts.py`)
Se disparan cuando la condición se **mantiene** el tiempo indicado. La misma alerta no se repite antes de 2 minutos.

| Alerta | Condición | Tiempo sostenido | ¿OK? / valor sugerido |
|---|---|---|---|
| SpO2 muy baja (crítica) | SpO2 < 90 % | 10 s | |
| SpO2 reducida | 90 ≤ SpO2 < 94 % | 30 s | |
| Pulso elevado | > 120 BPM | 10 s | |
| Pulso bajo | < 45 BPM | 10 s | |
| Sensor sin lectura | Dispositivo conectado sin pulso | 15 s | |
| Posible soplo | Grabación de corazón anormal | Inmediata | |
| Posible hallazgo pulmonar | Grabación de pulmón anormal | Inmediata | |
| Calidad insuficiente | Grabación muy corta (< 5 s corazón, < 8 s pulmón) o casi en silencio | Inmediata | |

## 3. Umbrales de los modelos (para conocimiento del revisor)
| Modelo | Umbral | Criterio |
|---|---|---|
| Red neuronal del corazón | ≈ 82 % de probabilidad | Elegido para detectar al menos 85 % de los anormales en validación (tamizaje) |
| Modelo base de pulmón (regresión logística) | 30 % | Calibrado por su autor para no dejar pasar casos |

## 4. Preguntas para el revisor
1. ¿Los umbrales de SpO2 (90 % y 94 %) son adecuados para población pediátrica y adulta, o conviene diferenciarlos?
2. ¿Un posible soplo debería ser AMARILLO siempre, o ROJO en algún caso (por ejemplo, intensidad "moderado o mayor")?
3. ¿Los rangos de pulso (45–120 BPM) aplican igual a niños?
4. ¿Qué texto de recomendación prefiere para la referencia (ecocardiograma, centro de salud, urgencias)?

Revisado por: ______________________   Fecha: ____________
