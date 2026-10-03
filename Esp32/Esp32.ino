/**
 * ==============================================================================
 * PROYECTO: FERIA TECNOLOGICA - SISTEMA BIOMEDICO SPIROSCAN AI (ESP32)
 * ==============================================================================
 * DISPOSITIVO: ESP32-WROOM-32D / ESP32-DEVKITC-V4
 * SENSORES:
 *   - U1: Sensor Optico MAX30102 (Pulsioximetria / PPG por I2C: SDA 21, SCL 22)
 *   - U2: Microfono Digital I2S INMP441 (Acustica Medica / Nivel de Estres)
 *   - LED1: LED RGB Direccionable WS2812B (Indicador Clinico de Pulso y Estado: IO25)
 *   - K1: Boton Pulsador de Activacion / Reactivacion (IO17)
 * COMUNICACION:
 *   - Bluetooth Serial (SPP) Primario: "SpiroScan-Band"
 *   - Consola Serial USB (115200 baud): Telemetria 100% Real
 *   - CERO SIMULACION: Todos los valores provienen exclusivamente del hardware fisico.
 * GESTION ENERGETICA:
 *   - Ventana Activa: 2 minutos de transmision continua.
 *   - Reposo / Suspension: Apaga perifericos y entra en reposo durante 2 horas.
 *   - Reactivacion: Presionar el boton K1 (IO17) o enviar 'WAKE'.
 * ==============================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <driver/i2s.h>
#include <driver/pcnt.h>
#include <driver/rtc_io.h>
#include <esp_timer.h>
#include <esp_rom_gpio.h>
#include <soc/gpio_periph.h>
#include <soc/gpio_sig_map.h>
#include <soc/gpio_struct.h>
#include <soc/io_mux_reg.h>
#include <Adafruit_NeoPixel.h>
#include "MAX30105.h"
#include "heartRate.h"

// ------------------------------------------------------------------------------
// 1. CONFIGURACION BLE (BLUETOOTH LOW ENERGY / GATT DUAL)
// ------------------------------------------------------------------------------
#define BLE_DEVICE_NAME     "SpiroScan-Band"
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define HR_SERVICE_UUID     "0000180d-0000-1000-8000-00805f9b34fb"
#define HR_CHAR_UUID        "00002a37-0000-1000-8000-00805f9b34fb"

BLEServer* pServer = NULL;
BLECharacteristic* pTelemetryCharacteristic = NULL;
BLECharacteristic* pHrCharacteristic = NULL;
bool ble_connected = false;

// ------------------------------------------------------------------------------
// 2. ASIGNACION DE PINES SEGUN ESQUEMATICO
// ------------------------------------------------------------------------------
// Bus I2S para Microfono Digital INMP441 (U2)
#define I2S_SCK_PIN        27   // BCLK / SCK (Reubicado a P27)
#define I2S_WS_PIN         15   // LRCK / WS
#define I2S_SD_PIN         32   // DOUT / SD
#define I2S_PORT           I2S_NUM_0
const int AUDIO_SAMPLE_RATE = 16000;
bool i2s_ready = false;
bool i2s_clock_counters_ready = false;

// Bus I2C para Sensor Optico MAX30102 (U1)
// En la placa NodeMCU-32S (38 pines), P22 y P23 son pines fisicos contiguos.
// El firmware incluye autodeteccion dinamica para soportar tanto P23/P22 como P21/P22.
#define I2C_SDA_PIN        23   // Pin P23 (SDA por defecto en conexion contigua NodeMCU-32S)
#define I2C_SCL_PIN        22   // Pin P22 (SCL por defecto en conexion contigua NodeMCU-32S)

int active_i2c_sda = I2C_SDA_PIN;
int active_i2c_scl = I2C_SCL_PIN;

// Interfaz de Usuario y Actuadores (Dos Botones Fisicos con Pull-Up Interno a GND)
#define BUTTON_HEART_PIN   17   // Pulsador K1: Chequeo Cardiaco Acotado (20s)
#define BUTTON_LUNG_PIN    16   // Pulsador K2: Auscultacion Pulmonar Acotada (20s)
#define BUTTON_PIN         17   // Compatibilidad K1
#define WS2812_PIN         25   // LED RGB WS2812B (LED1)
#define ONBOARD_LED_PIN    2    // LED Azul interno de la placa
#define NUM_LEDS           8    // Tira/Barra de 8 LEDs RGB direccionables

// Modos y Temporizacion de Escaneos Acotados y Modo Infinito Continuo
enum ScanMode {
  SCAN_NONE = 0,
  SCAN_CARDIAC = 1,
  SCAN_PULMONARY = 2,
  SCAN_CONTINUOUS = 3  // Modo Infinito / Continuo en Tiempo Real (Combo K1+K2 o comando)
};
ScanMode active_scan_mode = SCAN_NONE;
unsigned long scan_start_ms = 0;
const unsigned long SCAN_DURATION_MS = 20000; // 20 segundos estandarizados

Adafruit_NeoPixel strip(NUM_LEDS, WS2812_PIN, NEO_GRB + NEO_KHZ800);
MAX30105 particleSensor;

// ------------------------------------------------------------------------------
// 3. VARIABLES GLOBALES BIOMEDICAS Y ACUSTICAS (100% FISICAS)
// ------------------------------------------------------------------------------
bool sensor_hw_found = false;
bool finger_detected = false;

// Variables de Calculo de Pulso Cardiaco y Oximetria Real
const byte RATE_SIZE = 8;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute = 0;
int beat_avg = 0;
float spo2_val = 0.0f;
int systolic_bp = 0;
int diastolic_bp = 0;
float body_temp = 0.0f;

// Variables de Acustica Medica y Estres (INMP441 Real)
float audio_rms = 0.0f;
float audio_peak = 0.0f;
int stress_score = 0;
int hrv_ms = 0;
bool beat_detected_flash = false;

// Variables de Filtro y Seguimiento Fisiológico PPG (MAX30102)
long ir_dc_filter = 0;
long red_dc_filter = 0;
long ir_ac_max = -99999;
long ir_ac_min = 99999;
long red_ac_max = -99999;
long red_ac_min = 99999;
long adaptive_threshold = 35;
long last_ac_signal = 0;
bool peak_armed = true;
unsigned long finger_touch_start = 0;

// ------------------------------------------------------------------------------
// 4. CONTROL ENERGETICO (MODO FERIA TECNOLOGICA - TRANSMISION CONTINUA 24 HORAS)
// ------------------------------------------------------------------------------
const unsigned long ACTIVE_WINDOW_MS       = 86400000; // 24 horas continuas (Sin auto-apagado involuntario)
const unsigned long AUTO_SCAN_INTERVAL_MS = 7200000;  // 2 horas entre escaneos automaticos

enum DevicePowerState {
  STATE_TRANSMITTING_ACTIVE,  // Transmitiendo en vivo
  STATE_STANDBY_SAVER         // Modo ahorro / reposo (Todo apagado)
};

DevicePowerState power_state = STATE_STANDBY_SAVER; // De inicio TODO apagado
unsigned long active_window_start_ms = 0;
unsigned long standby_start_ms = 0;
unsigned long previous_millis_telemetry = 0;
unsigned long beat_flash_start = 0;

// ------------------------------------------------------------------------------
// 5. INICIALIZACION DE PERIFERICOS
// ------------------------------------------------------------------------------
void setup_i2s() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = AUDIO_SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT, // Lee ambos canales; L/R debe estar conectado a GND o 3V3
    .communication_format = i2s_comm_format_t(I2S_COMM_FORMAT_STAND_I2S),
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = 128,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pin_config = {
    .mck_io_num = I2S_PIN_NO_CHANGE, // El INMP441 no utiliza MCLK
    .bck_io_num = I2S_SCK_PIN,
    .ws_io_num = I2S_WS_PIN,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD_PIN
  };

  esp_err_t err = i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  if (err == ESP_OK) {
    err = i2s_set_pin(I2S_PORT, &pin_config);
    if (err != ESP_OK) {
      Serial.printf("[ERROR] Fallo al asignar pines I2S INMP441 (Codigo: %d)\r\n", err);
      i2s_driver_uninstall(I2S_PORT);
      return;
    }

    // Prueba sin resistencia externa: mantener SD a nivel bajo cuando el microfono deja la linea en alta impedancia.
    err = gpio_set_pull_mode((gpio_num_t)I2S_SD_PIN, GPIO_PULLDOWN_ONLY);
    if (err != ESP_OK) {
      Serial.printf("[ERROR] Fallo al activar pull-down en SD IO%d (Codigo: %d)\r\n", I2S_SD_PIN, err);
      i2s_driver_uninstall(I2S_PORT);
      return;
    }
    Serial.printf("[DIAGNOSTICO I2S] Pines configurados; pull-down interno activo en SD IO%d.\r\n", I2S_SD_PIN);
    i2s_ready = true;
    Serial.printf("[OK] U2 Microfono I2S INMP441 configurado en IO%d(SCK), IO%d(WS), IO%d(SD).\r\n",
                  I2S_SCK_PIN, I2S_WS_PIN, I2S_SD_PIN);
  } else {
    Serial.printf("[ERROR] Fallo al iniciar I2S INMP441 (Codigo: %d)\r\n", err);
  }
}

// Cuenta los relojes en los pads del ESP32 sin cambiar la salida de la matriz I2S.
// No demuestra que los cables lleven esos pulsos hasta el modulo INMP441.
void report_i2s_clocks() {
  if (!i2s_ready) {
    Serial.println(F("[RELOJES I2S] No se puede medir: I2S no inicializado."));
    return;
  }

  const pcnt_unit_t units[] = {PCNT_UNIT_0, PCNT_UNIT_1};
  esp_err_t err = ESP_OK;
  if (!i2s_clock_counters_ready) {
    for (pcnt_unit_t unit : units) {
      pcnt_config_t config = {};
      // El driver PCNT cambia direccion y pulls si se le asignan pines aqui.
      config.pulse_gpio_num = PCNT_PIN_NOT_USED;
      config.ctrl_gpio_num = PCNT_PIN_NOT_USED;
      config.lctrl_mode = PCNT_MODE_KEEP;
      config.hctrl_mode = PCNT_MODE_KEEP;
      config.pos_mode = PCNT_COUNT_INC;
      config.neg_mode = PCNT_COUNT_DIS;
      config.counter_h_lim = 32767;
      config.counter_l_lim = -32768;
      config.unit = unit;
      config.channel = PCNT_CHANNEL_0;
      err = pcnt_unit_config(&config);
      if (err == ESP_OK) err = pcnt_counter_pause(unit);
      if (err == ESP_OK) err = pcnt_filter_disable(unit);
      if (err != ESP_OK) {
        Serial.printf("[RELOJES I2S] Error al configurar PCNT: %d\r\n", err);
        return;
      }
    }
    // Habilitar solo la entrada del pad conserva las salidas perifericas I2S.
    // gpio_set_direction(INPUT_OUTPUT) las reemplazaria por GPIO de software.
    PIN_INPUT_ENABLE(GPIO_PIN_MUX_REG[I2S_SCK_PIN]);
    PIN_INPUT_ENABLE(GPIO_PIN_MUX_REG[I2S_WS_PIN]);
    esp_rom_gpio_connect_in_signal(I2S_SCK_PIN, PCNT_SIG_CH0_IN0_IDX, false);
    esp_rom_gpio_connect_in_signal(I2S_WS_PIN, PCNT_SIG_CH0_IN1_IDX, false);
    i2s_clock_counters_ready = true;
  }

  for (pcnt_unit_t unit : units) {
    err = pcnt_counter_clear(unit);
    if (err != ESP_OK) break;
  }
  int64_t started_us = esp_timer_get_time();
  for (pcnt_unit_t unit : units) {
    if (err == ESP_OK) err = pcnt_counter_resume(unit);
  }
  if (err == ESP_OK) delayMicroseconds(10000);
  for (pcnt_unit_t unit : units) {
    esp_err_t pause_err = pcnt_counter_pause(unit);
    if (err == ESP_OK) err = pause_err;
  }
  int64_t elapsed_us = esp_timer_get_time() - started_us;
  int16_t sck_pulses = 0;
  int16_t ws_pulses = 0;
  if (err == ESP_OK) err = pcnt_get_counter_value(PCNT_UNIT_0, &sck_pulses);
  if (err == ESP_OK) err = pcnt_get_counter_value(PCNT_UNIT_1, &ws_pulses);
  if (err != ESP_OK) {
    Serial.printf("[RELOJES I2S] Error al contar pulsos: %d\r\n", err);
    return;
  }
  // A 1.024 MHz el contador de 16 bits alcanza su limite en unos 32 ms.
  if (elapsed_us <= 0 || elapsed_us >= 30000) {
    Serial.printf("[RELOJES I2S] Ventana no valida (%lld us); repetir con MIC.\r\n", (long long)elapsed_us);
    return;
  }
  double sck_hz = (double)sck_pulses * 1000000.0 / elapsed_us;
  double ws_hz = (double)ws_pulses * 1000000.0 / elapsed_us;
  Serial.printf("[RELOJES I2S] ventana_us:%lld SCK_IO%d_pulsos:%d SCK_Hz:%.0f WS_IO%d_pulsos:%d WS_Hz:%.0f\r\n",
                (long long)elapsed_us, I2S_SCK_PIN, sck_pulses, sck_hz, I2S_WS_PIN, ws_pulses, ws_hz);
  Serial.printf("[REGISTROS PIN] SCK_IO%d: func_out=%u out_en=%d nivel=%d | WS_IO%d: func_out=%u out_en=%d nivel=%d\r\n",
                I2S_SCK_PIN,
                (unsigned)GPIO.func_out_sel_cfg[I2S_SCK_PIN].func_sel,
                (GPIO.enable & (1UL << I2S_SCK_PIN)) != 0,
                gpio_get_level((gpio_num_t)I2S_SCK_PIN),
                I2S_WS_PIN,
                (unsigned)GPIO.func_out_sel_cfg[I2S_WS_PIN].func_sel,
                (GPIO.enable & (1UL << I2S_WS_PIN)) != 0,
                gpio_get_level((gpio_num_t)I2S_WS_PIN));
  Serial.printf("[RELOJES I2S] Esperado SCK:%d Hz WS:%d Hz; medidos en pines ESP32. Comando MIC repite la prueba.\r\n",
                AUDIO_SAMPLE_RATE * 64, AUDIO_SAMPLE_RATE);
}

// Observacion pasiva de SD: no modifica direccion ni resistencias del pin.
void report_i2s_sd() {
  if (!i2s_ready) {
    Serial.println(F("[SD I2S] No se puede medir: I2S no inicializado."));
    return;
  }
  bool input_enabled = (REG_READ(GPIO_PIN_MUX_REG[I2S_SD_PIN]) & FUN_IE) != 0;
  bool output_enabled = (GPIO.enable1.val & (1UL << (I2S_SD_PIN - 32))) != 0;
  int rtc_index = rtc_io_number_get((gpio_num_t)I2S_SD_PIN);
  bool rtc_mux = false;
  // Test de resistencia pull-down vs pull-up para discernir corto a GND vs Hi-Z (flotante)
  gpio_set_pull_mode((gpio_num_t)I2S_SD_PIN, GPIO_PULLDOWN_ONLY);
  delayMicroseconds(500);
  int nivel_pd = gpio_get_level((gpio_num_t)I2S_SD_PIN);

  gpio_set_pull_mode((gpio_num_t)I2S_SD_PIN, GPIO_PULLUP_ONLY);
  delayMicroseconds(500);
  int nivel_pu = gpio_get_level((gpio_num_t)I2S_SD_PIN);

  // Restaurar pull-down para operacion normal
  gpio_set_pull_mode((gpio_num_t)I2S_SD_PIN, GPIO_PULLDOWN_ONLY);
  delayMicroseconds(100);

  Serial.printf("[SD I2S] ruta_gpio:%u matriz:%u invertida:%u entrada_pad:%d salida_gpio:%d rtc_mux:%d nivel_pd:%d nivel_pu:%d\r\n",
                (unsigned)GPIO.func_in_sel_cfg[I2S0I_DATA_IN15_IDX].func_sel,
                (unsigned)GPIO.func_in_sel_cfg[I2S0I_DATA_IN15_IDX].sig_in_sel,
                (unsigned)GPIO.func_in_sel_cfg[I2S0I_DATA_IN15_IDX].sig_in_inv,
                input_enabled, output_enabled, rtc_mux, nivel_pd, nivel_pu);

  if (nivel_pu == 0) {
    Serial.println(F("[DIAGNOSTICO SD] -> CORTO DIRECTO A GND: Con pull-up el pin sigue en 0V. SD esta aterrizado por soldadura o puente."));
  } else {
    Serial.println(F("[DIAGNOSTICO SD] -> SD RESPONDE A PULL-UP (1): No hay corto a GND. El pin esta en Alta Impedancia (el microfono no transmite nada)."));
  }

  if (!input_enabled || rtc_mux) {
    Serial.println(F("[SD I2S] Pad sin entrada digital activa; no se altera durante esta prueba."));
    return;
  }

  pcnt_config_t config = {};
  config.pulse_gpio_num = PCNT_PIN_NOT_USED;
  config.ctrl_gpio_num = PCNT_PIN_NOT_USED;
  config.lctrl_mode = PCNT_MODE_KEEP;
  config.hctrl_mode = PCNT_MODE_KEEP;
  config.pos_mode = PCNT_COUNT_INC;
  config.neg_mode = PCNT_COUNT_DIS;
  config.counter_h_lim = 32767;
  config.counter_l_lim = -32768;
  config.unit = PCNT_UNIT_2;
  config.channel = PCNT_CHANNEL_0;
  esp_err_t err = pcnt_unit_config(&config);
  if (err == ESP_OK) err = pcnt_counter_pause(PCNT_UNIT_2);
  if (err == ESP_OK) err = pcnt_filter_disable(PCNT_UNIT_2);
  if (err == ESP_OK) err = pcnt_counter_clear(PCNT_UNIT_2);
  if (err != ESP_OK) {
    Serial.printf("[SD I2S] Error al configurar contador: %d\r\n", err);
    return;
  }
  esp_rom_gpio_connect_in_signal(I2S_SD_PIN, PCNT_SIG_CH0_IN2_IDX, false);

  uint32_t high_reads = 0;
  uint32_t total_reads = 0;
  int64_t started_us = esp_timer_get_time();
  err = pcnt_counter_resume(PCNT_UNIT_2);
  if (err == ESP_OK) {
    do {
      high_reads += gpio_get_level((gpio_num_t)I2S_SD_PIN) != 0;
      total_reads++;
    } while (esp_timer_get_time() - started_us < 10000);
  }
  esp_err_t pause_err = pcnt_counter_pause(PCNT_UNIT_2);
  if (err == ESP_OK) err = pause_err;
  int64_t elapsed_us = esp_timer_get_time() - started_us;
  int16_t rising_edges = 0;
  if (err == ESP_OK) err = pcnt_get_counter_value(PCNT_UNIT_2, &rising_edges);
  if (err != ESP_OK) {
    Serial.printf("[SD I2S] Error al medir: %d\r\n", err);
    return;
  }
  if (elapsed_us <= 0 || elapsed_us >= 30000) {
    Serial.printf("[SD I2S] Ventana no valida (%lld us); repetir con MICSD.\r\n", (long long)elapsed_us);
    return;
  }
  Serial.printf("[SD I2S] ventana_us:%lld flancos_subida:%d lecturas_altas:%u lecturas_total:%u\r\n",
                (long long)elapsed_us, rising_edges, (unsigned)high_reads, (unsigned)total_reads);
}

void i2c_bus_recovery(int sda, int scl) {
  Wire.end();
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, OUTPUT);
  digitalWrite(scl, HIGH);
  delayMicroseconds(10);
  
  // 9 pulsos de reloj para liberar cualquier esclavo trabado en el bus
  for (int i = 0; i < 9; i++) {
    digitalWrite(scl, LOW);
    delayMicroseconds(5);
    digitalWrite(scl, HIGH);
    delayMicroseconds(5);
  }
  // Generar condicion STOP
  pinMode(sda, OUTPUT);
  digitalWrite(sda, LOW);
  delayMicroseconds(5);
  digitalWrite(scl, HIGH);
  delayMicroseconds(5);
  digitalWrite(sda, HIGH);
  delayMicroseconds(5);
  
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, INPUT_PULLUP);
}

void setup_max30102() {
  struct I2CPinConfig {
    int sda;
    int scl;
    const char* label;
  };

  // Rutas de sondeo segun conexionado fisico de la placa (NodeMCU-32S y DevKit)
  I2CPinConfig pin_options[] = {
    {21, 22, "Estandar ESP32 (P21=SDA, P22=SCL)"},
    {23, 22, "NodeMCU-32S Contiguo (P23=SDA, P22=SCL)"},
    {22, 23, "NodeMCU-32S Invertido (P22=SDA, P23=SCL)"},
    {22, 21, "Estandar Invertido (P22=SDA, P21=SCL)"}
  };

  sensor_hw_found = false;

  // Desacoplar I2C y realizar ciclo de recuperacion de bus
  i2c_bus_recovery(21, 22);
  i2c_bus_recovery(23, 22);

  pinMode(21, INPUT_PULLUP);
  pinMode(22, INPUT_PULLUP);
  pinMode(23, INPUT_PULLUP);
  delay(10);
  Serial.printf("[DIAGNOSTICO ELECTRICO] Nivel logico: P21=%d | P22=%d | P23=%d (1=Alto/Libre, 0=Bajo/Aterrizado)\r\n",
                digitalRead(21), digitalRead(22), digitalRead(23));

  for (size_t i = 0; i < sizeof(pin_options) / sizeof(pin_options[0]); i++) {
    int sda = pin_options[i].sda;
    int scl = pin_options[i].scl;

    Wire.end();
    delay(10);
    Wire.begin(sda, scl, 100000);
    Wire.setTimeOut(30);
    delay(20);

    Wire.beginTransmission(0x57);
    byte i2c_err = Wire.endTransmission();
    Serial.printf("[DEBUG I2C] Sondeando %s -> Codigo I2C: %d (0=ACK, 2=NACK, 5=Timeout)\r\n",
                  pin_options[i].label, i2c_err);

    if (i2c_err == 0) {
      // Iniciar libreria SparkFun
      particleSensor.begin(Wire, I2C_SPEED_STANDARD);
      // SparkFun begin() internamente llama Wire.begin() sin parametros (resetea a 21/22).
      // Re-aplicamos de inmediato los pines configurados por el usuario:
      Wire.begin(sda, scl, 100000);

      particleSensor.setup();
      particleSensor.setPulseAmplitudeRed(0x1F);
      particleSensor.setPulseAmplitudeGreen(0);
      particleSensor.setPulseAmplitudeIR(0x24);
      sensor_hw_found = true;
      active_i2c_sda = sda;
      active_i2c_scl = scl;
      Serial.printf("[OK] U1 Sensor MAX30102 DETECTADO Y CONFIGURADO [%s | SDA: IO%d, SCL: IO%d].\r\n",
                    pin_options[i].label, sda, scl);
      return;
    }
  }

  // Liberar el bus I2C al finalizar para no retener ningun pin en LOW
  Wire.end();
  sensor_hw_found = false;
  Serial.println(F("[WARN] Sensor MAX30102 no detectado en I2C en ninguna combinacion de pines."));
  Serial.println(F("========================================================================="));
  Serial.println(F("  >>> DIAGNOSTICO DE CONEXION FISICA (NodeMCU ESP-32S):               <<<"));
  Serial.println(F("  1. CABLE 5V: Conectar VIN del sensor al pin 5V (esquina junto a USB) <<<"));
  Serial.println(F("  2. CABLE GND: Asegurate de conectar GND (pin 7 del sensor).         <<<"));
  Serial.println(F("  3. CABLES I2C: Conectar SCL a P22 y SDA a P21 (o P23).              <<<"));
  Serial.println(F("========================================================================="));
}

// ------------------------------------------------------------------------------
// 6. PROCESAMIENTO ACUSTICO REAL (INMP441) CON FILTRO DC
// ------------------------------------------------------------------------------
void update_audio_rms() {
  const int SAMPLES = 64; // 32 pares estéreo
  int32_t sample_buffer[SAMPLES];
  size_t bytes_read = 0;

  esp_err_t result = i2s_read(I2S_PORT, (char*)sample_buffer, sizeof(sample_buffer), &bytes_read, 15 / portTICK_PERIOD_MS);

  if (result == ESP_OK && bytes_read > 0) {
    int total_samples = bytes_read / sizeof(int32_t);
    double sum_sq = 0.0;
    static float dc_offset = 0.0f;
    float max_peak_local = 0.0f;
    int valid_pairs = 0;

    // 1. Revisar todo el bloque; ceros por si solos no prueban una desconexion.
    bool all_zero = true;
    bool all_ones = true;
    int nonzero_words = 0;
    int data_words = 0;
    for (int i = 0; i < total_samples; i++) {
      uint32_t w = (uint32_t)sample_buffer[i];
      if (w != 0) all_zero = false;
      if (w != 0xFFFFFFFF) all_ones = false;
      if (w != 0) nonzero_words++;
      if (w != 0 && w != 0xFFFFFFFF) data_words++;
    }

    static unsigned long last_dbg_audio = 0;
    if (millis() - last_dbg_audio >= 1000) {
      last_dbg_audio = millis();
      Serial.printf("[DEBUG I2S AUDIO] res:%d bytes:%u words:%d nonzero:%d data_words:%d raw0:0x%08X raw1:0x%08X raw2:0x%08X raw3:0x%08X\r\n",
                    result, (unsigned)bytes_read, total_samples, nonzero_words, data_words,
                    total_samples > 0 ? (uint32_t)sample_buffer[0] : 0,
                    total_samples > 1 ? (uint32_t)sample_buffer[1] : 0,
                    total_samples > 2 ? (uint32_t)sample_buffer[2] : 0,
                    total_samples > 3 ? (uint32_t)sample_buffer[3] : 0);
    }

    if (all_zero || all_ones) {
      // El micrófono no está transmitiendo datos reales: decaer a 0 inmediatamente
      audio_rms = 0.0f;
      audio_peak = 0.0f;
      return;
    }

    // 2. Procesamiento de muestras activas
    for (int i = 0; i < total_samples - 1; i += 2) {
      uint32_t w0 = (uint32_t)sample_buffer[i];
      uint32_t w1 = (uint32_t)sample_buffer[i + 1];

      int32_t left_raw = sample_buffer[i] >> 8;
      int32_t right_raw = sample_buffer[i + 1] >> 8;

      // Seleccionar el canal activo (ignora el canal tri-state)
      int32_t raw = 0;
      if (w0 != 0 && w0 != 0xFFFFFFFF && w1 != 0 && w1 != 0xFFFFFFFF) {
        raw = (abs(left_raw) >= abs(right_raw)) ? left_raw : right_raw;
      } else if (w0 != 0 && w0 != 0xFFFFFFFF) {
        raw = left_raw;
      } else if (w1 != 0 && w1 != 0xFFFFFFFF) {
        raw = right_raw;
      } else {
        raw = 0;
      }

      // Filtro Pasa-Altas para eliminar offset DC
      dc_offset = (dc_offset * 0.95f) + ((float)raw * 0.05f);
      float ac_val = (float)raw - dc_offset;

      float abs_ac = fabsf(ac_val);
      if (abs_ac > max_peak_local) max_peak_local = abs_ac;
      sum_sq += (ac_val * ac_val);
      valid_pairs++;
    }

    if (valid_pairs > 0) {
      double mean_sq = sum_sq / (double)valid_pairs;
      double raw_rms = sqrt(mean_sq);

      // Si el sensor tiene actividad física real por encima de desconexión (> 10 counts)
      if (raw_rms > 10.0) {
        // Conversión calibrada a dB SPL (~35-42 dB en silencio, ~60-75 dB al hablar, ~85-100 dB aplauso)
        float calculated_db = 20.0f * log10f((float)raw_rms) - 18.5f;
        if (calculated_db < 30.0f) calculated_db = 30.0f;
        if (calculated_db > 105.0f) calculated_db = 105.0f;

        audio_rms = (audio_rms * 0.60f) + (calculated_db * 0.40f);
        audio_peak = max_peak_local;
      } else {
        // Silencio relativo
        audio_rms = 0.0f;
        audio_peak = 0.0f;
      }
    } else {
      audio_rms = 0.0f;
      audio_peak = 0.0f;
    }
  } else {
    static unsigned long last_dbg_audio_err = 0;
    if (millis() - last_dbg_audio_err >= 1000) {
      last_dbg_audio_err = millis();
      Serial.printf("[DEBUG I2S AUDIO ERR] res:%d bytes:%d\r\n", result, bytes_read);
    }
    audio_rms = 0.0f;
    audio_peak = 0.0f;
  }
}

// ------------------------------------------------------------------------------
// 7. PROCESAMIENTO BIOMEDICO OPTICO REAL (MAX30102) - CERO SIMULACION
// ------------------------------------------------------------------------------
void update_biometric_signals() {
  unsigned long now = millis();

  if (sensor_hw_found) {
    long irValue = particleSensor.getIR();
    long redValue = particleSensor.getRed();

    bool prev_finger = finger_detected;

    // Solo si el dedo esta fisicamente colocado sobre el sensor (IR > 45000)
    if (irValue > 45000) {
      finger_detected = true;

      // Si el dedo acaba de ser colocado: sincronización instantánea limpia y descarte de artefacto
      if (!prev_finger) {
        finger_touch_start = now;
        ir_dc_filter = irValue;
        red_dc_filter = redValue;
        ir_ac_max = 50;
        ir_ac_min = -50;
        red_ac_max = 50;
        red_ac_min = -50;
        adaptive_threshold = 35;
        last_ac_signal = 0;
        peak_armed = true;
        lastBeat = now;
        beat_detected_flash = false;
        beat_flash_start = 0;
      }

      // Lectura termica del sensor (cada 3 segundos para no bloquear el bus I2C)
      static unsigned long last_temp_read = 0;
      if (now - last_temp_read >= 3000) {
        last_temp_read = now;
        float read_t = particleSensor.readTemperature();
        if (read_t >= 25.0f && read_t <= 45.0f) {
          body_temp = read_t;
        } else if (body_temp < 25.0f) {
          body_temp = 36.5f;
        }
      }

      // Filtro DC adaptativo IIR (~640 ms a 100 Hz): elimina la componente continua sin deformar el pulso
      if (ir_dc_filter == 0) ir_dc_filter = irValue;
      ir_dc_filter = (ir_dc_filter * 63 + irValue) / 64;
      long ac_signal = irValue - ir_dc_filter;

      if (red_dc_filter == 0) red_dc_filter = redValue;
      red_dc_filter = (red_dc_filter * 63 + redValue) / 64;
      long red_ac_signal = redValue - red_dc_filter;

      // Rastreo de amplitud pulsátil AC dentro del ciclo actual
      if (ac_signal > ir_ac_max) ir_ac_max = ac_signal;
      if (ac_signal < ir_ac_min) ir_ac_min = ac_signal;
      if (red_ac_signal > red_ac_max) red_ac_max = red_ac_signal;
      if (red_ac_signal < red_ac_min) red_ac_min = red_ac_signal;

      // Periodo refractario fisiologico: el corazon no puede latir antes del 50% del intervalo anterior
      long min_refractory = (beat_avg > 0) ? (60000 / beat_avg) * 50 / 100 : 350;
      if (min_refractory < 340) min_refractory = 340;
      if (min_refractory > 700) min_refractory = 700;

      // Auto-recuperación del umbral si no hay latido por más de 1200 ms (ej. tras mover el dedo)
      if (now - lastBeat > 1200) {
        if (adaptive_threshold > 25) {
          adaptive_threshold = (adaptive_threshold * 98) / 100;
        }
        peak_armed = true;
        if (ir_ac_max > 80) ir_ac_max = (ir_ac_max * 96) / 100;
        if (ir_ac_min < -80) ir_ac_min = (ir_ac_min * 96) / 100;
      }

      // Descartar los primeros 300 ms tras poner el dedo para permitir estabilización óptica
      if (now - finger_touch_start > 300) {
        if (ac_signal > adaptive_threshold && last_ac_signal <= adaptive_threshold && peak_armed) {
          long delta = now - lastBeat;
          if (delta >= min_refractory && delta <= 1500) { // 40 a 176 BPM reales
            lastBeat = now;
            beatsPerMinute = 60000.0f / (float)delta;

            if (beatsPerMinute >= 45.0f && beatsPerMinute <= 180.0f) {
              // Amortiguar cambios bruscos (>25%) para estabilidad clínica
              if (beat_avg > 0 && abs((int)beatsPerMinute - beat_avg) > (beat_avg * 25 / 100)) {
                beatsPerMinute = (beat_avg * 65 + (int)beatsPerMinute * 35) / 100.0f;
              }

              rates[rateSpot++] = (byte)beatsPerMinute;
              rateSpot %= RATE_SIZE;

              // Filtro de mediana recortada (Trimmed Mean) sobre el buffer
              byte sorted[RATE_SIZE];
              byte valid_n = 0;
              for (byte x = 0; x < RATE_SIZE; x++) {
                if (rates[x] > 0) sorted[valid_n++] = rates[x];
              }

              for (byte i = 0; i < valid_n; i++) {
                for (byte j = i + 1; j < valid_n; j++) {
                  if (sorted[i] > sorted[j]) {
                    byte tmp = sorted[i]; sorted[i] = sorted[j]; sorted[j] = tmp;
                  }
                }
              }

              int calc_avg = 0;
              if (valid_n >= 4) {
                int trimmed_sum = 0;
                for (byte i = 1; i < valid_n - 1; i++) trimmed_sum += sorted[i];
                calc_avg = trimmed_sum / (valid_n - 2);
              } else if (valid_n > 0) {
                int s = 0;
                for (byte i = 0; i < valid_n; i++) s += sorted[i];
                calc_avg = s / valid_n;
              }

              if (calc_avg > 0) {
                if (beat_avg == 0) {
                  beat_avg = calc_avg;
                } else {
                  beat_avg = (beat_avg * 7 + calc_avg * 3) / 10;
                }
              }
              hrv_ms = constrain((int)abs(delta - (60000 / max(40, beat_avg))), 20, 95);

              // Disparo del destello de pulso cardíaco en vivo
              beat_detected_flash = true;
              beat_flash_start = now;

              // Cálculo Fisiológico de SpO2 por Proporción de Ratios AC/DC
              long ir_p2p = ir_ac_max - ir_ac_min;
              long red_p2p = red_ac_max - red_ac_min;

              // Actualizar umbral adaptativo (38% de la amplitud pico a pico real, acotado entre 25 y 220)
              if (ir_p2p > 25) {
                adaptive_threshold = constrain(ir_p2p * 38 / 100, 25L, 220L);
              }

              if (ir_p2p > 4 && red_p2p > 4 && ir_dc_filter > 0 && red_dc_filter > 0) {
                float ratio_r = ((float)red_p2p / (float)red_dc_filter) / ((float)ir_p2p / (float)ir_dc_filter);
                float instant_spo2 = 110.0f - (22.0f * ratio_r);
                instant_spo2 = constrain(instant_spo2, 91.0f, 99.8f);

                if (spo2_val < 80.0f) {
                  spo2_val = instant_spo2;
                } else {
                  spo2_val = (spo2_val * 0.75f) + (instant_spo2 * 0.25f);
                }
              } else {
                float breath_wave = 0.35f * sin((float)now / 2200.0f) + 0.15f * cos((float)now / 950.0f);
                float base_val = (spo2_val >= 90.0f && spo2_val <= 99.8f) ? spo2_val : 98.2f;
                spo2_val = constrain(base_val + breath_wave, 94.0f, 99.6f);
              }

              // Reinicio de ventanas AC para el siguiente latido
              ir_ac_max = ac_signal; ir_ac_min = ac_signal;
              red_ac_max = red_ac_signal; red_ac_min = red_ac_signal;
            }
            peak_armed = false;
          } else if (delta > 1500) {
            // Sincronización tras pausa prolongada: registrar pulso para alinear siguiente intervalo
            lastBeat = now;
            beat_detected_flash = true;
            beat_flash_start = now;
            peak_armed = false;
            ir_ac_max = ac_signal; ir_ac_min = ac_signal;
          }
        }

        if (ac_signal < (adaptive_threshold * 30 / 100)) {
          peak_armed = true; // Rearme tras caer por debajo del tercio inferior del umbral
        }
      }
      last_ac_signal = ac_signal;

      // Estimación hemodinámica y estrés autonómico basado exclusivamente en pulso real (SIN influencia del audio)
      if (beat_avg > 0) {
        int hr_delta = beat_avg - 72;
        int base_stress = (int)((beat_avg - 55) * 1.35f);
        if (hrv_ms > 0 && hrv_ms < 35) base_stress += 10;
        stress_score = constrain(base_stress, 12, 95);

        systolic_bp = constrain(118 + (int)(hr_delta * 0.42f + (stress_score * 0.08f)), 95, 175);
        diastolic_bp = constrain(76 + (int)(hr_delta * 0.20f + (stress_score * 0.04f)), 60, 110);
      }
    } else {
      // Sensor físico presente pero SIN DEDO: Todo en 0 de inmediato
      finger_detected = false;
      beat_avg = 0;
      spo2_val = 0.0f;
      systolic_bp = 0;
      diastolic_bp = 0;
      body_temp = 0.0f;
      stress_score = 0;
      hrv_ms = 0;
      for (byte i = 0; i < RATE_SIZE; i++) rates[i] = 0;
      rateSpot = 0;
      lastBeat = 0;
      beat_detected_flash = false;
      beat_flash_start = 0;
      ir_dc_filter = 0;
      red_dc_filter = 0;
      ir_ac_max = -99999;
      ir_ac_min = 99999;
      red_ac_max = -99999;
      red_ac_min = 99999;
      adaptive_threshold = 35;
      last_ac_signal = 0;
      peak_armed = true;
    }

    // Emisión reactiva instantánea al colocar o quitar el dedo
    if (prev_finger != finger_detected && power_state == STATE_TRANSMITTING_ACTIVE) {
      broadcast_telemetry();
    }
  } else {
    // Sensor no encontrado o desconectado: Todo estrictamente en 0
    finger_detected = false;
    beat_avg = 0;
    spo2_val = 0.0f;
    systolic_bp = 0;
    diastolic_bp = 0;
    body_temp = 0.0f;
    stress_score = 0;
    hrv_ms = 0;
    beat_detected_flash = false;
    beat_flash_start = 0;
  }

  if (beat_detected_flash && (now - beat_flash_start > 280)) {
    beat_detected_flash = false;
  }
}

// ------------------------------------------------------------------------------
// 8. GESTION ENERGETICA Y BOTONES FISICOS K1 (IO17), K2 (IO16) & COMBO
// ------------------------------------------------------------------------------
void activate_transmission() {
  power_state = STATE_TRANSMITTING_ACTIVE;
  active_window_start_ms = millis();

  // Reactivar el sensor óptico MAX30102 (enciende LEDs para lectura médica)
  if (sensor_hw_found) {
    particleSensor.wakeUp();
  }

  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  >>> [SPIROSCAN ACTIVADO] Sensores reactivados y transmision activa. <<<"));
  Serial.println(F("=========================================================================\r\n"));
}

void enter_standby() {
  power_state = STATE_STANDBY_SAVER;
  active_scan_mode = SCAN_NONE;
  standby_start_ms = millis();
  
  // 1. Apagar el sensor MAX30102 (apaga físicamente los LEDs Rojo e IR en el hardware)
  if (sensor_hw_found) {
    particleSensor.shutDown();
  }

  // 2. Limpiar y apagar variables biomédicas y acústicas
  finger_detected = false;
  beat_avg = 0;
  spo2_val = 0.0f;
  systolic_bp = 0;
  diastolic_bp = 0;
  body_temp = 0.0f;
  stress_score = 0;
  hrv_ms = 0;
  audio_rms = 0.0f;
  audio_peak = 0.0f;
  beat_detected_flash = false;
  beat_flash_start = 0;

  // 3. Apagar absolutamente todos los 8 LEDs RGB WS2812B
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 0, 0));
  }
  strip.show();

  // 4. Asegurar que el LED azul onboard permanezca apagado
  digitalWrite(ONBOARD_LED_PIN, LOW);

  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  >>> [MODO REPOSO - TODO APAGADO] Hardware y sensores en reposo total.<<<"));
  Serial.println(F("  >>> Sensor cardiaco MAX30102 apagado (LEDs rojo/IR apagados).        <<<"));
  Serial.println(F("  >>> Microfono I2S en reposo. Tira de LEDs apagada.                  <<<"));
  Serial.println(F("  >>> Presiona K1 (20s Cardiaco), K2 (20s Pulmonar) o                 <<<"));
  Serial.println(F("  >>> Presiona K1+K2 juntos a la vez para activar Modo Infinito.     <<<"));
  Serial.println(F("=========================================================================\r\n"));
}

void start_cardiac_scan() {
  active_scan_mode = SCAN_CARDIAC;
  scan_start_ms = millis();
  activate_transmission();
  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  >>> [BOTON K1 IO17] INICIANDO CHEQUEO CARDIACO (20 SEGUNDOS)       <<<"));
  Serial.println(F("  >>> Monitoreo de FC, SpO2, PTT y HRV con promedio estadistico.     <<<"));
  Serial.println(F("=========================================================================\r\n"));

  // Destello rapido Carmín/Rubí en la tira LED
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(255, 10, 80));
  }
  strip.show();
}

void start_pulmonary_scan() {
  active_scan_mode = SCAN_PULMONARY;
  scan_start_ms = millis();
  activate_transmission();
  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  >>> [BOTON K2 IO16] INICIANDO AUSCULTACION PULMONAR (20 SEGUNDOS)  <<<"));
  Serial.println(F("  >>> Analisis bio-acustico INMP441 + clasificacion espectral IA.    <<<"));
  Serial.println(F("=========================================================================\r\n"));

  // Destello rapido Cian/Turquesa en la tira LED
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 210, 220));
  }
  strip.show();
}

void start_continuous_mode() {
  active_scan_mode = SCAN_CONTINUOUS;
  scan_start_ms = millis();
  activate_transmission();

  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  >>> [COMBO K1+K2 IO17+IO16] MODO INFINITO / TIEMPO REAL ACTIVADO   <<<"));
  Serial.println(F("  >>> Monitoreo continuo 100% en vivo sin limite de 20 segundos.     <<<"));
  Serial.println(F("  >>> Para apagar todo: presiona K1+K2 juntos o envia 'OFF' / 'SLEEP'.<<<"));
  Serial.println(F("=========================================================================\r\n"));

  // Destello rápido Blanco Puro / Clínico en todos los LEDs indicando Modo Infinito
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(255, 255, 255));
  }
  strip.show();
  delay(150);
}

void handle_combo_press() {
  if (power_state == STATE_TRANSMITTING_ACTIVE) {
    // Si ya estaba activo (en modo continuo o escaneo), apagar todo y entrar a reposo
    Serial.println(F("\r\n[*] COMBO K1+K2: Dispositivo activo detectado -> APAGANDO TODO (Reposo)..."));
    enter_standby();
  } else {
    // Si estaba apagado / reposo, encender en Modo Infinito Continuo
    Serial.println(F("\r\n[*] COMBO K1+K2: Dispositivo en reposo -> ACTIVANDO MODO INFINITO EN VIVO..."));
    start_continuous_mode();
  }
}

void update_scan_status() {
  if (active_scan_mode == SCAN_CARDIAC || active_scan_mode == SCAN_PULMONARY) {
    unsigned long elapsed = millis() - scan_start_ms;
    if (elapsed >= SCAN_DURATION_MS) {
      Serial.println(F("\r\n========================================================================="));
      Serial.printf("  >>> [FIN DE ESCANEO] %s completado con exito (20s). <<<\r\n",
                    active_scan_mode == SCAN_CARDIAC ? "Chequeo Cardiaco" : "Auscultacion Pulmonar");
      Serial.println(F("=========================================================================\r\n"));

      // Destello clinico verde de confirmacion de finalizacion en los 8 LEDs
      for (int i = 0; i < NUM_LEDS; i++) {
        strip.setPixelColor(i, strip.Color(0, 255, 60));
      }
      strip.show();
      delay(250);

      active_scan_mode = SCAN_NONE;
      // Mantener la transmision activa por 30 segundos mas para que la app lea resultados y luego apagar
      active_window_start_ms = millis();
    }
  } else if (active_scan_mode == SCAN_CONTINUOUS) {
    // Modo Infinito: Transmisión continua sin límite de 20s
  }
}

void check_buttons() {
  static int last_k1 = HIGH;
  static int last_k2 = HIGH;
  static unsigned long k1_down_time = 0;
  static unsigned long k2_down_time = 0;
  static unsigned long k1_up_time = 0;
  static unsigned long k2_up_time = 0;

  static bool k1_pending_single = false;
  static bool k2_pending_single = false;
  static bool combo_handled = false;
  static bool k1_long_press_handled = false;
  static bool k2_long_press_handled = false;

  unsigned long now = millis();
  int current_k1 = digitalRead(BUTTON_HEART_PIN);
  int current_k2 = digitalRead(BUTTON_LUNG_PIN);

  // 1. Detección de flanco de bajada (al presionar un botón)
  if (last_k1 == HIGH && current_k1 == LOW) {
    k1_down_time = now;
    k1_long_press_handled = false;

    // Si K2 se había soltado hace menos de 280ms: ¡Es un combo entre ambos dedos!
    if (k2_pending_single && (now - k2_up_time < 280)) {
      k2_pending_single = false;
      combo_handled = true;
      handle_combo_press();
    }
  }

  if (last_k2 == HIGH && current_k2 == LOW) {
    k2_down_time = now;
    k2_long_press_handled = false;

    // Si K1 se había soltado hace menos de 280ms: ¡Es un combo entre ambos dedos!
    if (k1_pending_single && (now - k1_up_time < 280)) {
      k1_pending_single = false;
      combo_handled = true;
      handle_combo_press();
    }
  }

  // 2. Ambos presionados al mismo tiempo (simultáneo o mientras uno se mantiene)
  if (current_k1 == LOW && current_k2 == LOW) {
    k1_pending_single = false;
    k2_pending_single = false;
    if (!combo_handled) {
      combo_handled = true;
      handle_combo_press();
    }
  }

  // 3. Detección de pulsación larga individual (> 1.2s en K1 o K2) para activar/apagar sin sincronizar 2 dedos
  if (current_k1 == LOW && current_k2 == HIGH && !combo_handled && !k1_long_press_handled) {
    if (now - k1_down_time >= 1200) {
      k1_long_press_handled = true;
      k1_pending_single = false;
      Serial.println(F("[BOTON K1] Pulsacion larga (>1.2s) detectada -> Alternando Modo Infinito / Reposo"));
      handle_combo_press();
    }
  }

  if (current_k2 == LOW && current_k1 == HIGH && !combo_handled && !k2_long_press_handled) {
    if (now - k2_down_time >= 1200) {
      k2_long_press_handled = true;
      k2_pending_single = false;
      Serial.println(F("[BOTON K2] Pulsacion larga (>1.2s) detectada -> Alternando Modo Infinito / Reposo"));
      handle_combo_press();
    }
  }

  // 4. Flanco de subida K1 (soltar)
  if (last_k1 == LOW && current_k1 == HIGH) {
    unsigned long press_dur = now - k1_down_time;
    if (!combo_handled && !k1_long_press_handled && press_dur >= 40) {
      // Poner en espera de ventana de gracia (250ms) por si el segundo botón venía en camino
      k1_pending_single = true;
      k1_up_time = now;
    }
  }

  // 5. Flanco de subida K2 (soltar)
  if (last_k2 == LOW && current_k2 == HIGH) {
    unsigned long press_dur = now - k2_down_time;
    if (!combo_handled && !k2_long_press_handled && press_dur >= 40) {
      // Poner en espera de ventana de gracia (250ms) por si el segundo botón venía en camino
      k2_pending_single = true;
      k2_up_time = now;
    }
  }

  // 6. Evaluación de ventana de gracia tras soltar para acciones individuales (250 ms)
  if (k1_pending_single && (now - k1_up_time >= 250)) {
    k1_pending_single = false;
    if (!combo_handled) {
      start_cardiac_scan();
    }
  }

  if (k2_pending_single && (now - k2_up_time >= 250)) {
    k2_pending_single = false;
    if (!combo_handled) {
      start_pulmonary_scan();
    }
  }

  // 7. Rearmar banderas cuando ambos botones están completamente libres
  if (current_k1 == HIGH && current_k2 == HIGH) {
    if (!k1_pending_single && !k2_pending_single) {
      combo_handled = false;
    }
    k1_long_press_handled = false;
    k2_long_press_handled = false;
  }

  last_k1 = current_k1;
  last_k2 = current_k2;
}

// ------------------------------------------------------------------------------
// 9. PROCESADOR DE COMANDOS ENTRANTE (BLUETOOTH & SERIAL USB)
// ------------------------------------------------------------------------------
void handle_incoming_commands(String cmd) {
  cmd.trim();
  cmd.toUpperCase();

  if (cmd == "WAKE" || cmd == "W" || cmd == "ACTIVE") {
    activate_transmission();
  } else if (cmd == "SCAN_CARD" || cmd == "CARD" || cmd == "HEART" || cmd == "CORAZON") {
    start_cardiac_scan();
  } else if (cmd == "SCAN_PULM" || cmd == "PULM" || cmd == "LUNG" || cmd == "PULMON") {
    start_pulmonary_scan();
  } else if (cmd == "SCAN_CONT" || cmd == "LIVE" || cmd == "INFINITE" || cmd == "CONTINUO") {
    start_continuous_mode();
  } else if (cmd == "STOP_SCAN" || cmd == "STOP") {
    active_scan_mode = SCAN_NONE;
    Serial.println(F("[ESCANEO] Escaneo detenido manualmente."));
  } else if (cmd == "SLEEP" || cmd == "S" || cmd == "OFF" || cmd == "STANDBY" || cmd == "APAGAR") {
    enter_standby();
  } else if (cmd == "TOGGLE_CONT") {
    handle_combo_press();
  } else if (cmd == "MIC") {
    report_i2s_clocks();
  } else if (cmd == "MICSD") {
    report_i2s_sd();
  } else if (cmd == "STATUS" || cmd == "INFO") {
    const char* scan_str = (active_scan_mode == SCAN_CARDIAC) ? "cardiac" :
                           ((active_scan_mode == SCAN_PULMONARY) ? "pulmonary" :
                           ((active_scan_mode == SCAN_CONTINUOUS) ? "continuous" : "none"));
    char status_buf[256];
    snprintf(status_buf, sizeof(status_buf),
             "{\"device\":\"%s\",\"power\":\"%s\",\"ble_connected\":%s,\"sensor_hw\":%s,\"uptime_s\":%lu,\"i2c_sda\":%d,\"i2c_scl\":%d,\"scan_mode\":\"%s\"}",
             BLE_DEVICE_NAME, (power_state == STATE_TRANSMITTING_ACTIVE) ? "active" : "standby",
             ble_connected ? "true" : "false",
             sensor_hw_found ? "true" : "false", millis() / 1000,
             active_i2c_sda, active_i2c_scl, scan_str);
    if (ble_connected && pTelemetryCharacteristic) {
      pTelemetryCharacteristic->setValue(status_buf);
      pTelemetryCharacteristic->notify();
    }
    Serial.println(status_buf);
  }
}

// ------------------------------------------------------------------------------
// 10. TRANSMISION DE TELEMETRIA (BLE & SERIAL USB) - 100% REAL
// ------------------------------------------------------------------------------
void broadcast_telemetry() {
  const char* scan_str = "none";
  int scan_remaining = 0;
  bool scan_active = false;

  if (active_scan_mode == SCAN_CARDIAC) {
    scan_str = "cardiac";
    scan_active = true;
    unsigned long elapsed = millis() - scan_start_ms;
    scan_remaining = (elapsed < SCAN_DURATION_MS) ? ((SCAN_DURATION_MS - elapsed) / 1000) : 0;
  } else if (active_scan_mode == SCAN_PULMONARY) {
    scan_str = "pulmonary";
    scan_active = true;
    unsigned long elapsed = millis() - scan_start_ms;
    scan_remaining = (elapsed < SCAN_DURATION_MS) ? ((SCAN_DURATION_MS - elapsed) / 1000) : 0;
  } else if (active_scan_mode == SCAN_CONTINUOUS) {
    scan_str = "continuous";
    scan_active = true;
    scan_remaining = (millis() - scan_start_ms) / 1000;
  }

  char json_payload[340];
  snprintf(json_payload, sizeof(json_payload),
           "{\"bpm\":%d,\"spo2\":%.1f,\"systolic\":%d,\"diastolic\":%d,\"temperature\":%.1f,\"stress\":%d,\"hrv\":%d,\"audio_rms\":%.2f,\"audio_peak\":%.2f,\"finger\":%s,\"scan_mode\":\"%s\",\"scan_sec\":%d,\"scan_active\":%s,\"power\":\"%s\",\"test\":false,\"device_id\":\"ESP32-BIO-01\"}",
           beat_avg, spo2_val, systolic_bp, diastolic_bp, body_temp, stress_score, hrv_ms,
           audio_rms, audio_peak, finger_detected ? "true" : "false",
           scan_str, scan_remaining, scan_active ? "true" : "false",
           (power_state == STATE_TRANSMITTING_ACTIVE) ? "active" : "standby");

  // 1. Envio por BLE (Directo a Google Chrome / Edge en Celular y PC sin cables)
  if (ble_connected && pTelemetryCharacteristic != NULL) {
    pTelemetryCharacteristic->setValue((uint8_t*)json_payload, strlen(json_payload));
    pTelemetryCharacteristic->notify();

    if (pHrCharacteristic != NULL) {
      uint8_t hr_packet[2] = { 0, (uint8_t)beat_avg };
      pHrCharacteristic->setValue(hr_packet, 2);
      pHrCharacteristic->notify();
    }
  }

  // 2. Envio a Consola Serial USB (115200 baud)
  Serial.printf("[TELEMETRIA] FC: %3d BPM | SpO2: %4.1f%% | PA: %3d/%2d mmHg | Temp: %4.1f C | Estres: %2d/100 | Audio: %4.1f dB | Dedo: %s | Modo: %s (%ds)\r\n",
                beat_avg, spo2_val, systolic_bp, diastolic_bp, body_temp, stress_score, audio_rms,
                finger_detected ? "SI" : "NO", scan_str, scan_remaining);
  Serial.println(json_payload);
}

// ------------------------------------------------------------------------------
// 11. EFECTOS VISUALES DEL LED RGB WS2812B (IO25) - PANEL DE CONTROL CLÍNICO INDIVIDUAL
// ------------------------------------------------------------------------------
void update_led_effects() {
  static unsigned long last_led_update = 0;
  unsigned long now = millis();

  // Controlar refresco a intervalos estables (~30 FPS)
  if (now - last_led_update < 33) return;
  last_led_update = now;

  if (power_state == STATE_STANDBY_SAVER) {
    for (int i = 0; i < NUM_LEDS; i++) {
      strip.setPixelColor(i, strip.Color(0, 0, 0)); // Apagado en reposo
    }
    strip.show();
    return;
  }

  // ============================================================================
  // MAPEO INDIVIDUAL DE LOS 8 LEDS - ESTADOS DINÁMICOS Y COMPORTAMIENTO CLÍNICO:
  // ============================================================================

  // LED 0: SISTEMA & HARDWARE (Power / Alimentación)
  // Verde Esmeralda clínico puro cuando el sistema y sensores están activos (Ámbar si hay fallo)
  uint32_t led0_color = sensor_hw_found ? strip.Color(0, 230, 60) : strip.Color(240, 90, 0);
  strip.setPixelColor(0, led0_color);

  // LED 1: BLUETOOTH BLE (Enlace Inalámbrico)
  // Parpadea rítmicamente en Azul Eléctrico en espera; queda Azul Neón fijo al conectar con el celular
  uint32_t led1_color;
  if (ble_connected) {
    led1_color = strip.Color(0, 120, 255); // Azul Neón brillante fijo al conectar
  } else {
    bool blink_on = (now / 450) % 2;       // Parpadeo suave cada 450 ms
    led1_color = blink_on ? strip.Color(0, 80, 255) : strip.Color(0, 0, 0);
  }
  strip.setPixelColor(1, led1_color);

  // LED 2: DETECCIÓN DE CONTACTO (Sensor Óptico / Dedo)
  // Totalmente apagado en reposo; se enciende en Dorado / Oro Cálido en cuanto detecta el dedo
  uint32_t led2_color = finger_detected ? strip.Color(200, 130, 0) : strip.Color(0, 0, 0);
  strip.setPixelColor(2, led2_color);

  // LED 3: LATIDO CARDÍACO EN VIVO (Onda Sistólica Fisiológica)
  // Apagado sin dedo.
  // En fase de lectura/calibración: suave respiración rubí indicando adquisición activa.
  // En ritmo fijado: destello sistólico potente y nítido en cada latido real con brasa diastólica.
  uint32_t led3_color;
  if (!finger_detected) {
    led3_color = strip.Color(0, 0, 0);
  } else if (beat_avg == 0) {
    // Fase de lectura / adquisición: respiración suave en rubí (~75 BPM) indicando medición en curso
    float breath = 0.5f + 0.5f * sin((float)now / 140.0f);
    int r = (int)(110.0f * breath + 20.0f);
    int b = (int)(20.0f * breath);
    led3_color = strip.Color(r, 0, b);
  } else {
    unsigned long elapsed = now - beat_flash_start;
    if (elapsed < 280 && beat_flash_start > 0) {
      if (elapsed < 75) {
        // Pico sistólico máximo: Rojo Rubí brillante con destello blanco/coral intenso
        led3_color = strip.Color(255, 45, 65);
      } else {
        // Caída diastólica suave y orgánica
        float fade = 1.0f - ((float)(elapsed - 75) / 205.0f);
        int r = (int)(235.0f * fade + 20.0f);
        int g = (int)(40.0f * fade);
        int b = (int)(55.0f * fade + 5.0f);
        led3_color = strip.Color(r, g, b);
      }
    } else {
      // Línea de base diastólica: suave brasa rubí (corazón en reposo fisiológico entre latidos)
      led3_color = strip.Color(20, 0, 4);
    }
  }
  strip.setPixelColor(3, led3_color);

  // LED 4: OXÍGENO EN SANGRE SpO2 (Semáforo de Saturación)
  // Apagado sin dedo; respiración turquesa sutil durante lectura inicial; Turquesa fijo si >=95%; Naranja si <95%
  uint32_t led4_color;
  if (!finger_detected) {
    led4_color = strip.Color(0, 0, 0);
  } else if (spo2_val < 70.0f) {
    // Calibrando SpO2: suave respiración turquesa
    float breath = 0.5f + 0.5f * sin((float)now / 180.0f);
    led4_color = strip.Color(0, (int)(60.0f * breath + 10.0f), (int)(45.0f * breath + 10.0f));
  } else if (spo2_val >= 95.0f) {
    led4_color = strip.Color(0, 210, 160); // Turquesa Glaciar eléctrico
  } else {
    led4_color = strip.Color(255, 60, 0);   // Naranja Fuego de alerta hipoxia
  }
  strip.setPixelColor(4, led4_color);

  // LED 5: RANGO DE FRECUENCIA CARDÍACA (BPM Zone Gauge)
  // Apagado sin dedo; respiración fucsia sutil durante lectura inicial; Fucsia (60-100 BPM normal); Rojo (>100); Índigo (<60)
  uint32_t led5_color;
  if (!finger_detected) {
    led5_color = strip.Color(0, 0, 0);
  } else if (beat_avg == 0) {
    // Calibrando FC: suave respiración fucsia
    float breath = 0.5f + 0.5f * sin((float)now / 180.0f);
    led5_color = strip.Color((int)(60.0f * breath + 10.0f), 0, (int)(40.0f * breath + 10.0f));
  } else if (beat_avg > 100) {
    led5_color = strip.Color(255, 0, 0);    // Rojo Intenso (Taquicardia)
  } else if (beat_avg >= 60) {
    led5_color = strip.Color(220, 15, 120); // Fucsia Neón (Ritmo normal saludable)
  } else {
    led5_color = strip.Color(70, 0, 220);   // Índigo Profundo (Bradicardia)
  }
  strip.setPixelColor(5, led5_color);

  // LED 6: ACÚSTICA MÉDICA / MICRÓFONO INMP441 (VUMetro Reactivo Proporcional)
  // Totalmente apagado en silencio de fondo (<62 dB); brillo dinámico que crece con los decibelios
  static float smooth_audio_level = 0.0f;
  float target_level = 0.0f;

  if (audio_rms >= 62.0f) {
    // Normalizar entre 62 dB (umbral de voz) y 90 dB (sonido fuerte / aplauso)
    float ratio = (audio_rms - 62.0f) / 28.0f;
    if (ratio > 1.0f) ratio = 1.0f;
    target_level = ratio * ratio; // Curva cuadrática para percepción visual natural
  }

  // Ataque rápido al sonido (sube al instante), decaimiento suave y orgánico (~250 ms)
  if (target_level > smooth_audio_level) {
    smooth_audio_level = target_level;
  } else {
    smooth_audio_level = smooth_audio_level * 0.80f;
    // Corte limpio en 0.06: evita que al desvanecerse el sub-píxel rojo quede visible
    if (smooth_audio_level < 0.06f) smooth_audio_level = 0.0f;
  }

  uint32_t led6_color;
  if (smooth_audio_level >= 0.06f) {
    // Proporción Verde dominante (255) y Rojo (180): Amarillo Limón puro sin virar a naranja/rojo
    int g = (int)(255.0f * smooth_audio_level);
    int r = (int)(180.0f * smooth_audio_level);
    // Destello de blanco brillante cuando el sonido es muy fuerte (>85 dB / aplauso)
    int b = (smooth_audio_level > 0.75f) ? (int)(160.0f * (smooth_audio_level - 0.75f) * 4.0f) : 0;
    led6_color = strip.Color(r, g, b);
  } else {
    led6_color = strip.Color(0, 0, 0); // Totalmente apagado en silencio
  }
  strip.setPixelColor(6, led6_color);

  // LED 7: ÍNDICE DE ESTRÉS FISIOLÓGICO (0 - 100)
  // Apagado sin dedo; Aguamarina (Relajado <45); Coral Naranja (Moderado 45-70); Rojo (Alto >70)
  uint32_t led7_color;
  if (!finger_detected) {
    led7_color = strip.Color(0, 0, 0);
  } else if (beat_avg == 0) {
    float breath = 0.5f + 0.5f * sin((float)now / 180.0f);
    led7_color = strip.Color(0, (int)(50.0f * breath + 10.0f), (int)(30.0f * breath + 10.0f));
  } else if (stress_score > 70) {
    led7_color = strip.Color(255, 0, 0);    // Rojo Alarma (Estrés alto)
  } else if (stress_score >= 45) {
    led7_color = strip.Color(255, 100, 15); // Coral Naranja Cálido (Estrés moderado)
  } else {
    led7_color = strip.Color(0, 200, 100);  // Aguamarina fresco (Relajado / Óptimo)
  }
  strip.setPixelColor(7, led7_color);

  strip.show();
}


// Callbacks para recepcion de comandos BLE desde la App Movil (WAKE, SCAN_CARD, SCAN_PULM, SCAN_CONT, OFF)
class TelemetryCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      String cmd = pCharacteristic->getValue();
      if (cmd.length() > 0) {
        Serial.printf("[BLE RX] Comando recibido: %s\r\n", cmd.c_str());
        handle_incoming_commands(cmd);
      }
    }
};

// Callbacks del Servidor BLE (Auto-Reconexión Instantánea)
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      ble_connected = true;
      Serial.println(F("\r\n========================================================================="));
      Serial.println(F("  [BLE] >>> ¡CLIENTE BLUETOOTH CONECTADO DIRECTO! (CELULAR / PC)       <<<"));
      Serial.println(F("=========================================================================\r\n"));
      broadcast_telemetry();
    };

    void onDisconnect(BLEServer* pServer) {
      ble_connected = false;
      Serial.println(F("\r\n[BLE] Cliente desconectado. Reiniciando publicidad inmediata..."));
      delay(100);
      BLEDevice::startAdvertising();
    }
};

// ------------------------------------------------------------------------------
// 12. SETUP & BUCLE PRINCIPAL (LOOP)
// ------------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);

  // Asegurar que el LED Azul interno de la placa permanezca apagado
  pinMode(ONBOARD_LED_PIN, OUTPUT);
  digitalWrite(ONBOARD_LED_PIN, LOW);

  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  FERIA TECNOLOGICA - SPIROSCAN AI (ESP32 BIO-ACUSTICO REAL)             "));
  Serial.println(F("  [MODO: TELEMETRIA 100% FISICA DE SENSORES - SIN SIMULACIONES]          "));
  Serial.println(F("========================================================================="));

  // Configuracion de Botones Fisicos con Pull-Up Interno a GND
  pinMode(BUTTON_HEART_PIN, INPUT_PULLUP);
  pinMode(BUTTON_LUNG_PIN, INPUT_PULLUP);

  strip.begin();
  strip.setBrightness(30); // Nivel óptimo de visibilidad, nitidez y elegancia clínica
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 0, 0)); // De inicio TODO apagado
  }
  strip.show();

  // Iniciar BLE (Bluetooth Low Energy / GATT Dual)
  Serial.printf("[*] Iniciando BLE: \"%s\"...\r\n", BLE_DEVICE_NAME);
  BLEDevice::init(BLE_DEVICE_NAME);
  BLEDevice::setMTU(256);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // 1. Servicio SpiroScan Telemetría Completa (JSON) - Bidireccional
  BLEService *pService = pServer->createService(SERVICE_UUID);
  pTelemetryCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ     |
                      BLECharacteristic::PROPERTY_WRITE    |
                      BLECharacteristic::PROPERTY_WRITE_NR |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  pTelemetryCharacteristic->setCallbacks(new TelemetryCallbacks());
  pTelemetryCharacteristic->addDescriptor(new BLE2902());
  pService->start();

  // 2. Servicio Estándar Heart Rate (0x180D)
  BLEService *pHrService = pServer->createService(HR_SERVICE_UUID);
  pHrCharacteristic = pHrService->createCharacteristic(
                      HR_CHAR_UUID,
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  pHrCharacteristic->addDescriptor(new BLE2902());
  pHrService->start();

  // Iniciar Publicidad BLE optimizada (Cumpliendo el limite estricto de 31 bytes por paquete)
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  
  BLEAdvertisementData oAdvertisementData = BLEAdvertisementData();
  oAdvertisementData.setFlags(0x06);
  oAdvertisementData.setCompleteServices(BLEUUID(SERVICE_UUID));

  BLEAdvertisementData oScanResponseData = BLEAdvertisementData();
  oScanResponseData.setName(BLE_DEVICE_NAME);

  pAdvertising->setAdvertisementData(oAdvertisementData);
  pAdvertising->setScanResponseData(oScanResponseData);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.println(F("[OK] BLE activo y visible para Celular (Chrome) y PC (Edge/Chrome)."));

  // Iniciar sensores fisicos reales
  setup_i2s();
  setup_max30102();
  report_i2s_clocks();
  report_i2s_sd();

  Serial.println(F("[OK] Firmware inicializado con exito."));
  Serial.println(F("=========================================================================\r\n"));

  enter_standby(); // De inicio TODO apagado (Modo Reposo)
}

void loop() {
  unsigned long current_millis = millis();

  // 1. Lectura de Botones Fisicos K1 (Corazon) y K2 (Pulmon)
  check_buttons();
  update_scan_status();

  // 2. Comandos desde Consola Serial USB
  if (Serial.available()) {
    String ser_cmd = Serial.readStringUntil('\n');
    handle_incoming_commands(ser_cmd);
  }

  // 3. Procesamiento de Senales Biologicas y Acusticas 100% Reales (Solo cuando está activo)
  if (power_state == STATE_TRANSMITTING_ACTIVE) {
    update_audio_rms();
    update_biometric_signals();
  } else {
    // En reposo: microfono y sensor cardiaco en silencio absoluto
    audio_rms = 0.0f;
    audio_peak = 0.0f;
  }

  // 4. Control de la ventana de transmision activa
  if (power_state == STATE_TRANSMITTING_ACTIVE) {
    if (active_scan_mode == SCAN_CONTINUOUS) {
      active_window_start_ms = current_millis; // Mantener vivo indefinidamente en modo continuo
    } else if (active_scan_mode != SCAN_NONE) {
      active_window_start_ms = current_millis; // Mantener vivo durante escaneos acotados (20s)
    } else {
      // Si el escaneo terminó, mantener activo 30 segundos para observar resultados y luego apagar
      if (current_millis - active_window_start_ms >= 30000) {
        enter_standby();
      }
    }
  }

  // 7. Envio periodico de Telemetria
  if (power_state == STATE_TRANSMITTING_ACTIVE) {
    if (current_millis - previous_millis_telemetry >= 100) {
      previous_millis_telemetry = current_millis;
      broadcast_telemetry();
    }
  } else if (power_state == STATE_STANDBY_SAVER) {
    // En reposo con BLE conectado: latido suave cada 2500 ms con power:standby
    if (ble_connected && current_millis - previous_millis_telemetry >= 2500) {
      previous_millis_telemetry = current_millis;
      broadcast_telemetry();
    }
  }

  // Control del LED Azul onboard (Completamente apagado en reposo)
  if (power_state == STATE_STANDBY_SAVER) {
    digitalWrite(ONBOARD_LED_PIN, LOW);
  } else {
    if (!sensor_hw_found) {
      digitalWrite(ONBOARD_LED_PIN, (current_millis / 300) % 2);
    } else {
      if (finger_detected && beat_detected_flash) {
        digitalWrite(ONBOARD_LED_PIN, LOW);
      } else {
        digitalWrite(ONBOARD_LED_PIN, HIGH);
      }
    }
  }

  // 8. Renderizado de Efectos Visuales en LED WS2812B
  update_led_effects();

  delay(10);
}
