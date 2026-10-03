# OBJETIVO DEL PROYECTO

## Título del Proyecto
**Desarrollo de un Monitor Portátil No Invasivo de Salud Cardiorrespiratoria (Óptico + Acústico) para Triaje y Detección Temprana de Afecciones Pulmonares**

* **Nivel Académico:** 8vo Semestre (2026)  
* **Asignatura:** *f tecno* (Formación Tecnológica)

---

## 1. Objetivo General
Diseñar, construir y validar una base embebida portátil basada en el microcontrolador **ESP32** para la captura y acondicionamiento de señales biomédicas cardiorrespiratorias, integrando sensores ópticos (**MAX30102**) y acústicos digitales (**INMP441**), alimentación autónoma recargable y soporte para interfaz visual (**Neopixel WS2812**), estructurada bajo una arquitectura modular y desacoplada que permita derivar diferentes implementaciones según los requerimientos del proyecto (triaje clínico, estetoscopio digital inteligente con IA, telemetría IoT o datalogger médico).

---

## 2. Objetivos Específicos

1. **Instrumentación y Hardware Embebido:**
   * Diseñar e implementar el circuito de acondicionamiento e interconexión entre el microcontrolador ESP32 y los sensores periféricos respetando los protocolos digitales correspondientes ($I^2C$ para el MAX30102 e $I2S$ para el micrófono MEMS INMP441).
   * Integrar un subsistema de energía seguro y autónomo compuesto por una batería de litio (3.7V), un cargador con protección (TP4056) y un interruptor mecánico de corte general.

2. **Procesamiento de Señales Biomédicas (DSP):**
   * Desarrollar algoritmos embebidos para el filtrado digital en tiempo real de las señales fotopletismográficas (PPG), permitiendo el cálculo de la saturación arterial de oxígeno ($\%SpO_2$) y la frecuencia cardíaca (BPM).
   * Implementar técnicas de filtrado paso-banda ($100\text{ Hz} - 2000\text{ Hz}$) y análisis de energía (RMS) sobre el flujo de audio digital para aislar ruidos pulmonares, eventos de tos y mitigar artefactos mecánicos y ambientales.

3. **Interfaz Visual y Retroalimentación Modular (Neopixel WS2812):**
   * Implementar el control digital de la barra de 8 LEDs direccionables como actuador visual multipropósito, adaptable a la implementación elegida (pudiendo operar como semáforo de alerta clínica, indicador de pulso, VU-meter de tos/nivel sonoro o monitor de estado del sistema).

4. **Validación con Bases de Datos Clínicas de Referencia:**
   * Utilizar bases de datos biomédicas estándar internacionales (**ICBHI 2017 Challenge** para sonidos respiratorios y **PhysioNet 2016 Challenge** para fonocardiografía) para calibrar el comportamiento del sensor acústico y explorar modelos de clasificación automatizada de patologías (asma, EPOC, neumonía, soplos cardíacos).
   * Validar experimentalmente las lecturas ópticas del prototipo contrastándolas frente a dispositivos médicos comerciales certificados.

---

## 3. Documentación y Recursos Relacionados
* [INSTRUCCIONES_PROYECTO.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/INSTRUCCIONES_PROYECTO.md): Guía de contexto técnico para desarrolladores y chats de IA.
* [docs/RESUMEN_DATOS.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/RESUMEN_DATOS.md): Inventario, conteo y mapeo de las bases de datos acústicas y clínicas.
* [docs/AVANCES_PROYECTO.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/AVANCES_PROYECTO.md): Bitácora de hitos completados y estado del prototipo.
* [docs/TAREAS_PENDIENTES.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/TAREAS_PENDIENTES.md): Hoja de ruta priorizada de actividades pendientes.
* [links.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/links.md): Enlaces a las fuentes originales de datos científicos.
