# INSTRUCCIONES MAESTRAS DEL PROYECTO
> **Documento de Contexto, Estado Actual y Directrices para Asistentes de IA y Desarrolladores**  
> *Este archivo debe ser consultado al inicio de cualquier sesión de trabajo o chat para mantener la coherencia técnica, saber exactamente qué está listo y qué falta por hacer.*

---

## 1. Identificación y Contexto Académico
* **Proyecto:** Sistema Embebido para Captura y Análisis de Señales Cardiorrespiratorias.
* **Curso / Contexto:** 8vo Semestre (2026) — Asignatura: *f tecno* (Formación Tecnológica / Ingeniería Biomédica / Sistemas Electrónicos).
* **Workspace:** `/Users/wilsonjonatan/Documents/8vo 2026/f tecno/code`
* **Conversación de origen del hardware:** *"Diagnóstico de Enfermedades Respiratorias"* (Chat previo del 25 de septiembre de 2026).
* **Reglas automáticas para IA:** Registradas en [GEMINI.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/GEMINI.md) para autocarga en cada sesión.

---

## 2. Enfoque Actual y Filosofía de Diseño Modular

> 💡 **Principio Fundamental del Proyecto:**  
> **Por el momento, el objetivo central es consolidar una base sólida, confiable y limpia para la CAPTURA Y ACONDICIONAMIENTO DE DATOS biomédicos** (señales ópticas de pulsioximetría y acústica pulmonar/cardíaca con el ESP32).  
> La arquitectura debe ser completamente desacoplada y modular, de modo que una vez que la adquisición de datos sea estable, el equipo pueda elegir o construir **diferentes implementaciones posteriores**.

### A. La Base de Captura de Datos (Fase Actual)
Consiste en lograr que el ESP32 adquiera sin ruido ni pérdidas:
1. **Canal Óptico (Sistémico):** Señales fotopletismográficas (PPG) de luz roja e infrarroja del sensor **MAX30102** vía bus $I^2C$ para medir saturación de oxígeno ($SpO_2$) y pulso cardíaco.
2. **Canal Acústico (Pulmonar y Cardíaco):** Señal de audio digital de alta fidelidad desde el micrófono MEMS **INMP441** vía bus $I2S$ para auscultación torácica y registro de eventos de tos.
3. **Alimentación Autónoma Segura:** Celda de litio con módulo **TP4056** e interruptor mecánico.

### B. Posibles Implementaciones Futuras (A desarrollar sobre la base de captura)
A partir de la misma base de adquisición de datos, se podrán desplegar una o más de las siguientes vertientes según las metas del semestre:

* **Implementación 1: Monitor / Semáforo de Triaje Rápido en Dispositivo**
  * Procesamiento embebido local en el ESP32.
  * Código de semáforo con la barra **Neopixel WS2812** (Verde: normal, Amarillo: alerta, Rojo: hipoxemia).
  * Primer LED pulsando con el ritmo cardíaco y LEDs restantes operando como medidor de nivel acústico / accesos de tos (VU-meter).
* **Implementación 2: Estetoscopio Digital Inteligente con Clasificación IA (TinyML)**
  * Extracción de características de audio (MFCC, energía espectral) y ejecución de un modelo ligero cuantizado con TensorFlow Lite for Microcontrollers en el propio ESP32.
  * Detección automática en tiempo real de anomalías respiratorias (sibilancias, estertores) o soplos cardíacos.
* **Implementación 3: Sistema de Telemedicina y Monitoreo Remoto (IoT)**
  * Transmisión de las señales y métricas adquiridas a través del Wi-Fi o Bluetooth integrado del ESP32.
  * Envío a un dashboard en la nube (ThingsBoard, Firebase, Node-RED) o a una aplicación móvil para visualización del médico a distancia.
* **Implementación 4: Datalogger Holter Cardiorrespiratorio**
  * Almacenamiento masivo continuo de las señales en una tarjeta microSD o memoria Flash SPIFFS para investigación clínica y análisis retrospectivo en Python.

---

## 3. ¿QUÉ SE TIENE ACTUALMENTE? (Inventario Verificado y Disponible)

### A. Hardware Físico Adquirido (En mano del usuario)
* [x] **Microcontrolador ESP32:** Placa de desarrollo (lógica nativa 3.3V, soporte por hardware para I2C e I2S, doble núcleo).
* [x] **Sensor Óptico MAX30102:** Módulo pulsioxímetro y sensor de ritmo cardíaco (comunicación I2C).
* [x] **Micrófono Digital INMP441:** Módulo MEMS omnidireccional con salida digital de audio (protocolo I2S, 3.3V).
* [x] **Barra Neopixel WS2812 (8 LEDs):** Módulo de retroalimentación visual direccionable (1-Wire digital).
* [x] **Módulo Gestor de Carga TP4056:** Placa de carga para baterías de litio con protección y puerto USB.
* [x] **Switch Rocker On-Off (6A 125V):** Interruptor mecánico para corte físico y seguro de alimentación.
* [x] **Batería de Litio (3.7V):** Celda recargable Li-Ion (tipo 18650) o LiPo.

### B. Datos Clínicos y Archivos de Audio Disponibles en `data/`
* [x] **PhysioNet 2016 Challenge (Sonidos Cardíacos / PCG):**
  * **3,240 audios `.wav` de entrenamiento** en 6 subconjuntos (`training-a` a `training-f`) con cabeceras `.hea`, etiquetas `REFERENCE.csv` (1 = Anormal, -1 = Normal) y trazos `.dat`.
  * **301 audios `.wav` de validación** independientes en `validation - pruebas realizadas/` con su respectivo `REFERENCE.csv`.
* [x] **Metadatos ICBHI 2017 Challenge (Sonidos Respiratorios):**
  * Archivo maestro [data/ICBHI_2017_pacientes_filtrable_1.xlsx](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/ICBHI_2017_pacientes_filtrable_1.xlsx) con 126 pacientes clasificados por edad, sexo, diagnóstico clínico (EPOC, Asma, Neumonía, etc.) e IMC.
  * Jerarquía de **16 categorías clínicas cruzadas** creada en [data/ICBHI_organizado - pacientes de los links filtrados](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/data/ICBHI_organizado%20-%20pacientes%20de%20los%20links%20filtrados/).
  * **126 fichas individuales de pacientes** (`datos_paciente_<id>.csv`) con sus datos demográficos completos.
* [x] **Fuentes documentadas:** Enlaces oficiales a PhysioNet, ICBHI y Kaggle registrados en [links.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/links.md).

### C. Sistema Documental
* [x] [GEMINI.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/GEMINI.md): Reglas de workspace auto-cargadas en el entorno.
* [x] [INSTRUCCIONES_DATOS_IA.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/INSTRUCCIONES_DATOS_IA.md): Manual especializado para Fase 2 (Datos Clínicos) y Fase 4 (IA y Clasificación Acústica).
* [x] [Objetivo.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/Objetivo.md): Objetivos generales y específicos del proyecto.
* [x] [docs/RESUMEN_DATOS.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/RESUMEN_DATOS.md): Diccionario de variables, conteos y mapeo exhaustivo de datos.
* [x] [docs/AVANCES_PROYECTO.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/AVANCES_PROYECTO.md): Bitácora de decisiones tomadas e hitos completados.
* [x] [docs/TAREAS_PENDIENTES.md](file:///Users/wilsonjonatan/Documents/8vo%202026/f%20tecno/code/docs/TAREAS_PENDIENTES.md): Backlog operativo priorizado.

---

## 4. Arquitectura Eléctrica y Pinout Propuesto

> ⚠️ **Aclaración sobre la fuente de este Pinout:**  
> Esta asignación de pines proviene de la **recomendación técnica de diseño formulada en el chat previo (*"Diagnóstico de Enfermedades Respiratorias"* del 25 de septiembre de 2026)**.  
> Se basa en las hojas de datos oficiales de Espressif (bus I2C nativo por defecto en pines 21/22 y bus I2S libre de colisiones con los pines de memoria flash).  
> **Estado:** Es un **diseño teórico recomendado**, listo para ser cableado y verificado experimentalmente en protoboard. Si por conveniencia física o tipo de placa ESP32 se requiere reasignar algún pin, se puede modificar antes de soldar.

```
                                  ESP32 DevKit
                             ┌────────────────────┐
                             │                    │
           MAX30102 [VIN] ───┤ 3V3            GND ├─── GND Común
           INMP441  [VDD] ───┤ 3V3            VIN ├─── TP4056 [OUT+] (vía Switch)
                             │                    │
            MAX30102 [SDA] ──┤ GPIO 21            │
            MAX30102 [SCL] ──┤ GPIO 22            │
                             │                    │
             INMP441  [SD] ──┤ GPIO 32            │
             INMP441  [WS] ──┤ GPIO 25            │
            INMP441 [SCK] ───┤ GPIO 26            │
            INMP441  [L/R] ──┤ GND (Canal Izq.)   │
                             │                    │
            Neopixel [DIN] ──┤ GPIO 4             │
                             │                    │
                             └────────────────────┘
```

| Componente | Pin del Módulo | Pin sugerido en ESP32 | Función / Notas de Diseño |
| :--- | :--- | :--- | :--- |
| **MAX30102** | VIN / GND | **3V3 / GND** | Alimentación lógica y sensores ópticos a 3.3V |
| | SDA / SCL | **GPIO 21 / GPIO 22** | Bus I2C de datos y reloj |
| **INMP441** | VDD / GND | **3V3 / GND** | Alimentación del micrófono MEMS a 3.3V |
| | L/R | **GND** | Selector de canal (a GND configura canal izquierdo mono) |
| | SD | **GPIO 32** | I2S Serial Data (salida de datos de audio) |
| | WS | **GPIO 25** | I2S Word Select / LRCLK (reloj de trama/canal) |
| | SCK | **GPIO 26** | I2S Serial Clock / BCLK (reloj de bits) |
| **Neopixel WS2812** | VDD / GND | **VIN / GND** | Alimentación desde la batería/fuente (5V/3.7V) |
| | DIN | **GPIO 4** | Señal de datos digitales (1-Wire) |
| **Alimentación** | Batería | **B+ / B- (TP4056)** | Conexión directa a la celda Li-Ion/LiPo |
| | Switch On-Off | **Entre OUT+ y VIN** | Conmuta la alimentación que entra al ESP32 |

---

## 5. POSIBLES PASOS A SEGUIR Y TAREAS PENDIENTES (Hoja de Ruta)

### Fase Inmediata: Consolidación de la Base de Captura de Datos (Prioridad Alta)
Antes de construir implementaciones específicas, se debe asegurar que el flujo de adquisición de datos funcione de forma fiable:
1. **Alimentación e interruptor:** Cablear TP4056, interruptor y celda Li-Ion; comprobar voltajes y corte seguro.
2. **Prueba unitaria MAX30102:** Verificar bus I2C y recepción estable de datos PPG (curvas de luz roja e infrarroja en respuesta al pulso).
3. **Prueba unitaria INMP441:** Inicializar búfer I2S a 16 kHz / 16 bits y comprobar en el *Serial Plotter* que el audio responda a estímulos sonoros sin saturación.
4. **Prueba unitaria Neopixel:** Verificar control direccionable de los 8 LEDs con barrido de colores.

### Fases Siguientes: Selección de Implementación y Desarrollo
Una vez consolidada la base de captura, el equipo elegirá la implementación a desarrollar:
* **Si se opta por Triaje en Dispositivo:** Programar el algoritmo de Ratio de Ratios para $SpO_2$/BPM, el cálculo de energía RMS para accesos de tos y la máquina de estados del semáforo LED.
* **Si se opta por Estetoscopio Inteligente / IA:** Diseñar la campana acústica 3D acoplada al INMP441, descargar los audios ICBHI de Kaggle, entrenar un clasificador en Python y portarlo al ESP32 con TinyML.
* **Si se opta por Telemedicina / IoT:** Implementar servidor web o cliente MQTT en el ESP32 para emitir curvas en tiempo real a una aplicación.
* **Si se opta por Datalogger:** Implementar registro en tarjeta SD o memoria Flash.

---

## 6. Reglas de Desarrollo para Asistentes de IA

1. **No asumir componentes inexistentes:** Todo el código o diagrama debe estar pensado para los componentes listados en la Sección 3 (ESP32, MAX30102, INMP441, Neopixel 8 LEDs, TP4056, Switch, Batería 3.7V). Si se propone una pantalla OLED o un buzzer, debe marcarse como *opcional / mejora futura*.
2. **Modularidad estricta:** Mantener la capa de lectura de sensores desacoplada de la lógica de aplicación para facilitar el cambio de implementaciones futuras.
3. **Micrófono estrictamente digital:** El INMP441 es I2S. Nunca sugerir `analogRead()`. Usar siempre las librerías o drivers I2S de ESP-IDF o Arduino-ESP32 (`driver/i2s.h` o `I2S.h`).
4. **Seguridad eléctrica:** El interruptor On/Off debe ubicarse en la línea `OUT+` hacia el pin `VIN` del ESP32. Nunca cortar entre la batería y `B+/B-` del TP4056 para preservar el circuito de protección de la celda.
