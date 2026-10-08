# 🎯 Guía Maestra de Recomendaciones para la Presentación y Defensa Técnica (SpiroScan - Feria USAC 2026)

> **Documento Estratégico de Preparación:** Compilación exhaustiva de directrices, críticas de evaluadores técnicos, advertencias metodológicas y diseño narrativo para la exposición del proyecto **SpiroScan (TRL 4)** en la Feria Tecnológica de la Universidad de San Carlos de Guatemala (USAC).

---

## 1. Diagnóstico General y Evaluación del Proyecto

### 1.1. Percepción del Jurado Técnico
* **Proyecto serio y muy por encima del promedio universitario:** La integración física de hardware propio (ESP32, INMP441, MAX30102, carcasa 3D acústica), procesamiento digital de señales (DSP), machine learning real (MFCC, GroupKFold, Regresión Logística L2) y una demostración interactiva en vivo otorgan una solidez notable.
* **Gran acierto institucional:** No vender el sistema como un *"diagnosticador automático infalible"*, sino declarar con honestidad científica su condición de **herramienta experimental de asistencia al tamizaje y triaje inicial (TRL 4)**.

### 1.2. El Mayor Riesgo Identificado
* **El peligro no es parecer poco desarrollado; es que las afirmaciones del equipo parezcan más ambiciosas que la evidencia experimental presentada.**
* Un jurado experimentado en IA y medicina atacará cualquier afirmación que suene a producto clínico terminado o a detección diagnóstica prematura. La credibilidad del proyecto aumenta exponencialmente cuando el equipo delimita con exactitud qué ya demostró y qué pertenece a etapas futuras.

---

## 2. Lo que Más Impresiona al Jurado (Puntos Fuertes a Capitalizar)

### 2.1. Inteligencia Artificial Real, No Solo una Etiqueta
El jurado suele estar cansado de proyectos que dicen *"usamos IA"* pero solo consumen una API externa o muestran una interfaz estética. SpiroScan cuenta con una fundamentación algorítmica demostrable:
* **Datasets de referencia mundial:** ICBHI 2017 (6,898 ciclos respiratorios) y PhysioNet CinC 2016 (3,126 registros PCG).
* **Extracción rigurosa de características:** Vector de 61 descriptores acústicos (13 MFCCs base, 13 Deltas, 13 Delta-Deltas, RMS Energy, Zero Crossing Rate, Spectral Centroid, Spread, Skewness, Kurtosis, Rolloff, Flux).
* **Clasificador determinista:** Regresión Logística con regularización L2.
* **Protocolo de validación:** Partición estricta por paciente (*patient-wise* con `GroupKFold`), eliminando la fuga de datos por timbre vocal.
* **Métricas auditables:** 61.22% ICBHI Score con una latencia de inferencia de apenas 0.17 segundos.

### 2.2. Honestidad Transparente con el Nivel TRL 4
* En lugar de inflar resultados con frases como *"nuestra IA detecta neumonía con 95% de precisión"* (lo cual detonaría preguntas inmediatas sobre sesgo de cohorte, fuga de datos o sobreajuste), declarar **TRL 4 (Prueba de concepto en laboratorio)** desarma las críticas destructivas y ubica al proyecto en el terreno de la ingeniería rigurosa.

### 2.3. Dimensión Física Tangible (El Hardware como Conexión)
* La mayoría de proyectos de software en ferias presentan: $\text{dataset} \rightarrow \text{modelo} \rightarrow \text{predicción}$.
* SpiroScan presenta una cadena completa de ingeniería:
  $$\text{Cuerpo Humano} \longrightarrow \text{Transductor Acústico/Óptico} \longrightarrow \text{Señal Digital} \longrightarrow \text{DSP} \longrightarrow \text{IA Ligera} \longrightarrow \text{Interfaz de Triaje}$$
* La carcasa impresa en 3D, la cámara cónica hiperbólica y el sándwich aislante permiten mostrar un objeto físico mientras se explica la lógica del modelo matemático.

---

## 3. Puntos Críticos que Deben Cambiarse (Errores Fatales a Evitar)

### ⚠️ Error 1: Intentar Demostrar Demasiadas Cosas a la Vez
* **Problema:** En versiones preliminares, SpiroScan parecía ser simultáneamente: estetoscopio digital, sistema de aislamiento de ruido, pulsioxímetro PPG, detector pulmonar, detector de soplos cardíacos, clasificador de triaje, estudio sociológico de sesgo humano, proyecto de manufactura 3D y plataforma hospitalaria.
* **Riesgo:** El jurado preguntará: *“¿Entonces cuál es exactamente la innovación principal?”*.
* **Solución:** Reducir el mensaje central a una sola premisa:
  > **“SpiroScan convierte señales cardiorrespiratorias en datos digitales limpios y utiliza modelos de aprendizaje automático ligero para apoyar el triaje clínico en atención primaria.”**
  * El hardware es **el medio de adquisición**.
  * La IA es **el componente tecnológico central** que el jurado debe recordar.

---

### ⚠️ Error 2: El 61.22% sin Contexto Riguroso
* **Problema:** Mostrar la frase *"61.22% Score ICBHI Defendible (Rango de la literatura médica 50–65%)"*.
* **Riesgos:**
  1. La palabra *"defendible"* suena a inseguridad o anticipación de pleito.
  2. La frase *"rango de la literatura"* provoca la objeción: *“¿Consideran bueno 61% solo porque otros también sacan eso?”*.
  3. El jurado preguntará inmediatamente: *“¿61.22% de qué? ¿Accuracy? ¿F1? ¿Sensibilidad? ¿Balanced accuracy?”*.
* **Solución:**
  * Eliminar la palabra *"defendible"*.
  * Quitar del texto visible la comparación de 50–65% (reservarla únicamente como argumento oral si un jurado cuestiona la cifra).
  * Redactar con precisión matemática:
    > **61.22% — ICBHI Score**  
    > *Promedio balanceado de Sensibilidad (57.14%) y Especificidad (65.31%) bajo validación Patient-Wise (GroupKFold).*

---

### ⚠️ Error 3: La Línea Roja de Integridad (Dataset Público vs. Hardware Propio)
* **Punto más delicado de toda la defensa:** Los modelos fueron entrenados y validados con los datasets públicos **ICBHI 2017** y **PhysioNet 2016**. El hardware propio genera señales con su propia respuesta en frecuencia, ganancia y acústica mecánica.
* **Pregunta trampa del jurado:** *“¿La IA funciona con las grabaciones tomadas por su propio prototipo?”*.
* **Regla estricta:**
  * **NUNCA decir:** *“El SpiroScan tiene 61.22% de precisión en pacientes”*.
  * **SIEMPRE decir:**
    > **“El modelo alcanzó 61.22% en la evaluación del dataset público internacional ICBHI 2017 bajo partición estricta por paciente. La transferencia clínica y validación pareada con grabaciones del hardware propio constituye la siguiente etapa del proyecto (TRL 5+).”**
* Esta distinción demuestra máxima madurez científica y blindaje ético.

---

### ⚠️ Error 4: Manejo del Estudio Piloto ($N=18$)
* **Problema:** Presentar el estudio con los estudiantes de medicina como prueba de eficacia de la IA o como demostración irrefutable de sesgo clínico.
* **Riesgo:** Con $N=18$, un jurado metodológico desarmará la representatividad estadística, el sesgo de selección y la falta de grupo de control patológico.
* **Solución:**
  * Categorizar formalmente como: **"Estudio exploratorio de viabilidad y línea base metodológica"**.
  * **Moderar el lenguaje del sesgo:**
    * *No decir:* “Demostramos el sesgo humano”.
    * *Decir:* **“Observamos un patrón de concentración en valores pares (76.5%) compatible con redondeo sistemático en el conteo manual tradicional.”**
  * Presentar al participante con sibilancias (*Sujeto 12*) como un **caso ilustrativo exploratorio**, jamás como validación de sensibilidad clínica.

---

### ⚠️ Error 5: Sobreexposición de Detalles de Manufactura y Hardware
* **Problema:** Gastar 5 minutos hablando del grosor de capa del PLA, el infill al 100%, la emulsión de bromuro de plata y los tornillos M3, y solo dedicar 30 segundos a la IA.
* **Solución (Arquitectura en Dos Niveles):**
  * **Nivel 1 (Discurso general):** Mencionar el hardware en 30 segundos como el transductor acústico que permite digitalizar la señal sin ruido.
  * **Nivel 2 (Bajo demanda):** Colocar los despieces mecánicos, curvas de frecuencia y cortes CAD dentro de un **panel colapsable ("Ver detalles de ingeniería")** para consultarlo únicamente si el jurado pregunta específicamente por acústica o materiales.

---

### ⚠️ Error 6: Lenguaje Publicitario vs. Lenguaje de Ingeniería
* La frase *"Un segundo par de oídos para el médico general"* es un excelente **slogan de impacto humano**. Debe mantenerse en la cabecera.
* Sin embargo, debe complementarse de inmediato con una definición técnica formal:
  > **“SpiroScan: Sistema experimental de adquisición y análisis de señales cardiorrespiratorias mediante aprendizaje automático ligero para apoyo al triaje en atención primaria.”**

---

## 4. Estructura Narrativa Recomendada: "Historia Interactiva" en 9 Pasos

En lugar de proyectar diapositivas estáticas estilo PowerPoint, la landing page debe funcionar como una historia guiada de 3 a 5 minutos:

```text
                           LANDING PAGE
                                │
                                ▼
                       1. EL PROBLEMA
                  (Cuello de botella en urgencias)
                                │
                                ▼
                          2. LA IDEA
                 ("Un segundo par de oídos")
                                │
                                ▼
                      3. ¿CÓMO FUNCIONA?
                 (Flujo de señal en 6 etapas)
                                │
                                ▼
                     ┌─────────────────────┐
                     │ 4. DEMOSTRACIÓN EN  │
                     │    VIVO (WEB APP)   │
                     └─────────────────────┘
                                │
                                ▼
                          5. LA IA REAL
                 (61 Features + Regresión L2)
                                │
                                ▼
                       6. RESULTADOS CLAVE
                     (61.22% ICBHI Score)
                                │
                                ▼
                      7. ESTUDIO EXPLORATORIO
                    (Cohorte piloto N=18)
                                │
                                ▼
                       8. LIMITACIONES HOY
                       (TRL 4 vs. TRL 7+)
                                │
                                ▼
                           9. CIERRE
               ("Dar datos objetivos al médico")
```

### Detalle de cada paso narrativo:
1. **El Problema:** El cuello de botella en clínicas comunitarias (ruido de fondo, fatiga auditiva, auscultación subjetiva, retraso de 1 a 2 horas por dudas clínicas y saturación de los 48–49 hospitales públicos del MSPAS).
2. **La Idea:** Convertir la auscultación en datos cuantificables: **Captura $\rightarrow$ Procesa $\rightarrow$ Analiza con IA $\rightarrow$ Apoya el triaje**.
3. **¿Cómo funciona?:** Flujo de 6 pasos (Paciente $\rightarrow$ MEMS I2S $\rightarrow$ ESP32 $\rightarrow$ 61 variables $\rightarrow$ Regresión Logística L2 $\rightarrow$ Semáforo). El hardware 3D se mantiene en un cajón colapsable Nivel 2.
4. **Demostración Real:** La presentación transiciona a la aplicación en vivo (simulador interactivo de triaje con semáforo, mapa anatómico de focos y reproductor Web Audio API).
5. **¿Dónde entra la IA?:** Explicación de la extracción determinista de características (MFCC, energía, cruces por cero) y el modelo clasificador.
6. **Evidencia Experimental:** Métricas limpias (6,898 ciclos, 61.22% ICBHI Score, 0.17 s de latencia).
7. **Piloto Exploratorio ($N=18$):** Dispersión fisiológica, caso sintomático y cuantificación del patrón de números pares (76.5%).
8. **Limitaciones y Madurez ("¿Qué falta para llegar a un hospital?"):**
   * *HOY (TRL 4):* Prototipo funcional integrado, validación en datasets públicos, separación patient-wise.
   * *SIGUIENTE ETAPA (TRL 7+):* Calibración pareada, fantoma acústico, aprobación por Comité de Bioética, ensayo clínico multicéntrico y normas ISO 10993 / IEC 60601-1.
9. **Cierre:** *"SpiroScan no busca reemplazar al médico; busca brindarle datos objetivos para tomar mejores decisiones en el primer nivel de atención."*

---

## 5. Justificación Estratégica: ¿Por Qué Regresión Logística L2 y No Deep Learning?

**Esta es una de las mayores oportunidades para impresionar a un jurado técnico en una feria de IA.**

El equipo **no debe disculparse** por usar Regresión Logística. Al contrario, debe defenderlo como una decisión consciente de ingeniería:
1. **Línea Base Rigurosa:** En bioingeniería, antes de entrenar modelos complejos de caja negra (CNNs, Transformers, AST), es mandatorio establecer una línea base interpretable.
2. **Interpretabilidad Clínica y Bioética:** Los coeficientes lineales $L_2$ permiten identificar exactamente qué bandas de frecuencia dispararon la alerta, facilitando la auditoría médica y cumpliendo con estándares de explicabilidad algorítmica.
3. **Latencia Sub-segundo en Dispositivos Ligeros:** 0.17 segundos de inferencia permiten operar en tiempo real sin requerir aceleradores gráficos (GPUs) costosos ni conectividad permanente a la nube.
4. **Prevención del Sobreajuste:** Con 126 pacientes en el dataset ICBHI, las redes neuronales profundas tienden a memorizar el ruido acústico específico de los micrófonos de recolección en lugar de patrones fisiológicos generales.

> **Frase clave para el jurado:**  
> *“No elegimos el modelo por ser el más complejo o por estar de moda, sino porque en salud pública priorizamos la interpretabilidad de los coeficientes, la ausencia de sobreajuste y una inferencia rápida y ligera.”*

---

## 6. Banco de Respuestas a Preguntas Trampa del Jurado

| Pregunta Trampa del Jurado | Respuesta Recomendada y Blindada |
|---|---|
| **“¿61.22% de qué métrica están hablando?”** | *“Es el ICBHI Score oficial, calculado como el promedio balanceado entre Sensibilidad (57.14%) y Especificidad (65.31%), evaluado estrictamente por paciente mediante GroupKFold para evitar fuga de datos.”* |
| **“¿Su IA ya clasifica los audios que graba su dispositivo propio?”** | *“Actualmente el sistema está en TRL 4: el modelo fue validado con el dataset estándar internacional ICBHI 2017. La adquisición y reentrenamiento pareado con señales de nuestro hardware propio corresponde a la fase TRL 5/6.”* |
| **“¿Por qué no usaron una red neuronal convolucional (CNN) o un Transformer?”** | *“Para establecer una línea base clínicamente interpretable. La regularización L2 nos permite auditar qué coeficientes espectrales determinan la clasificación, logrando inferencia en 0.17 s y minimizando el riesgo de sobreajuste con 126 pacientes.”* |
| **“¿18 estudiantes demuestran que el sistema sirve en clínicas?”** | *“No. El protocolo con 18 estudiantes fue un estudio exploratorio de viabilidad y línea base metodológica para cuantificar la dispersión fisiológica y documentar sesgos de medición manual, no una validación de eficacia clínica.”* |
| **“¿Qué normas aplican a su dispositivo?”** | *“Como meta para TRL 7 identificamos la ISO 10993 para biocompatibilidad dérmica de la membrana y la IEC 60601-1 para seguridad eléctrica del circuito portátil.”* |

---

## 7. Rúbrica de Autoevaluación del Jurado (Referencia Externa)

| Dimensión Evaluada | Calificación Estimada | Recomendación de Refuerzo |
|---|:---:|---|
| **Definición del Problema** | **8.5 / 10** | Centrarse en el cuello de botella de atención primaria en Guatemala. |
| **Integración Hardware + Software** | **9.0 / 10** | Mostrar el prototipo físico sobre la mesa del stand mientras corre la web. |
| **Componente de Inteligencia Artificial** | **8.0 / 10** | Defender la interpretabilidad y el vector de 61 features. |
| **Rigor Metodológico** | **8.0 / 10** | Mantener la separación tajante entre datasets públicos y hardware propio. |
| **Honestidad sobre Limitaciones (TRL 4)** | **9.0 / 10** | Destacar la hoja de ruta hacia TRL 7+ sin promesas comerciales prematuras. |
| **Impacto Visual y Demostración** | **9.0 / 10** | El semáforo en vivo y el osciloscopio virtual generan atención inmediata. |
| **Claridad para Público General** | **7.0 / 10** | Evitar saturar con detalles de materiales salvo pregunta expresa. |
| **Potencial Global en Feria** | **Alto** | Equilibrio ideal entre rigor científico, hardware palpable y demo interactiva. |

---

## 8. Recomendaciones Operativas para el Día de la Exposición

1. **Control Estricto del Tiempo:** Ensayar la historia principal para que tome exactamente **entre 3 y 4 minutos**. Dejar los minutos restantes para preguntas y demostración interactiva.
2. **Modo 100% Offline Garantizado:** Asegurar que la presentación web, el simulador de triaje y la síntesis sonora (Web Audio API) corran localmente sin depender de la red Wi-Fi del recinto.
3. **Acceso Móvil por Código QR:** Colocar un acrílico con código QR en el stand que apunte a la landing (`willor16.github.io/spiroscan` o red local) para que los jueces puedan explorarla en sus teléfonos.
4. **Disposición Física en el Stand:**
   * Colocar la carcasa y los componentes despiezados (cono, diafragma, ESP32) sobre una base limpia al frente.
   * La pantalla debe mostrar el simulador de triaje en vivo listo para interactuar con los deslizadores.
   * Tener a mano audífonos o altavoz pequeño para la demostración acústica de sibilancias y crepitantes.
