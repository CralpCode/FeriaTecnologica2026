# BITÁCORA DE AVANCES DEL PROYECTO
> **Proyecto:** Monitor Portátil de Salud Cardiorrespiratoria (Óptico + Acústico)  
> **Asignatura:** f tecno (8vo Semestre - 2026)  
> **Última actualización:** Septiembre 2026

Este documento registra cronológicamente los hitos alcanzados, las decisiones técnicas adoptadas y el estado actual de madurez del prototipo.

---

## Estado General del Proyecto

```
[FASE 1: Conceptualización y Selección de Hardware]   ██████████ 100% (Completada)
[FASE 2: Estructuración y Curación de Datos Clínicos]  ████████░░  85% (Estructura lista, audios ICBHI pendientes de descarga)
[FASE 3: Ensamble Físico y Pruebas Unitarias]          ███░░░░░░░  30% (Componentes adquiridos, pinout asignado)
[FASE 4: Firmware y Procesamiento de Señales en ESP32] █░░░░░░░░░  10% (Arquitectura definida)
[FASE 5: Modelado de IA y Calibración Clínica]         ░░░░░░░░░░   0% (Pendiente)
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
