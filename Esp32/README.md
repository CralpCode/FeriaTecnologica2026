# 🩺 SpiroScan AI - Firmware Oficial ESP32 (Hardware Real)

Firmware de grado biomédico para el microcontrolador **ESP32-WROOM-32D / ESP32-DEVKITC-V4** diseñado de acuerdo con el esquema electrónico oficial de **EasyEDA (Schematic1)**.

---

## 📌 1. Mapa de Pines y Conexiones Físicas

| Componente | Pin del Módulo | Pin GPIO ESP32 | Descripción |
| :--- | :--- | :--- | :--- |
| **MAX30102 (U1)** | `VCC / VIN` | **3V3** | Alimentación 3.3V |
| | `GND` | **GND** | Tierra común (¡Obligatorio conectar!) |
| | `SDA` | **GPIO 23 (P23)** o **GPIO 21** | Datos I2C (Autodetectable en firmware) |
| | `SCL` | **GPIO 22 (P22)** | Reloj I2C (400 kHz) |
| **INMP441 (U2)** | `VDD` | **3V3** | Alimentación 3.3V |
| | `GND` | **GND** | Tierra común |
| | `L/R` | **GND** | Canal Izquierdo (Mono) |
| | `SCK` | **GPIO 14** | Bit Clock I2S |
| | `WS` | **GPIO 15** | Word Select I2S |
| | `SD` | **GPIO 32** | Serial Data I2S |
| **WS2812B (LED1)** | `VDD / 5V` | **VIN / 3V3** | Alimentación LED |
| | `DIN` | **GPIO 25** | Entrada de datos RGB |
| | `GND` | **GND** | Tierra común |
| **Botón K1** | `Pin 1` | **GPIO 17** | Entrada digital (Pull-up) |
| | `Pin 2` | **GND** | Cierre a tierra |
| **Batería / TP4056** | `OUT+ / OUT-` | **VIN / GND** | Batería LiPo 3.7V con Switch K1 |

---

## 📱 2. Modos de Comunicación

### 1. Bluetooth Serial SPP (Principal)
* **Nombre del Dispositivo**: `SpiroScan-Band`
* **Transmisión**: Envía paquetes JSON estandarizados a 1 Hz cuando hay un cliente emparejado (teléfono Android, iOS o PC).
* **Consumo Eficiente**: Compatible con la aplicación móvil SpiroScan AI.

### 2. Consola Serial USB (Depuración y Calibración)
* **Velocidad**: `115200 baudios`.
* **Formato Dual**: Muestra una barra de telemetría médica legible para humanos y la línea JSON cruda para parsers y Serial Plotter.

### 3. WiFi HTTP (Opcional / Fallback)
* Envía telemetría directamente al servidor backend FastAPI (`/api/telemetry`).

---

## ⚡ 3. Comandos Interactivos (Por Serial o Bluetooth)

Puedes enviar los siguientes comandos en mayúsculas o minúsculas a través del Monitor Serie o la app Bluetooth:

| Comando | Acción |
| :--- | :--- |
| `TEST` o `T` | **Alterna el Modo Demostración Rápida**. Genera ondas fisiológicas continuas para exponer o evaluar sin necesidad de colocar el dedo en el sensor. |
| `STATUS` | Devuelve el estado de los sensores, uptime, batería y estado del enlace Bluetooth en formato JSON. |
| `WAKE` o `W` | Activa la ventana de transmisión médica en vivo durante 2 minutos. |
| `SLEEP` o `S` | Pone el microcontrolador y sensores en reposo para ahorrar batería. |

---

## 🚀 4. Guía de Carga con Arduino IDE

1. **Instalar el soporte para ESP32**:
   * En Arduino IDE: *Archivo -> Preferencias -> Gestor de URLs Adicionales de Tarjetas*:
     `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
2. **Instalar Librerías Requeridas**:
   * `SparkFun MAX3010x Pulse and Proximity Sensor Library` (por SparkFun)
   * `Adafruit NeoPixel` (por Adafruit)
3. **Configuración de la Placa**:
   * Placa: `ESP32 Dev Module`
   * Upload Speed: `921600`
   * CPU Frequency: `240MHz (WiFi/BT)`
   * Flash Frequency: `80MHz`
   * Core Debug Level: `None`
4. Conecta tu ESP32 por USB, selecciona el puerto COM y presiona **Subir**.
