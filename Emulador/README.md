# Emuladores: exclusivamente demostración, sin datos de pacientes

`device_hardware_streamer.py`, `pc_band_simulator.py` y `Emulador.ino` generan valores sintéticos. No leen sensores reales. Todos sus paquetes llevan `source: "simulated"`, `test: true` y los indicadores de validez de pulso/SpO2 en falso. No deben usarse para entrenar, evaluar exactitud ni orientar un diagnóstico. El nombre histórico `device_hardware_streamer.py` no indica hardware físico. `test_bridge.py` es solamente un stub de conectividad.

## Wokwi ESP32 (Feria Tecnológica)

Proyecto configurado y simulado en **Wokwi** basado en la especificación exacta de componentes y asignación de pines del sistema.

---

## 📋 Lista de Componentes y Mapeo de Pines

### U4 — ESP32-DEVKITC-V4 (Microcontrolador Central)
- **`3V3 (Pin 1)`**: Suministra 3.3V al sensor **U1**, micrófono **U2** y LED **LED1**.
- **`5V / VIN (Pin 19)`**: Recibe alimentación protegida desde el módulo **U3 (TP4056)**.
- **`GND (Pin 14 / 27)`**: Tierra común del circuito.
- **`IO21 (Pin 23)`**: Bus de datos I2C (**SDA** para el sensor **U1 MAX30102**).
- **`IO22 (Pin 22)`**: Bus de reloj I2C (**SCL** para el sensor **U1 MAX30102**).
- **`IO14 (Pin 12)`**: Reloj de bits I2S (**SCK** para el micrófono **U2 INMP441**).
- **`IO15 (Pin 11)`**: Reloj de selección de cuadro I2S (**WS** para el micrófono **U2 INMP441**).
- **`IO32 (Pin 7)`**: Datos de audio digital I2S (**SD** para el micrófono **U2 INMP441**).
- **`IO17`**: Lectura del botón de control (**J1** con resistencia interna Pull-Up).
- **`IO25 (Pin 9)`**: Control de datos digitales (**DIN**) para el LED RGB (**LED1 WS2812C**).

---

### U1 — MAX30102 (Sensor de Signos Vitales: Ritmo Cardíaco y SpO2)
- **`VIN`**: Alimentación 3.3V $\rightarrow$ Conectado a **ESP32 3V3**.
- **`GND`**: Tierra $\rightarrow$ Conectado a **ESP32 GND**.
- **`SDA`**: Datos I2C $\rightarrow$ Conectado a **ESP32 IO21**.
- **`SCL`**: Reloj I2C $\rightarrow$ Conectado a **ESP32 IO22**.

---

### U2 — INMP441 (Micrófono Digital I2S)
- **`VDD`**: Alimentación 3.3V $\rightarrow$ Conectado a **ESP32 3V3**.
- **`GND / L/R`**: Tierra y selección de canal izquierdo $\rightarrow$ Conectado a **ESP32 GND**.
- **`SCK`**: Reloj de bits $\rightarrow$ Conectado a **ESP32 IO14**.
- **`WS`**: Selección de palabra / cuadro $\rightarrow$ Conectado a **ESP32 IO15**.
- **`SD`**: Salida de datos de audio $\rightarrow$ Conectado a **ESP32 IO32**.

---

### U3 — TP4056 (Cargador y Protección de Batería)
- **`BAT+ (Pin 5)`**: Polo positivo de la batería $\rightarrow$ Conectado a **U5** pasando por el interruptor **B1**.
- **`BAT- (Pin 8)`**: Polo negativo de la batería $\rightarrow$ Conectado a **U5 Pin 2 (Negativo)**.
- **`OUT+ (Pin 6)`**: Salida positiva hacia el circuito $\rightarrow$ Conectado a **ESP32 5V (U4)**.
- **`OUT- (Pin 9)`**: Salida negativa de retorno $\rightarrow$ Conectado a **ESP32 GND (U4)**.

---

### U5 — Batería LiPo LP103450 (3.7V 2000mAh)
- **`Pin 1 (V+ / Rojo)`**: Positivo 3.7V $\rightarrow$ Pasa por el interruptor **B1** y llega a **BAT+** de **U3**.
- **`Pin 2 (V- / Negro)`**: Negativo $\rightarrow$ Conectado a **BAT-** de **U3**.

---

### B1 — Rocker Switch (Interruptor de Encendido/Apagado General)
- Intercala el flujo de energía entre el polo positivo de la batería (**U5**) y la entrada de carga/protección (**U3 TP4056**).

---

### J1 — Botón de Control (Pulsador Interactivo)
- **`Terminal 1`**: Conectado a **ESP32 IO17** (`INPUT_PULLUP`).
- **`Terminal 2`**: Conectado a **ESP32 GND**.
- **Función**: Permite alternar en tiempo real entre los 3 modos de operación del sistema:
  1. **Modo Biometría (0)**: LED pulsa al ritmo del corazón.
  2. **Modo Acústico (1)**: LED reactivo al volumen captado por el micrófono I2S.
  3. **Modo Salud Integral (2)**: Semáforo de estado de salud (Verde/Amarillo/Rojo).

---

### LED1 — WS2812C (LED RGB Direccionable)
- **`Pin 1 (VDD)`**: Alimentación $\rightarrow$ Conectado a **ESP32 3V3**.
- **`Pin 3 (VSS)`**: Tierra $\rightarrow$ Conectado a **ESP32 GND**.
- **`Pin 4 (DIN)`**: Entrada de datos $\rightarrow$ Conectado a **ESP32 IO25**.

---

## ⚡ Cómo Ejecutar la Simulación

1. Abre el archivo **[diagram.json](file:///c:/Users/calin/Documents/Feria%20tecnologica/Emulador/diagram.json)**.
2. Presiona `Ctrl + Shift + P` y ejecuta:
   ```
   Wokwi: Start Simulator
   ```
3. ¡Interactúa con el botón **J1** en la pantalla para cambiar los modos y observa las respuestas en el LED y en el Monitor Serial!
