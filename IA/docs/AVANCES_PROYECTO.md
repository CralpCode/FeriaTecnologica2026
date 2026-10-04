# BITÁCORA DE AVANCES DEL PROYECTO
> **Proyecto:** Monitor Portátil de Salud Cardiorrespiratoria (Óptico + Acústico)  
> **Asignatura:** f tecno (8vo Semestre - 2026)  
> **Última actualización:** Septiembre 2026

Este documento registra cronológicamente los hitos alcanzados, las decisiones técnicas adoptadas y el estado actual de madurez del prototipo.

---

## Estado General del Proyecto

```
[FASE 1: Conceptualización y Selección de Hardware]   ██████████ 100% (Completada)
[FASE 2: Estructuración y Curación de Datos Clínicos]  ██████████ 100% (ICBHI y PhysioNet 100% poblados y verificados)
[FASE 3: Ensamble Físico y Pruebas Unitarias]          ███░░░░░░░  30% (Componentes adquiridos, pinout asignado)
[FASE 4: Firmware y Procesamiento de Señales en ESP32] █░░░░░░░░░  10% (Arquitectura definida)
[FASE 5: Modelado de IA y Calibración Clínica]         █████░░░░░  50% (Pipeline modular listo, baseline 75.77% ICBHI Score)
[FASE 6: Carcasa e Integración Final]                  ░░░░░░░░░░   0% (Pendiente)
```

---

## Hito 1: Conceptualización y Definición del Problema Médico
* **Fecha:** Septiembre 2026
* **Avance:**
  * Se analizó el panorama de enfermedades respiratorias de alta incidencia (asma, EPOC, neumonía, bronquiolitis) y las tecnologías comúnmente empleadas en instrumentación biomédica (oximetría, espirometría, auscultación digital).
  * Se tomó la decisión de diseñar un **dispositivo híbrido no invasivo (óptico + acústico)**:
    * El canal óptico (MAX30102) evalúa el impacto sistémico mediante la saturación de oxígeno ($SpO_2$) y la frecuencia cardíaca.
    * El canal acústico (INMP441) registra la signología pulmonar directa (tos, ruidos respiratorios) y actividad cardíaca.
  * Se contempló la barra de LEDs Neopixel como actuador visual multipropósito (en el chat previo la IA sugirió la idea tentativa de un semáforo de colores para triaje, pero el uso definitivo de la interfaz visual queda abierto a las necesidades de la implementación que se elija).

---

## Hito 2: Selección y Adquisición de Componentes de Hardware
* **Fecha:** Septiembre 2026
* **Avance:**
  * Se adquirió el conjunto de componentes físicos necesarios para el prototipo:
    1. **ESP32:** Seleccionado como controlador principal debido a su arquitectura de doble núcleo, soporte nativo de hardware para el bus **I2S** (imprescindible para audio digital), bus **I2C**, y conectividad Wi-Fi/Bluetooth integrada para fases posteriores.
    2. **MAX30102:** Sensor óptico integrado de fotopletismografía reflexiva con LEDs rojo e infrarrojo para pulsioximetría.
    3. **INMP441:** Micrófono digital omnidireccional con salida I2S de bajo ruido y respuesta en frecuencia adecuada para auscultación torácica y tos.
    4. **Módulo Neopixel WS2812 (8 LEDs):** Barra direccionable de alta luminosidad para indicadores de pulso, nivel sonoro (VU-meter) y semáforo de alerta clínica.
    5. **Módulo TP4056:** Placa de carga para baterías de Litio (Li-Ion/LiPo) con protección contra sobredescarga y sobrecarga.
    6. **Switch Rocker On-Off (6A 125V):** Interruptor mecánico para corte físico y seguro de la alimentación general.
    7. **Batería de Litio (3.7V):** Fuente autónoma de energía para operación portátil e inalámbrica.

---

## Hito 3: Propuesta de Arquitectura Eléctrica y Asignación de Pines (Pinout)
* **Fecha:** Septiembre 2026
* **Fuente:** Recomendación técnica generada en el chat previo *"Diagnóstico de Enfermedades Respiratorias"* (25/Sep/2026) a partir de los componentes confirmados por el usuario.
* **Avance:**
  * Se definió un esquema de conexiones recomendado para evitar colisiones de buses internos en el ESP32 y asegurar compatibilidad lógica a 3.3V:
    * **Bus I2C (MAX30102):** GPIO 21 (SDA), GPIO 22 (SCL). Alimentación a 3.3V.
    * **Bus I2S (INMP441):** GPIO 32 (SD), GPIO 25 (WS / LRCLK), GPIO 26 (SCK / BCLK), L/R a GND (canal izquierdo). Alimentación a 3.3V.
    * **Línea de Datos Neopixel:** GPIO 4 (DIN). Alimentación conectada a VIN (batería/5V).
    * **Línea de Energía:** Batería conectada a `B+/B-` del TP4056; la salida `OUT+` pasa por el switch mecánico hacia el pin `VIN` del ESP32; `OUT-` a `GND` común.
  * **Estatus:** Es un diseño teórico preliminar recomendado, listo para ser cableado y probado en protoboard.

---

## Hito 4: Recopilación y Curación de Datos Clínicos de Referencia
* **Fecha:** Septiembre 2026
* **Avance:**
  * **Dataset PhysioNet 2016 (Sonidos Cardíacos):**
    * Se integraron exitosamente **3,541 archivos de audio `.wav`** y metadatos clínicos: 3,240 grabaciones de entrenamiento distribuidas en los subconjuntos `training-a` a `training-f` y 301 en `validation - pruebas realizadas`.
    * Se verificó la disponibilidad de etiquetas de normalidad/anormalidad (`REFERENCE.csv`) y trazos de cabecera (`.hea`) y sincronización ECG (`.dat`).
  * **Dataset ICBHI 2017 (Sonidos Respiratorios):**
    * Se consolidó la información demográfica de los 126 pacientes en la hoja [ICBHI_2017_pacientes_filtrable_1.xlsx](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/ICBHI_2017_pacientes_filtrable_1.xlsx) con capacidad de filtrado interactivo por patología y grupo de edad.
    * Se estructuró el directorio [ICBHI_organizado - pacientes de los links filtrados](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/ICBHI_organizado%20-%20pacientes%20de%20los%20links%20filtrados/) en 16 categorías clínicas cruzadas.
    * Se generaron las 126 fichas de pacientes en formato CSV individual (`datos_paciente_<id>.csv`).
    * Se colocaron instrucciones de automatización (`LEEME.txt`) para la vinculación final de las grabaciones de audio `.wav` pendientes de descarga desde Kaggle.

---

## Hito 5: Estructuración de la Documentación del Repositorio
* **Fecha:** Septiembre 2026
* **Avance:**
  * Se crearon los manuales y registros de control de ingeniería:
    * `INSTRUCCIONES_PROYECTO.md`: Guía de contexto y reglas técnicas para futuros chats y desarrolladores.
    * `docs/RESUMEN_DATOS.md`: Mapeo exhaustivo, tablas cuantitativas y diccionario de variables de las bases de datos.
    * `docs/AVANCES_PROYECTO.md`: Registro de bitácora y estado de avance.
    * `docs/TAREAS_PENDIENTES.md`: Backlog priorizado de actividades a ejecutar.
    * `Objetivo.md`: Declaración formal del propósito y metas del proyecto.

---

## Hito 6: Población y Organización Automatizada de ICBHI 2017 (920 Grabaciones)
* **Fecha:** Septiembre 2026
* **Avance:**
  * Se implementó el script de distribución automatizada [organizar_por_categoria.py](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/organizar_por_categoria.py) (operativo con Python estándar sin dependencias externas).
  * Se transfirieron e indexaron **920 archivos `.wav`** y **920 archivos de anotación de ciclos `.txt`** desde `data/ICBHI_final_database/` hacia las 16 categorías clínicas y 126 carpetas de pacientes en `data/ICBHI_organizado - pacientes de los links filtrados/`.
  * Se verificó la consistencia estricta de pares (1:1 `.wav` y `.txt`) para cada uno de los 126 pacientes y se eliminaron los 126 marcadores temporales `LEEME.txt`.

---

## Hito 7: Homologación de Arquitectura con `FeriaTecnologica2026` y Asignación de Mac Studio
* **Fecha:** Octubre 2026
* **Avance:**
  * Se realizó la auditoría técnica del repositorio hermano [`FeriaTecnologica2026`](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/FeriaTecnologica2026), estableciendo la sinergia de integración: nuestro repositorio aporta el "Cerebro Clínico" (datasets curados y modelos de clasificación acústica entrenados) y el repositorio hermano aporta la "Infraestructura de Despliegue" (App Móvil React Native, Backend FastAPI y simulador Wokwi).
  * Se homologó la asignación de pines del ESP32 (`SCK=14, WS=15, SD=32, Neopixel=25, Botón=17`) en toda la documentación técnica para garantizar total compatibilidad con el firmware de producción y el circuito virtual en Wokwi.
  * **Asignación de Infraestructura Remota:** Se definió que el backend FastAPI, la base de datos persistente SQLite y el contenedor Docker con Ollama (**LLaMA 3.2 3B**) estarán alojados en una **Apple Mac Studio** (procesador Apple Silicon M-series) ubicada en una locación remota fija. Se accederá a ella a través de Internet mediante un túnel seguro público (**Cloudflare Tunnel** o **ngrok**), permitiendo aprovechar la aceleración por hardware de Apple Silicon sin tener que transportar la máquina al evento, requiriendo conexión a Internet en el stand (vía *hotspot* 4G/5G o Wi-Fi).
  * Se creó la guía conceptual viva de resolución de dudas técnicas y médicas en [docs/RESOLUCION_DUDAS.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/RESOLUCION_DUDAS.md).

---

## Hito 8: Plan Inicial de Implementación para Ciencia de Datos e IA (Bloque B)
* **Fecha:** Octubre 2026
* **Avance:**
  * Se definió la hoja de ruta técnica completa para el Bloque B en [docs/PLAN_INICIAL_DATOS_IA.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/PLAN_INICIAL_DATOS_IA.md), estructurando 6 hitos incrementales: desde la preparación del entorno y loader de anotaciones, hasta la extracción de características acústicas (MFCC, RMS, ZCR), entrenamiento con partición *patient-wise* (sin data leakage) y exportación hacia el servidor Mac Studio (`ai_engine.py`).
  * Se configuró el archivo maestro de dependencias [requirements.txt](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/requirements.txt) y se creó la estructura modular de directorios (`src/`, `notebooks/`, `models/`).

---

## Hito 9: Ejecución de Pipeline de Audio, EDA y Modelo Baseline (75.77% ICBHI Score)
* **Fecha:** Octubre 2026
* **Avance:**
  * **Entorno y Dependencias:** Se inicializó el entorno virtual `.venv` y se instalaron exitosamente todas las librerías científicas (`numpy`, `pandas`, `librosa`, `soundfile`, `scikit-learn`, `matplotlib`, `seaborn`, `jupyterlab`).
  * **Módulos de Producción (`src/`):**
    * [src/data_loader.py](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/src/data_loader.py): Parser verificado que indexó **6,898 ciclos respiratorios** de los 126 pacientes y 920 archivos `.wav`/`.txt`.
    * [src/audio_processing.py](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/src/audio_processing.py): Filtrado Butterworth paso-banda (100–2000 Hz), remuestreo a 16 kHz y segmentación fija a 4.0s.
    * [src/feature_extraction.py](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/src/feature_extraction.py): Extracción de 61 variables acústicas (MFCCs estáticos, $\Delta$ y $\Delta\Delta$, energía RMS, ZCR, centroide espectral y roll-off).
    * [src/evaluate.py](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/src/evaluate.py): Evaluación con cálculo de Sensibilidad, Especificidad e ICBHI Score.
    * [src/train.py](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/src/train.py): Entrenamiento con partición estricta por paciente (*patient-wise*) y serialización a `models/clasificador_respiratorio.joblib`.
  * **Análisis Exploratorio (EDA):** Se crearon los cuadernos [notebooks/01_exploracion_audio_eda.ipynb](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/notebooks/01_exploracion_audio_eda.ipynb) y se exportaron las figuras comparativas a [docs/figuras_eda/](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/figuras_eda/).
  * **Resultados Clínicos del Baseline (Random Forest):**
    * **Sensibilidad (Detección de anomalías):** $75.94\%$
    * **Especificidad (Confirmación de ciclo normal):** $75.61\%$
    * **Score Oficial ICBHI:** $\mathbf{75.77\%}$

---

## Hito 10: Extracción Masiva del Dataset Completo (6,898 Ciclos) y Benchmark Clínico de 5 Modelos
* **Fecha:** Octubre 2026
* **Avance:**
  * **Persistencia del Dataset Tabular:** Se implementó [src/extract_all_features.py](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/src/extract_all_features.py), procesando a 100 ciclos/s los 920 audios y serializando el archivo final [data/features_icbhi_dataset.csv](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/features_icbhi_dataset.csv) (8.96 MB, 6,898 filas y 61 columnas acústicas predictoras).
  * **Benchmark Clínico (5-Fold GroupKFold Patient-Wise):** Se construyó y ejecutó [src/compare_models.py](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/src/compare_models.py) evaluando 5 algoritmos sin contaminación entre pacientes:
    1. **Regresión Logística L2 (Modelo Campeón):** Score ICBHI **61.22%**, Sensibilidad **62.95%**, Especificidad **59.49%**, F1-Score **60.52%**, Tiempo de inferencia **0.17 s**.
    2. **Random Forest:** Score ICBHI **59.89%** (Se: 55.94%, Sp: 63.84%).
    3. **Extra Trees:** Score ICBHI **59.68%** (Se: 57.60%, Sp: 61.76%).
    4. **HistGradientBoosting:** Score ICBHI **59.07%** (Se: 52.71%, Sp: 65.44%).
    5. **SVM (RBF Kernel):** Score ICBHI **58.70%** (Se: 56.68%, Sp: 60.72%).
  * **Entregables:**
    * Gráfica comparativa publicada en [docs/figuras_eda/comparativa_modelos_icbhi.png](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/figuras_eda/comparativa_modelos_icbhi.png).
    * Modelo Campeón serializado y listo para producción en [models/mejor_clasificador_icbhi.joblib](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/models/mejor_clasificador_icbhi.joblib).

---

## Hito 11: Conexión del Modelo de IA al Backend de Despliegue (`ai_engine.py`)
* **Fecha:** Octubre 2026
* **Avance:**
  * Se transfirió el modelo campeón a [`FeriaTecnologica2026/Backend/models/mejor_clasificador_icbhi.joblib`](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/FeriaTecnologica2026/Backend/models/mejor_clasificador_icbhi.joblib) junto a su versión autónoma en formato JSON [`modelo_icbhi_exportado.json`](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/FeriaTecnologica2026/Backend/models/modelo_icbhi_exportado.json) (5 KB, cero dependencias).
  * **Integración en `ai_engine.py`:**
    * Implementación de la función de inferencia `classify_respiratory_features()` capaz de clasificar vectores acústicos con doble motor (scikit-learn pipeline o fallback matemático transparente).
    * Vinculación en `analyze_vitals_report()`: Si la telemetría incluye ruidos adventicios o variables acústicas, el sistema computa el riesgo respiratorio, añade la anomalía clínica y ajusta el health score.
    * Vinculación con Ollama (LLaMA 3.2 3B): La función `generate_chat_reply()` inyecta el diagnóstico acústico del modelo en el *system prompt* para que el LLM explique las sibilancias o crepitantes con base científica.
  * **Nuevo Endpoint REST en `main.py`:** Se implementó `POST /api/ai/audio/classify` para recibir paquetes acústicos de la auscultación y emitir el diagnóstico en vivo.






