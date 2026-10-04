# Revisión de las reglas del semáforo y las alertas

Documento para que un **profesor o profesional de salud** revise las reglas fijas de SpiroScan antes de la feria.
Son reglas escritas por el equipo, no una IA entrenada. El semáforo usa la valoración de
`Backend/clinical_assessment.py` (a través de `Backend/triage.py`); las alertas viven en `Backend/alerts.py`.

**Cómo usarlo:** marcar ✔ si la regla está bien o anotar el valor sugerido en la última columna.

## 1. Datos que entran a la valoración
| Dato | Cómo se usa | ¿OK? / valor sugerido |
|---|---|---|
| Pulso | Mediana del último minuto, solo con al menos 3 lecturas válidas y la última también válida | |
| Pulso del firmware original (sin indicadores de calidad) | El servidor lo da por válido solo con dedo puesto, entre 30 y 220 BPM y estable en 3 lecturas seguidas (diferencia de 20 BPM o menos, en 15 s) | |
| SpO2 | Solo si el dispositivo la marca como válida **y calibrada**. Hoy ningún firmware la tiene calibrada, así que no se usa | |
| Grabaciones | La última de cada foco/zona en los últimos 30 minutos; una repetición fallida reemplaza a la anterior del mismo foco | |
| Casos demo ICBHI | Cuentan en su sesión, siempre con el aviso "Caso de demostración ICBHI, no es de esta persona" | |
| Síntomas, edad, reposo, altitud | Respuestas Sí/No/No sé del formulario de Auscultación; "No sé" no cuenta como "No" | |

## 2. Semáforo
| Nivel | Regla actual | ¿OK? / valor sugerido |
|---|---|---|
| 🔴 ROJO | Algún síntoma de alarma: dificultad respiratoria intensa, labios o piel azulados, confusión nueva, desmayo o dolor en el pecho | |
| 🔴 ROJO | SpO2 válida y calibrada < 90 % | |
| 🟡 AMARILLO | SpO2 válida y calibrada < 94 % | |
| 🟡 AMARILLO | Pulso < 45 o > 120 BPM, solo en adultos (18 años o más) en reposo declarado | |
| 🟡 AMARILLO | Grabación de corazón anormal (red neuronal sobre su umbral) → sugerir valoración y ecocardiograma | |
| 🟡 AMARILLO | Grabación de pulmón anormal | |
| 🟡 AMARILLO | Algún síntoma comunicado (tos, fiebre, sibilancias, etc.) o una posibilidad a confirmar | |
| ⚪ GRIS | Sin hallazgos, pero faltan datos (edad, reposo, altitud, síntomas sin contestar, pulso, SpO2 calibrada, los 4 focos del corazón o una grabación de pulmón) | |
| 🟢 VERDE | Sin hallazgos y sin datos faltantes | |

**Nota:** como la SpO2 calibrada todavía no está disponible, el semáforo hoy **no puede llegar a VERDE**:
sin hallazgos queda en GRIS ("no se puede concluir que todo esté normal").

**Posibilidades a confirmar** (nunca diagnósticos ni porcentajes; solo adultos):
- Asma u otras causas de sibilancias: sibilancias comunicadas o detectadas en una grabación.
- EPOC a investigar: 35 años o más, tabaquismo y tos o falta de aire.
- Infección respiratoria / neumonía: tos y fiebre comunicadas.
- Insuficiencia cardíaca u otras causas de congestión: falta de aire con dificultad al acostarse o hinchazón.

## 3. Alertas en vivo (`alerts.py`)
Las de signos vitales se disparan cuando la condición se **mantiene** el tiempo indicado (si los paquetes se
interrumpen más de 3 s, el conteo vuelve a empezar). La misma alerta no se repite antes de 2 minutos.

| Alerta | Condición | Tiempo sostenido | ¿OK? / valor sugerido |
|---|---|---|---|
| SpO2 muy baja (crítica) | SpO2 válida y calibrada < 90 % | 10 s | |
| SpO2 reducida | 90 ≤ SpO2 válida y calibrada < 94 % | 30 s | |
| Pulso elevado | > 120 BPM, adulto en reposo declarado | 10 s | |
| Pulso bajo | < 45 BPM, adulto en reposo declarado | 10 s | |
| Sensor sin lectura | Dispositivo real conectado sin pulso válido | 15 s | |
| Sonido cardíaco anormal (precaución) | Grabación de corazón anormal | Inmediata | |
| Posible hallazgo pulmonar (precaución) | Grabación de pulmón anormal | Inmediata | |
| Calidad insuficiente (informativa) | Grabación muy corta (< 5 s corazón, < 8 s pulmón), en silencio, saturada o sin variación | Inmediata | |

Las alertas de grabaciones simuladas o de origen desconocido no se disparan; las de un caso demo ICBHI sí,
con el título "DEMO · …". El texto lo redacta Qwen en lenguaje claro solo si no agrega cifras; si no, queda la plantilla.

## 4. Umbrales de los modelos (para conocimiento del revisor)
| Modelo | Umbral | Criterio |
|---|---|---|
| Red neuronal del corazón | ≈ 82 % de puntuación | Elegido para detectar al menos 85 % de los anormales en validación (tamizaje) |
| Red neuronal de pulmón: sibilancias | ≈ 77 % (grabación completa) | Calibrado con grabaciones completas de ICBHI; se muestra |
| Red neuronal de pulmón: crepitantes y patrón por enfermedad | — | No se muestran por baja confiabilidad |
| Modelo base de pulmón (regresión logística) | 30 % | Calibrado por su autor para no dejar pasar casos. Solo en casos demo: con 24 pacientes no vistos, sensibilidad 90 % y especificidad 31 % (IA/modelo_base) |

## 5. Preguntas para el revisor
1. ¿Los umbrales de SpO2 (90 % y 94 %) son adecuados, considerando la altitud de Guatemala?
2. ¿Un sonido cardíaco anormal debería ser AMARILLO siempre, o ROJO en algún caso?
3. ¿Qué rangos de pulso convienen para niños (hoy no se aplica ninguna regla de pulso a menores de 18)?
4. ¿Qué texto de recomendación prefiere para la referencia (ecocardiograma, centro de salud, urgencias)?

Revisado por: ______________________   Fecha: ____________
