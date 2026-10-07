/**
 * SpiroScan ESP32S: MAX30102 SDA23/SCL22, INMP441 SCK27/WS15/SD32.
 * Control desde la app, sin botones fisicos. WiFi/USB; BLE opcional.
 * Adquisicion continua al encender; audio local de 15 s y envio HTTPS.
 * Lecturas ausentes o caducadas llevan validez falsa.
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
#include "MAX30105Buffered.h"
#include "spo2_algorithm.h"
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
static QueueHandle_t incoming_commands = nullptr;
static volatile bool initial_telemetry_pending = false;

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
#define WS2812_PIN         25   // LED RGB WS2812B (LED1)
#define ONBOARD_LED_PIN    2    // LED Azul interno de la placa
#define NUM_LEDS           8    // Tira/Barra de 8 LEDs RGB direccionables

// Modos y Temporizacion de Escaneos Acotados y Modo Infinito Continuo
enum ScanMode {
  SCAN_NONE = 0,
  SCAN_CARDIAC = 1,
  SCAN_PULMONARY = 2,
  SCAN_CONTINUOUS = 3  // Modo Infinito / Continuo en Tiempo Real (Inicio automatico o comando)
};
ScanMode active_scan_mode = SCAN_NONE;
unsigned long scan_start_ms = 0;
const unsigned long SCAN_DURATION_MS = 20000; // 20 segundos estandarizados
bool cardiac_locked = false;                  // True tras detectar intervalos de pulso estables; no implica calibracion.
unsigned long cardiac_wait_start_ms = 0;      // Tiempo de espera para colocar el dedo

Adafruit_NeoPixel strip(NUM_LEDS, WS2812_PIN, NEO_GRB + NEO_KHZ800);
#include "auscultacion.h"
#ifndef SPIROSCAN_ENABLE_BLE
#define SPIROSCAN_ENABLE_BLE 1
#endif
static volatile bool recording_requested = false;
static volatile bool optical_probe_requested = false;
static volatile bool optical_probe_running = false;
MAX30105Buffered particleSensor;

// ------------------------------------------------------------------------------
// 3. VARIABLES GLOBALES BIOMEDICAS Y ACUSTICAS (100% FISICAS)
// ------------------------------------------------------------------------------
bool sensor_hw_found = false;
bool finger_detected = false;

// BPM y PRV se calculan con intervalos PPG a 100 Hz (resolucion temporal 10 ms).
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

const uint32_t PPG_SAMPLE_PERIOD_US = 10000; // 400 conversiones/s / promedio FIFO de 4 = 100 pares/s.
const uint16_t PRV_INTERVAL_CAPACITY = 96;
uint32_t ppg_intervals_us[PRV_INTERVAL_CAPACITY] = {};
uint64_t ppg_interval_end_us[PRV_INTERVAL_CAPACITY] = {};
uint16_t ppg_interval_count = 0;
uint16_t ppg_interval_write = 0;
uint64_t ppg_sample_us = 0;
uint64_t ppg_last_beat_us = 0;
uint32_t last_good_interval_us = 800000; // ~75 BPM inicial de referencia para refractario
uint64_t ppg_finger_start_us = 0;
unsigned long ppg_last_data_ms = 0;
unsigned long ppg_last_poll_ms = 0;
float ppg_ir_dc = 0;
float ppg_ir_ac = 0;
float ppg_previous_ac = 0;
float ppg_cycle_min = 0;
float ppg_cycle_max = 0;
bool bpm_valid = false;
bool hrv_valid = false; // PRV: RMSSD de intervalos opticos; no equivale a HRV de ECG.
bool spo2_valid = false; // Validez del algoritmo de referencia, no calibracion clinica.
bool audio_valid = false;
unsigned long audio_last_data_ms = 0;
float chip_temp = 0;
bool chip_temp_valid = false;
bool chip_temp_pending = false;
unsigned long chip_temp_start_ms = 0;
unsigned long chip_temp_last_read_ms = 0;
uint32_t spo2_ir[BUFFER_SIZE] = {};
uint32_t spo2_red[BUFFER_SIZE] = {};
uint16_t spo2_sample_count = 0;
uint32_t spo2_ir_sum = 0;
uint32_t spo2_red_sum = 0;
uint8_t spo2_decimation_count = 0;
unsigned long spo2_last_result_ms = 0;
unsigned long spo2_last_valid_ms = 0;
const char* spo2_status = "acquiring";
uint32_t ppg_fifo_dropped = 0;
uint32_t ppg_i2c_errors = 0;
uint32_t ppg_samples_acquired = 0;
uint8_t ppg_max_batch = 0;
uint32_t ppg_last_raw_red = 0;
uint32_t ppg_last_raw_ir = 0;
uint8_t spo2_consistent_windows = 0;
int32_t spo2_previous_candidate = 0;
const char* FIRMWARE_ID = "2026-10-06-esp32s-telemetry";
void invalidate_spo2(const char* reason, bool clear_window) {
  spo2_valid = false;
  spo2_val = 0.0f;
  spo2_last_valid_ms = 0;
  spo2_status = reason;
  spo2_consistent_windows = 0;
  spo2_previous_candidate = 0;
  if (clear_window) {
    spo2_sample_count = 0;
    spo2_decimation_count = 0;
    spo2_ir_sum = spo2_red_sum = 0;
  }
}
bool max_read_register(uint8_t reg, uint8_t* values, uint8_t count) {
  Wire.beginTransmission(0x57);
  Wire.write(reg);
  // SparkFun/main uses STOP when selecting FIFO_DATA, repeated START for
  // ordinary registers. Preserve that tested transaction pattern.
  if (Wire.endTransmission(reg == 0x07) != 0) return false;
  if (Wire.requestFrom((uint8_t)0x57, count) != count) return false;
  for (uint8_t i = 0; i < count; i++) values[i] = Wire.read();
  return true;
}

void reset_biometric_state(bool clear_fifo);
void broadcast_telemetry();

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
    .dma_buf_count = 8,
    .dma_buf_len = 256,
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

  esp_err_t err = i2s_driver_install(I2S_PORT, &i2s_config, 16, &ausc_i2s_events);
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

bool max_soft_address_probe(int sda, int scl) {
  Wire.end();
  pinMode(sda, OUTPUT_OPEN_DRAIN); pinMode(scl, OUTPUT_OPEN_DRAIN);
  gpio_set_pull_mode((gpio_num_t)sda, GPIO_PULLUP_ONLY);
  gpio_set_pull_mode((gpio_num_t)scl, GPIO_PULLUP_ONLY);
  digitalWrite(sda, HIGH); digitalWrite(scl, HIGH); delayMicroseconds(100);
  bool idle = digitalRead(sda) && digitalRead(scl);
  Serial.printf("[I2C DIRECTO] SDA%d=%d SCL%d=%d; direccion 0x57 a ~5 kHz\r\n", sda, digitalRead(sda), scl, digitalRead(scl));
  bool ack = false;
  if (idle) {
    digitalWrite(sda, LOW); delayMicroseconds(100);
    for (int bit = 7; bit >= 0; --bit) {
      digitalWrite(scl, LOW);
      digitalWrite(sda, (0xAE >> bit) & 1); delayMicroseconds(100);
      digitalWrite(scl, HIGH); delayMicroseconds(100);
    }
    digitalWrite(scl, LOW); digitalWrite(sda, HIGH); delayMicroseconds(100);
    digitalWrite(scl, HIGH); delayMicroseconds(100);
    ack = digitalRead(scl) && digitalRead(sda) == LOW;
    digitalWrite(scl, LOW); digitalWrite(sda, LOW); delayMicroseconds(100);
    digitalWrite(scl, HIGH); delayMicroseconds(100); digitalWrite(sda, HIGH);
  }
  pinMode(sda, INPUT_PULLUP); pinMode(scl, INPUT_PULLUP);
  Serial.printf("[I2C DIRECTO] %s\r\n", ack ? "ACK recibido: el modulo responde sin el controlador Wire" : "Sin ACK: el modulo tampoco responde al sondeo directo");
  return ack;
}

void setup_max30102() {
  struct I2CPinConfig {
    int sda;
    int scl;
    const char* label;
  };

  // Rutas de sondeo segun conexionado fisico de la placa (NodeMCU-32S y DevKit)
  I2CPinConfig pin_options[] = {
    {23, 22, "Conexion del usuario (P23=SDA, P22=SCL)"},
    {18, 19, "Prueba alternativa (P18=SDA, P19=SCL)"},
    {21, 22, "Estandar ESP32 (P21=SDA, P22=SCL)"},
    {22, 23, "NodeMCU-32S Invertido (P22=SDA, P23=SCL)"},
    {22, 21, "Estandar Invertido (P22=SDA, P21=SCL)"}
  };

  sensor_hw_found = false;

  // Desacoplar I2C y realizar ciclo de recuperacion de bus
  i2c_bus_recovery(21, 22);
  i2c_bus_recovery(23, 22);
  i2c_bus_recovery(18, 19);

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
      if (!particleSensor.begin(Wire, I2C_SPEED_STANDARD)) {
        Serial.println("[I2C] Direccion 0x57 responde pero PART_ID no corresponde a MAX30102.");
        continue;
      }
      // SparkFun begin() internamente llama Wire.begin() sin parametros (resetea a 21/22).
      // Re-aplicamos de inmediato los pines configurados por el usuario:
      Wire.begin(sda, scl, 100000);

      particleSensor.setup(0x35, 4, 2, 400, 411, 4096);
      particleSensor.setPulseAmplitudeRed(0x35);
      particleSensor.setPulseAmplitudeIR(0x35);
      particleSensor.setPulseAmplitudeGreen(0);
      particleSensor.clearFIFO();
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
  const I2CPinConfig direct_options[] = {
    {23, 22, "Original"}, {18, 19, "Alternativa"}
  };
  for (const auto& pins : direct_options) {
    if (!max_soft_address_probe(pins.sda, pins.scl)) continue;
    Wire.begin(pins.sda, pins.scl, 10000); Wire.setTimeOut(100);
    if (particleSensor.begin(Wire, 10000)) {
      // Ruta lenta: mantener el FIFO por debajo del ancho de banda del bus.
      particleSensor.setup(0x35, 4, 2, 100, 411, 4096);
      particleSensor.setPulseAmplitudeRed(0x35);
      particleSensor.setPulseAmplitudeIR(0x35);
      particleSensor.setPulseAmplitudeGreen(0);
      particleSensor.clearFIFO();
      sensor_hw_found = true;
      active_i2c_sda = pins.sda; active_i2c_scl = pins.scl;
      Serial.printf("[OK] MAX30102 detectado con bus lento de 10 kHz: SDA%d/SCL%d.\r\n",
                    pins.sda, pins.scl);
      return;
    }
    Wire.end();
  }
  sensor_hw_found = false;
  Serial.println(F("[WARN] Sensor MAX30102 no detectado en I2C en ninguna combinacion de pines."));
  Serial.println(F("========================================================================="));
  Serial.println(F("  >>> DIAGNOSTICO DE CONEXION FISICA (NodeMCU ESP-32S):               <<<"));
  Serial.println(F("  1. Verificar alimentacion segun la placa MAX30102 concreta y tierra comun."));
  Serial.println(F("  2. CABLE GND: Asegurate de conectar GND (pin 7 del sensor).         <<<"));
  Serial.println(F("  3. CABLES I2C: Conectar SCL a P22 y SDA a P21 (o P23).              <<<"));
  Serial.println(F("========================================================================="));
}

// ------------------------------------------------------------------------------
// 6. PROCESAMIENTO ACUSTICO REAL (INMP441) CON FILTRO DC
// ------------------------------------------------------------------------------
void update_audio_rms() {
  if (!SPIROSCAN_MIC_CONNECTED) {
    audio_valid = false;
    audio_rms = 0.0f;
    audio_peak = 0.0f;
    return;
  }
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
      audio_valid = false;
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
        // Nivel digital referido a la escala completa de 24 bits; no es dB SPL calibrado.
        audio_rms = 20.0f * log10f((float)raw_rms / 8388608.0f);
        audio_peak = max_peak_local / 8388608.0f;
        audio_valid = true;
        audio_last_data_ms = millis();
      } else {
        // Silencio relativo
        audio_rms = 0.0f;
        audio_peak = 0.0f;
        audio_valid = false;
      }
    } else {
      audio_rms = 0.0f;
      audio_peak = 0.0f;
      audio_valid = false;
    }
  } else {
    static unsigned long last_dbg_audio_err = 0;
    if (millis() - last_dbg_audio_err >= 1000) {
      last_dbg_audio_err = millis();
      Serial.printf("[DEBUG I2S AUDIO ERR] res:%d bytes:%d\r\n", result, bytes_read);
    }
    audio_rms = 0.0f;
    audio_peak = 0.0f;
    audio_valid = false;
  }
}

// ------------------------------------------------------------------------------
// 7. PROCESAMIENTO BIOMEDICO OPTICO REAL (MAX30102) - CERO SIMULACION
// ------------------------------------------------------------------------------
void reset_biometric_state(bool clear_fifo) {
  invalidate_spo2("acquiring", true);
  chip_temp_pending = false;
  finger_detected = false;
  bpm_valid = false;
  spo2_valid = false;
  hrv_valid = false;
  chip_temp_valid = false;
  beat_avg = 0;
  spo2_val = 0.0f;
  hrv_ms = 0;
  systolic_bp = 0;
  diastolic_bp = 0;
  body_temp = 0.0f;
  chip_temp = 0.0f;
  stress_score = 0;
  beat_detected_flash = false;
  beat_flash_start = 0;
  ppg_sample_us = 0;
  ppg_last_beat_us = 0;
  last_good_interval_us = 800000;
  ppg_finger_start_us = 0;
  ppg_interval_count = 0;
  ppg_interval_write = 0;
  ppg_ir_dc = 0.0f;
  ppg_ir_ac = 0.0f;
  ppg_previous_ac = 0.0f;
  ppg_cycle_min = 0.0f;
  ppg_cycle_max = 0.0f;
  spo2_sample_count = 0;
  spo2_decimation_count = 0;
  spo2_ir_sum = 0;
  spo2_red_sum = 0;
  for (uint16_t i = 0; i < PRV_INTERVAL_CAPACITY; i++) {
    ppg_intervals_us[i] = 0;
    ppg_interval_end_us[i] = 0;
  }
  if (clear_fifo && sensor_hw_found) {
    particleSensor.clearFIFO();
  }
}

void update_biometric_signals() {
  if (!sensor_hw_found) {
    reset_biometric_state(false);
    return;
  }

  unsigned long now_ms = millis();
  uint64_t now_us = esp_timer_get_time();

  // Leer muestras disponibles en el FIFO del MAX30102
  if (ppg_last_data_ms && now_ms - ppg_last_data_ms > 250) invalidate_spo2("sample_gap", true);
  uint16_t fetched = particleSensor.check();
  if (fetched > 31) {
    ppg_i2c_errors++;
    invalidate_spo2("i2c_error", true);
    bpm_valid = hrv_valid = false;
    beat_avg = hrv_ms = stress_score = 0;
    particleSensor.clearFIFO();
    return;
  }
  uint8_t retained = particleSensor.available();
  ppg_max_batch = max(ppg_max_batch, retained);
  ppg_samples_acquired += retained;
  if (fetched > retained) {
    ppg_fifo_dropped += fetched - retained;
    invalidate_spo2("software_fifo_gap", true);
  }
  while (particleSensor.available()) {
    uint32_t raw_ir = particleSensor.getFIFOIR();
    uint32_t raw_red = particleSensor.getFIFORed();
    particleSensor.nextSample();
    ppg_last_raw_red = raw_red;
    ppg_last_raw_ir = raw_ir;

    ppg_last_data_ms = now_ms;
    bool prev_finger = finger_detected;

    // 1. Detección física real de dedo (umbral óptico IR > 40000)
    if (raw_ir < 40000) {
      invalidate_spo2("no_contact", true);
      if (prev_finger) {
        finger_detected = false;
        bpm_valid = false;
        spo2_valid = false;
        hrv_valid = false;
        beat_avg = 0;
        spo2_val = 0.0f;
        hrv_ms = 0;
        stress_score = 0;
        systolic_bp = 0;
        diastolic_bp = 0;
        beat_detected_flash = false;
        beat_flash_start = 0;
        ppg_last_beat_us = 0;
        ppg_cycle_min = 0.0f;
        ppg_cycle_max = 0.0f;
        if (power_state == STATE_TRANSMITTING_ACTIVE) {
          broadcast_telemetry();
        }
      }
      continue;
    }

    finger_detected = true;

    // Si el dedo acaba de ser colocado: sincronización limpia
    if (!prev_finger) {
      ppg_finger_start_us = now_us;
      ppg_sample_us = now_us;
      ppg_last_beat_us = 0;
      ppg_interval_count = 0;
      ppg_interval_write = 0;
      ppg_ir_dc = (float)raw_ir;
      ppg_ir_ac = 0.0f;
      ppg_previous_ac = 0.0f;
      ppg_cycle_min = 0.0f;
      ppg_cycle_max = 0.0f;
      bpm_valid = false;
      hrv_valid = false;
      spo2_valid = false;
      if (scan_start_ms == 0) {
        cardiac_locked = false;
      }
      spo2_sample_count = 0;
      spo2_decimation_count = 0;
      spo2_ir_sum = 0;
      spo2_red_sum = 0;
      if (power_state == STATE_TRANSMITTING_ACTIVE) {
        broadcast_telemetry();
      }
    }

    // Descartar los primeros 400 ms tras el contacto para estabilización óptica de AGC
    if (now_us - ppg_finger_start_us < 400000ULL) {
      ppg_ir_dc = (ppg_ir_dc * 0.95f) + ((float)raw_ir * 0.05f);
      continue;
    }

    // 2. Acumulación y Decimación para Algoritmo Maxim SpO2 (100 Hz -> 25 Hz)
    // Reject ADC clipping / absent red data rather than interpreting it as oxygen.
    bool optical_sample_ok = raw_red > 0 && raw_ir < 262000 && raw_red < 262000;
    if (!optical_sample_ok) {
      invalidate_spo2("optical_clipping", true);
      continue;
    }
    spo2_ir_sum += raw_ir;
    spo2_red_sum += raw_red;
    spo2_decimation_count++;
    if (spo2_decimation_count >= 4) {
      uint32_t avg_ir = spo2_ir_sum / 4;
      uint32_t avg_red = spo2_red_sum / 4;
      spo2_ir_sum = 0;
      spo2_red_sum = 0;
      spo2_decimation_count = 0;

      if (spo2_sample_count < BUFFER_SIZE) {
        spo2_ir[spo2_sample_count] = avg_ir;
        spo2_red[spo2_sample_count] = avg_red;
        spo2_sample_count++;
      } else {
        // Ventana deslizante limpia a 25 Hz (desplaza 1 muestra a la izquierda y anade la nueva)
        for (int i = 1; i < BUFFER_SIZE; i++) {
          spo2_ir[i - 1] = spo2_ir[i];
          spo2_red[i - 1] = spo2_red[i];
        }
        spo2_ir[BUFFER_SIZE - 1] = avg_ir;
        spo2_red[BUFFER_SIZE - 1] = avg_red;
      }
    }
    // 3. Filtro IIR DC y Separacion AC para Deteccion de Onda de Pulso
    // Constante de tiempo ~0.5s a 100 Hz
    ppg_ir_dc = (ppg_ir_dc * 0.985f) + ((float)raw_ir * 0.015f);
    float current_ac = (float)raw_ir - ppg_ir_dc;

    // Inversion fotopletismografica (pulso volumetrico arterial)
    float ppg_pulse = -current_ac;

    if (ppg_pulse > ppg_cycle_max) ppg_cycle_max = ppg_pulse;
    if (ppg_pulse < ppg_cycle_min) ppg_cycle_min = ppg_pulse;

    // Deteccion de pendiente sistolica ascendente con umbral adaptativo
    float p2p = ppg_cycle_max - ppg_cycle_min;
    float threshold = ppg_cycle_min + (p2p * 0.55f);

    // Deteccion optica dual: Algoritmo Maxim PBA (FIR) con respaldo de pendiente adaptativa
    bool raw_beat = checkForBeat((int32_t)raw_ir);
    if (!raw_beat && p2p > 25.0f && ppg_pulse > threshold && ppg_previous_ac <= threshold) {
      raw_beat = true;
    }

    // Periodo refractario fisiologico adaptativo anti-dicroto:
    // Bloquea cualquier segundo pico que ocurra a < 60% del ciclo cardiaco previo (o < 440ms)
    uint64_t min_refractory_us = 440000ULL; // 440 ms minimo absoluto (~136 BPM)
    if (ppg_interval_count >= 2 && last_good_interval_us > 0) {
      uint64_t dynamic_refract = (uint64_t)(last_good_interval_us * 0.60f);
      if (dynamic_refract > min_refractory_us) {
        min_refractory_us = (dynamic_refract > 720000ULL) ? 720000ULL : dynamic_refract;
      }
    }

    bool beat_detected = false;
    if (raw_beat) {
      if (ppg_last_beat_us == 0 || (now_us - ppg_last_beat_us >= min_refractory_us)) {
        beat_detected = true;
      }
    }

    if (beat_detected) {
      if (ppg_last_beat_us > 0) {
        uint64_t interval_us = now_us - ppg_last_beat_us;
        // Rango fisiologico estricto: 375 ms (160 BPM) a 1500 ms (40 BPM)
        if (interval_us >= 375000ULL && interval_us <= 1500000ULL) {
          ppg_intervals_us[ppg_interval_write] = (uint32_t)interval_us;
          ppg_interval_end_us[ppg_interval_write] = now_us;
          ppg_interval_write = (ppg_interval_write + 1) % PRV_INTERVAL_CAPACITY;
          if (ppg_interval_count < PRV_INTERVAL_CAPACITY) {
            ppg_interval_count++;
          }

          // Destello de latido fisico
          beat_detected_flash = true;
          beat_flash_start = now_ms;

          // Requiere al menos 2 intervalos fisiologicos consecutivos para confirmar validez
          if (ppg_interval_count >= 2) {
            bpm_valid = true;
            if (!cardiac_locked) {
              cardiac_locked = true;
              scan_start_ms = now_ms; // Inicia exactamente aqui el conteo de los 20 segundos clinicos
              Serial.println(F("\r\n========================================================================="));
              Serial.printf("  >>> [PULSO CARDIACO FIJADO: %d BPM] INICIANDO 20s DE MEDICION CLINICA <<<\r\n", beat_avg);
              Serial.println(F("=========================================================================\r\n"));

              // Destello breve en LED 3 para confirmar enganche de pulso
              strip.setPixelColor(3, strip.Color(255, 255, 255));
              strip.show();
            }

            // Calculo robusto de BPM con Media Recortada (Trimmed Mean / Interquartile)
            // Utiliza hasta los ultimos 8 intervalos validos
            uint16_t n_calc = (ppg_interval_count > 8) ? 8 : ppg_interval_count;
            uint32_t sort_buf[8];
            for (uint16_t k = 0; k < n_calc; k++) {
              int idx = (ppg_interval_write - 1 - k + PRV_INTERVAL_CAPACITY) % PRV_INTERVAL_CAPACITY;
              sort_buf[k] = ppg_intervals_us[idx];
            }

            // Ordenamiento por insercion
            for (uint16_t i = 1; i < n_calc; i++) {
              uint32_t key = sort_buf[i];
              int j = (int)i - 1;
              while (j >= 0 && sort_buf[j] > key) {
                sort_buf[j + 1] = sort_buf[j];
                j--;
              }
              sort_buf[j + 1] = key;
            }

            uint32_t robust_interval_us = 0;
            if (n_calc >= 5) {
              // Descartar el menor y el mayor valor para inmunidad total a ruido y espurias
              uint64_t sum_middle = 0;
              for (uint16_t m = 1; m < n_calc - 1; m++) {
                sum_middle += sort_buf[m];
              }
              robust_interval_us = (uint32_t)(sum_middle / (n_calc - 2));
            } else {
              // Con pocos intervalos tomar la mediana directa
              robust_interval_us = sort_buf[n_calc / 2];
            }

            if (robust_interval_us > 0) {
              last_good_interval_us = robust_interval_us;
              int instant_bpm = (int)round(60000000.0 / (double)robust_interval_us);
              // Rango fisiologico estricto
              if (instant_bpm >= 45 && instant_bpm <= 160) {
                if (beat_avg == 0) {
                  beat_avg = instant_bpm;
                } else {
                  // Filtro exponencial IIR clinico: 70% historico + 30% medicion nueva
                  beat_avg = (int)round((beat_avg * 0.70f) + (instant_bpm * 0.30f));
                }
              }
            }
          }

          // Calculo de PRV Real mediante RMSSD sobre el buffer de intervalos opticos
          if (ppg_interval_count >= 4) {
            double sum_sq_diff = 0.0;
            int pairs = 0;
            for (uint16_t i = 1; i < ppg_interval_count; i++) {
              int idx_curr = (ppg_interval_write - i + PRV_INTERVAL_CAPACITY) % PRV_INTERVAL_CAPACITY;
              int idx_prev = (ppg_interval_write - i - 1 + PRV_INTERVAL_CAPACITY) % PRV_INTERVAL_CAPACITY;
              double diff_ms = ((double)ppg_intervals_us[idx_curr] - (double)ppg_intervals_us[idx_prev]) / 1000.0;
              sum_sq_diff += diff_ms * diff_ms;
              pairs++;
            }
            if (pairs > 0) {
              double rmssd = sqrt(sum_sq_diff / pairs);
              hrv_ms = (int)round(rmssd);
              if (hrv_ms > 0 && hrv_ms < 250) {
                hrv_valid = true;
                if (hrv_ms >= 45) {
                  stress_score = 25; // Alta variabilidad (Relajado)
                } else if (hrv_ms >= 25) {
                  stress_score = 50; // Variabilidad moderada
                } else {
                  stress_score = 75; // Baja variabilidad (Estres simpatico)
                }
              } else {
                hrv_valid = false;
                hrv_ms = 0;
                stress_score = 0;
              }
            }
          }

          ppg_cycle_max = ppg_pulse;
          ppg_cycle_min = ppg_pulse;
        } else if (interval_us > 1500000ULL) {
          // Pausa larga (>1.5s): reiniciar sincronizacion sin falsear BPM
          bpm_valid = false;
          ppg_cycle_max = ppg_pulse;
          ppg_cycle_min = ppg_pulse;
        }
      }
      ppg_last_beat_us = now_us;
    }

    ppg_previous_ac = ppg_pulse;

    // Decaimiento del umbral pico a pico
    ppg_cycle_max *= 0.999f;
    ppg_cycle_min *= 0.999f;
  }

  // Timeout si el dedo esta puesto pero no se detecta latido por mas de 3.5s
  if (finger_detected && ppg_last_beat_us > 0 && (now_us - ppg_last_beat_us > 3500000ULL)) {
    bpm_valid = false;
    hrv_valid = false;
    beat_avg = 0;
    hrv_ms = 0;
    stress_score = 0;
  }

  // 4. Ejecucion periodica del algoritmo Maxim para SpO2 cuando el buffer de 100 muestras esta listo
  if (finger_detected && now_ms - ppg_last_data_ms <= 250 && spo2_sample_count >= BUFFER_SIZE && (now_ms - spo2_last_result_ms >= 1000)) {
    spo2_last_result_ms = now_ms;
    int32_t n_spo2 = 0;
    int8_t ch_spo2_valid = 0;
    int32_t n_heart_rate = 0;
    int8_t ch_hr_valid = 0;

    // Algoritmo de referencia SparkFun/Maxim; no hay calibracion del montaje.
    maxim_heart_rate_and_oxygen_saturation(spo2_ir, BUFFER_SIZE, spo2_red,
      &n_spo2, &ch_spo2_valid, &n_heart_rate, &ch_hr_valid);
    // No presentar una estimacion sin calibrar como una saturacion valida.
    invalidate_spo2("uncalibrated", false);
    uint32_t min_ir = UINT32_MAX, max_ir = 0, min_red = UINT32_MAX, max_red = 0;
    uint64_t sum_ir = 0, sum_red = 0;
    for (int i = 0; i < BUFFER_SIZE; i++) {
      sum_ir += spo2_ir[i]; sum_red += spo2_red[i];
      min_ir = min(min_ir, spo2_ir[i]); max_ir = max(max_ir, spo2_ir[i]);
      min_red = min(min_red, spo2_red[i]); max_red = max(max_red, spo2_red[i]);
    }
    Serial.printf("[SPO2] algorithm:%ld valid:%d pulse_ref:%ld pulse_valid:%d status:%s IR_dc:%lu IR_pp:%lu RED_dc:%lu RED_pp:%lu fifo_lost:%lu i2c_errors:%lu\r\n",
                  (long)n_spo2, ch_spo2_valid, (long)n_heart_rate, ch_hr_valid, spo2_status,
                  (unsigned long)(sum_ir / BUFFER_SIZE), (unsigned long)(max_ir - min_ir),
                  (unsigned long)(sum_red / BUFFER_SIZE), (unsigned long)(max_red - min_red),
                  (unsigned long)ppg_fifo_dropped, (unsigned long)ppg_i2c_errors);

  }
  if (spo2_valid && (!finger_detected || now_ms - ppg_last_data_ms > 250 || now_ms - spo2_last_valid_ms > 2000))
    invalidate_spo2("stale", false);

  // 5. Lectura de temperatura del silicio del chip MAX30102 (cada 4 segundos)
  // Start die-temperature conversion without blocking optical FIFO acquisition.
  if (!chip_temp_pending && now_ms - chip_temp_last_read_ms >= 4000) {
    chip_temp_last_read_ms = now_ms;
    Wire.beginTransmission(0x57);
    Wire.write(0x21); Wire.write(0x01);
    chip_temp_pending = Wire.endTransmission() == 0;
    chip_temp_start_ms = now_ms;
  }
  if (chip_temp_pending && now_ms - chip_temp_start_ms >= 35) {
    uint8_t config = 1, raw_temp[2] = {};
    bool ready = max_read_register(0x21, &config, 1) && (config & 1) == 0;
    if (!ready && now_ms - chip_temp_start_ms < 100) return;
    bool read_ok = ready && max_read_register(0x1F, raw_temp, 2);
    chip_temp_pending = false;
    float temp_c = (int8_t)raw_temp[0] + raw_temp[1] * 0.0625f;
    if (read_ok && temp_c >= 15.0f && temp_c <= 60.0f) {
      chip_temp = temp_c;
      chip_temp_valid = true;
      body_temp = chip_temp; // Informado con chip_temp_valid
    } else {
      chip_temp_valid = false;
      chip_temp = 0.0f;
      body_temp = 0.0f;
    }
  }

  // Presión arterial NO es medida clínicamente por el MAX30102
  systolic_bp = 0;
  diastolic_bp = 0;

  // Apagar destello de latido tras 250 ms
  if (beat_detected_flash && (now_ms - beat_flash_start > 250)) {
    beat_detected_flash = false;
  }
}

// ------------------------------------------------------------------------------
// 8. GESTION ENERGETICA Y CONTROL DESDE LA APP
// ------------------------------------------------------------------------------
void activate_transmission() {
  power_state = STATE_TRANSMITTING_ACTIVE;
  active_window_start_ms = millis();

  // NOTA: No despertar sensores ciegamente aqui; cada modo activa exclusivamente su sensor correspondiente.
  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  >>> [SPIROSCAN ACTIVADO] Transmision activa de telemetria.          <<<"));
  Serial.println(F("=========================================================================\r\n"));
}

void enter_standby() {
  power_state = STATE_STANDBY_SAVER;
  active_scan_mode = SCAN_NONE;
  cardiac_locked = false;
  standby_start_ms = millis();

  // 1. Apagar el sensor MAX30102 (apaga físicamente los LEDs Rojo e IR en el hardware)
  if (sensor_hw_found) {
    particleSensor.shutDown();
  }

  // 2. Limpiar y apagar variables biomédicas y acústicas
  reset_biometric_state(true);
  audio_rms = 0.0f;
  audio_peak = 0.0f;
  audio_valid = false;

  // 3. Mantener encendidos solo LED 0 (Power - Verde) y LED 1 (Bluetooth - Azul); LEDs 2 a 7 apagados
  uint32_t led0_color = sensor_hw_found ? strip.Color(0, 230, 60) : strip.Color(240, 90, 0);
  strip.setPixelColor(0, led0_color);
  uint32_t led1_color = ble_connected ? strip.Color(0, 120, 255) : strip.Color(0, 80, 255);
  strip.setPixelColor(1, led1_color);
  for (int i = 2; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 0, 0));
  }
  strip.show();

  // 4. Asegurar que el LED azul onboard permanezca apagado
  digitalWrite(ONBOARD_LED_PIN, LOW);

  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  >>> [MODO REPOSO - EN ESPERA] Sensores en reposo, LEDs 0 y 1 activos.<<<"));
  Serial.println(F("  >>> Sensor cardiaco MAX30102 apagado (LEDs rojo/IR apagados).        <<<"));
  Serial.println(F("  >>> Microfono I2S en reposo.                                         <<<"));
  Serial.println(F("  >>> Selecciona una medicion desde la app; diagnostico por USB.                 <<<"));
  Serial.println(F("  >>> WAKE o SCAN_CONT activa la adquisicion continua.     <<<"));
  Serial.println(F("=========================================================================\r\n"));

  broadcast_telemetry();
}

void start_cardiac_scan() {
  active_scan_mode = SCAN_CARDIAC;
  cardiac_locked = false;
  cardiac_wait_start_ms = millis();
  scan_start_ms = 0; // Conteo regresivo de 20s empezara solo tras calibrar y fijar pulso

  reset_biometric_state(true);

  // 1. Activar estrictamente el sensor optico MAX30102
  if (sensor_hw_found) {
    particleSensor.wakeUp();
    particleSensor.clearFIFO();
  }

  // 2. Silenciar y aislar completamente el microfono I2S
  audio_rms = 0.0f;
  audio_peak = 0.0f;
  audio_valid = false;

  activate_transmission();

  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  >>> [APP/COMANDO] INICIANDO CHEQUEO CARDIACO                     <<<"));
  Serial.println(F("  >>> Fase 1: Calibracion inicial y deteccion de pulso (coloque dedo).<<<"));
  Serial.println(F("  >>> Fase 2: Conteo clinico de 20s iniciara al fijar pulso (LPM > 0).<<<"));
  Serial.println(F("  >>> Microfono I2S completamente desactivado y aislado.              <<<"));
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
  cardiac_locked = false;

  // 1. Apagar FISICAMENTE el sensor optico MAX30102 (apaga sus LEDs Rojo e IR en la placa)
  if (sensor_hw_found) {
    particleSensor.shutDown();
  }

  // 2. Poner a cero y aislar todas las variables cardiacas
  reset_biometric_state(true);

  activate_transmission();

  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  >>> [APP/COMANDO] INICIANDO AUSCULTACION PULMONAR (20 SEGUNDOS)  <<<"));
  Serial.println(F("  >>> Analisis bio-acustico INMP441 activo.                          <<<"));
  Serial.println(F("  >>> Sensor optico MAX30102 apagado fisicamente (LEDs rojo/IR OFF). <<<"));
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
  cardiac_locked = false;

  reset_biometric_state(true);

  // En Modo Continuo / Infinito se activan AMBOS sensores simultaneamente en vivo
  if (sensor_hw_found) {
    particleSensor.wakeUp();
    particleSensor.clearFIFO();
  }

  activate_transmission();

  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  >>> [INICIO/APP] MODO INFINITO / TIEMPO REAL ACTIVADO   <<<"));
  Serial.println(F("  >>> Monitoreo continuo 100% en vivo (Microfono + MAX30102 juntos).  <<<"));
  Serial.println(F("  >>> Para apagar todo: envia 'OFF' / 'SLEEP' por comando.<<<"));
  Serial.println(F("=========================================================================\r\n"));

  // Destello rápido Blanco Puro / Clínico en todos los LEDs indicando Modo Infinito
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(255, 255, 255));
  }
  strip.show();
  delay(150);
}

void toggle_continuous_mode() {
  if (active_scan_mode == SCAN_CONTINUOUS) {
    // Si ya estaba en Modo Infinito, el comando alterna a reposo y entra a reposo
    Serial.println(F("\r\n[*] APP/COMANDO: Modo Infinito ya activo -> APAGANDO TODO (Reposo)..."));
    enter_standby();
  } else {
    // Si estaba en reposo, o en un escaneo acotado (cardiaco o pulmonar): ACTIVAR MODO INFINITO
    Serial.println(F("\r\n[*] APP/COMANDO: ACTIVANDO MODO INFINITO / TIEMPO REAL CONTINUO..."));
    start_continuous_mode();
  }
}

void update_scan_status() {
  unsigned long now = millis();

  if (active_scan_mode == SCAN_CARDIAC) {
    if (!cardiac_locked) {
      // FASE 1: Calibracion fisiologica y deteccion del primer pulso valido
      if (finger_detected && bpm_valid && beat_avg > 0) {
        cardiac_locked = true;
        scan_start_ms = now; // Inicia aqui el conteo de los 20 segundos reales
        Serial.println(F("\r\n========================================================================="));
        Serial.printf("  >>> [PULSO CARDIACO FIJADO: %d BPM] INICIANDO 20s DE MEDICION CLINICA <<<\r\n", beat_avg);
        Serial.println(F("=========================================================================\r\n"));

        // Destello breve en LED 3 para confirmar enganche de pulso
        strip.setPixelColor(3, strip.Color(255, 255, 255));
        strip.show();
      } else {
        // Timeout: Si pasan 35 segundos sin colocar el dedo / fijar pulso, volver a reposo
        if (now - cardiac_wait_start_ms >= 35000) {
          Serial.println(F("\r\n[ESCANEO CARDIACO] Tiempo de espera agotado sin deteccion de pulso. Volviendo a reposo..."));
          enter_standby();
          return;
        }
      }
    } else {
      // FASE 2: Conteo regresivo clinico de 20 segundos tras calibrar pulso
      // Salvaguarda: garantizar que scan_start_ms este fijado
      if (scan_start_ms == 0) {
        scan_start_ms = now;
      }
      static unsigned long finger_lost_start = 0;
      if (!finger_detected) {
        if (finger_lost_start == 0) finger_lost_start = now;
        if (now - finger_lost_start > 5000) {
          Serial.println(F("\r\n[ESCANEO CARDIACO] Dedo retirado por mas de 5s. Cancelando chequeo y apagando sensor..."));
          finger_lost_start = 0;
          enter_standby();
          return;
        }
      } else {
        finger_lost_start = 0;
      }

      unsigned long elapsed = now - scan_start_ms;
      if (elapsed >= SCAN_DURATION_MS) {
        finger_lost_start = 0;
        Serial.println(F("\r\n========================================================================="));
        Serial.printf("  >>> [FIN DE CHEQUEO CARDIACO] Protocolo 20s completado: %d BPM | SpO2: %.1f%% <<<\r\n", beat_avg, spo2_val);
        Serial.println(F("=========================================================================\r\n"));

        // 1. Marcar escaneo terminado para que el paquete final envíe scan_mode: "none"
        active_scan_mode = SCAN_NONE;
        cardiac_locked = false;

        // 2. Emitir paquete final consolidado con scan_mode: none
        broadcast_telemetry();
        delay(80);
        broadcast_telemetry();

        // Destello clinico verde en los 8 LEDs indicando finalizacion exitosa
        for (int i = 0; i < NUM_LEDS; i++) {
          strip.setPixelColor(i, strip.Color(0, 255, 60));
        }
        strip.show();
        delay(250);

        // 3. APAGADO INSTANTANEO: Apaga el sensor MAX30102 y LEDs 2-7 de inmediato
        enter_standby();
        broadcast_telemetry();
      }
    }
  } else if (active_scan_mode == SCAN_PULMONARY) {
    // Auscultacion pulmonar de 20 segundos
    unsigned long elapsed = now - scan_start_ms;
    if (elapsed >= SCAN_DURATION_MS) {
      Serial.println(F("\r\n========================================================================="));
      Serial.printf("  >>> [FIN DE AUSCULTACION PULMONAR] Protocolo 20s completado: Audio RMS %.1f dB <<<\r\n", audio_rms);
      Serial.println(F("=========================================================================\r\n"));

      active_scan_mode = SCAN_NONE;
      broadcast_telemetry();
      delay(80);
      broadcast_telemetry();

      for (int i = 0; i < NUM_LEDS; i++) {
        strip.setPixelColor(i, strip.Color(0, 255, 60));
      }
      strip.show();
      delay(250);

      // APAGADO INSTANTANEO: Apaga microfono y pasa de inmediato a reposo
      enter_standby();
      broadcast_telemetry();
    }
  }
}

// Diagnostic acquisition runs exclusively in loop(), never in a BLE callback.
bool optical_probe_set_currents(uint8_t red, uint8_t ir) {
  Wire.beginTransmission(0x57);
  Wire.write(0x0C); Wire.write(red);
  if (Wire.endTransmission() != 0) return false;
  Wire.beginTransmission(0x57);
  Wire.write(0x0D); Wire.write(ir);
  if (Wire.endTransmission() != 0) return false;
  uint8_t actual[2] = {};
  return max_read_register(0x0C, actual, 2) && actual[0] == red && actual[1] == ir;
}

void optical_probe_clear_samples() {
  while (particleSensor.available()) particleSensor.nextSample();
  particleSensor.clearFIFO();
}

bool optical_probe_phase(const char* name, uint8_t red_current, uint8_t ir_current) {
  if (!optical_probe_set_currents(red_current, ir_current)) {
    Serial.printf("[OPTICAL ERROR] phase:%s reason:current_write_failed\r\n", name);
    return false;
  }
  delay(200); // Discard averaging/settling data, not part of the capture.
  optical_probe_clear_samples();
  uint32_t red[100] = {}, ir[100] = {};
  uint16_t count = 0, errors = 0;
  unsigned long start = millis();
  while (count < 100 && millis() - start < 2200) {
    uint16_t fetched = particleSensor.check();
    if (fetched > 31) {
      ++errors;
      optical_probe_clear_samples();
      break; // A window spanning an acquisition failure is not usable.
    }
    while (particleSensor.available() && count < 100) {
      red[count] = particleSensor.getFIFORed();
      ir[count] = particleSensor.getFIFOIR();
      particleSensor.nextSample();
      ++count;
    }
    delay(2);
  }
  uint64_t red_sum = 0, ir_sum = 0;
  uint32_t red_min = UINT32_MAX, red_max = 0, ir_min = UINT32_MAX, ir_max = 0;
  for (uint16_t i = 0; i < count; ++i) {
    red_sum += red[i]; ir_sum += ir[i];
    red_min = min(red_min, red[i]); red_max = max(red_max, red[i]);
    ir_min = min(ir_min, ir[i]); ir_max = max(ir_max, ir[i]);
  }
  Serial.printf("[OPTICAL PHASE] {\"phase\":\"%s\",\"red_pa\":%u,\"ir_pa\":%u,\"count\":%u,\"errors\":%u,\"elapsed_ms\":%lu,\"red_dc\":%.1f,\"ir_dc\":%.1f,\"red_pp\":%lu,\"ir_pp\":%lu,\"red\":[",
                name, red_current, ir_current, count, errors, millis() - start,
                count ? double(red_sum) / count : 0, count ? double(ir_sum) / count : 0,
                count ? (unsigned long)(red_max - red_min) : 0,
                count ? (unsigned long)(ir_max - ir_min) : 0);
  for (uint16_t i = 0; i < count; ++i) Serial.printf("%s%lu", i ? "," : "", (unsigned long)red[i]);
  Serial.print("],\"ir\":[");
  for (uint16_t i = 0; i < count; ++i) Serial.printf("%s%lu", i ? "," : "", (unsigned long)ir[i]);
  Serial.println("]}");
  return count == 100 && errors == 0;
}

void run_optical_emitter_probe() {
  if (!sensor_hw_found || power_state != STATE_TRANSMITTING_ACTIVE) {
    Serial.println(F("[OPTICAL ERROR] reason:sensor_not_active; activate CONT first"));
    return;
  }
  const uint8_t addresses[] = {0x08, 0x09, 0x0A, 0x0C, 0x0D};
  uint8_t saved[5] = {};
  for (uint8_t i = 0; i < 5; ++i) {
    if (!max_read_register(addresses[i], saved + i, 1)) {
      Serial.println(F("[OPTICAL ERROR] reason:cannot_save_configuration"));
      return; // Nothing changed.
    }
  }
  if ((saved[1] & 7) != 3 || saved[3] == 0 || saved[4] == 0) {
    Serial.println(F("[OPTICAL ERROR] reason:expected_active_red_ir_mode"));
    return;
  }
  optical_probe_running = true;
  reset_biometric_state(true);
  broadcast_telemetry(); // Measurements invalid during emitter isolation.
  Serial.printf("[OPTICAL START] firmware:%s fifo:%02X mode:%02X adc:%02X red:%02X ir:%02X\r\n",
                FIRMWARE_ID, saved[0], saved[1], saved[2], saved[3], saved[4]);
  bool complete = optical_probe_phase("both_before", saved[3], saved[4]) &&
    optical_probe_phase("dark", 0, 0) &&
    optical_probe_phase("red_only", saved[3], 0) &&
    optical_probe_phase("ir_only", 0, saved[4]);

  // Always restore after a started probe, including a failed phase.
  bool restored = false;
  for (int attempt = 0; attempt < 3 && !restored; ++attempt) {
    restored = optical_probe_set_currents(saved[3], saved[4]);
    if (!restored) delay(10);
  }
  if (restored && complete)
    complete = optical_probe_phase("both_after", saved[3], saved[4]);
  bool configuration_ok = restored;
  for (uint8_t i = 0; i < 5; ++i) {
    uint8_t actual = 0;
    if (!max_read_register(addresses[i], &actual, 1) || actual != saved[i]) configuration_ok = false;
  }
  reset_biometric_state(true);
  optical_probe_clear_samples();
  optical_probe_running = false;
  Serial.printf("[OPTICAL END] complete:%d restored:%d configuration_unchanged:%d\r\n", complete, restored, configuration_ok);
}

// ------------------------------------------------------------------------------
// 9. PROCESADOR DE COMANDOS ENTRANTE (BLUETOOTH & SERIAL USB)
// ------------------------------------------------------------------------------
void handle_incoming_commands(String raw_cmd) {
  raw_cmd.trim();
  if (raw_cmd.startsWith("REC_") || raw_cmd.startsWith("rec_")) {
    ausc_queue_recording_id(raw_cmd.substring(4)); return;
  }
  raw_cmd.toUpperCase();

  // Limpieza estricta de caracteres de control o basura de trama
  String cmd = "";
  for (unsigned int i = 0; i < raw_cmd.length(); i++) {
    char c = raw_cmd.charAt(i);
    if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
      cmd += c;
    }
  }

  Serial.printf("[COMANDO RX] Procesando: \"%s\" (len: %d)\r\n", cmd.c_str(), cmd.length());

  if (optical_probe_running) {
    Serial.println(F("[OPTICAL] probe in progress; wait for restoration"));
    return;
  }

  if (cmd == "REC" || cmd == "GRABAR") {
    recording_requested = true; // El HTTP se ejecuta en loop, no en el callback BLE.
    return;
  }
  if (cmd.startsWith("REC_")) {
    ausc_queue_recording_id(cmd.substring(4));
    return;
  }
  if (ausc_busy() && cmd != "STATUS" && cmd != "INFO") {
    Serial.println(F("[AUSC] Grabacion en curso; espera el resultado antes de iniciar otro modo."));
    return;
  }
  if (cmd == "OPTICAL") {
    optical_probe_requested = true;
    Serial.println(F("[OPTICAL] queued for main loop"));
  } else if (cmd == "BAUD") {
    Serial.printf("[BAUD] current:%lu default:115200\r\n", (unsigned long)Serial.baudRate());
  } else if (cmd.startsWith("BAUD_")) {
    // Temporary diagnostic only: boot always retains main's 115200 setting.
    uint32_t target = cmd == "BAUD_57600" ? 57600 :
      cmd == "BAUD_115200" ? 115200 :
      cmd == "BAUD_230400" ? 230400 :
      cmd == "BAUD_460800" ? 460800 : 0;
    if (!target) {
      Serial.println(F("[BAUD] allowed:57600,115200,230400,460800"));
      return;
    }
    Serial.printf("[BAUD SWITCH] from:%lu target:%lu\r\n", (unsigned long)Serial.baudRate(), (unsigned long)target);
    Serial.flush(true);
    Serial.updateBaudRate(target);
    Serial.printf("[BAUD] current:%lu default:115200\r\n", (unsigned long)Serial.baudRate());
  } else if (cmd == "SPO2") {
    Serial.printf("[SPO2 CONFIG] firmware:%s adc:400Hz average:4 fifo:100Hz algorithm:25Hz window:%u/100 status:%s valid:%d age_ms:%lu fifo_lost:%lu samples:%lu max_batch:%u i2c_errors:%lu raw_red:%lu raw_ir:%lu calibration:false\r\n",
                  FIRMWARE_ID, spo2_sample_count, spo2_status, spo2_valid,
                  spo2_last_valid_ms ? millis() - spo2_last_valid_ms : 0, (unsigned long)ppg_fifo_dropped,
                  (unsigned long)ppg_samples_acquired, ppg_max_batch, (unsigned long)ppg_i2c_errors,
                  (unsigned long)ppg_last_raw_red, (unsigned long)ppg_last_raw_ir);
  } else if (cmd == "PPG") {
    // Snapshot for signal inspection; values are the acquired 25 Hz samples.
    Serial.printf("[PPG WINDOW] {\"rate_hz\":25,\"count\":%u,\"ir\":[", spo2_sample_count);
    for (int i = 0; i < spo2_sample_count; i++) Serial.printf("%s%lu", i ? "," : "", (unsigned long)spo2_ir[i]);
    Serial.print("],\"red\":[");
    for (int i = 0; i < spo2_sample_count; i++) Serial.printf("%s%lu", i ? "," : "", (unsigned long)spo2_red[i]);
    Serial.println("]}");
  } else if (cmd == "PPGREG") {
    const uint8_t addresses[] = {0x04, 0x05, 0x06, 0x08, 0x09, 0x0A, 0x0C, 0x0D, 0xFF};
    Serial.print("[PPG REG]");
    for (uint8_t address : addresses) {
      uint8_t value = 0;
      bool ok = max_read_register(address, &value, 1);
      Serial.printf(" %02X:%02X:%s", address, value, ok ? "ok" : "error");
    }
    Serial.println();
  } else if (cmd == "DIAG") {
    ausc_diag(sensor_hw_found, finger_detected, beat_avg, spo2_val);
  } else if (cmd.indexOf("WAKE") >= 0 || cmd == "W" || cmd == "ACTIVE" || cmd.indexOf("V0FLRQ") >= 0) {
    start_continuous_mode();
    broadcast_telemetry();
  } else if (cmd.indexOf("SCAN_CARD") >= 0 || cmd.indexOf("U0NBTl9DQVJE") >= 0 || cmd.indexOf("CARD") >= 0 || cmd.indexOf("HEART") >= 0 || cmd.indexOf("CORAZON") >= 0) {
    start_cardiac_scan();
    broadcast_telemetry();
  } else if (cmd.indexOf("SCAN_PULM") >= 0 || cmd.indexOf("U0NBTl9QVUxN") >= 0 || cmd.indexOf("PULM") >= 0 || cmd.indexOf("LUNG") >= 0 || cmd.indexOf("PULMON") >= 0) {
    start_pulmonary_scan();
    broadcast_telemetry();
  } else if (cmd.indexOf("SCAN_CONT") >= 0 || cmd.indexOf("U0NBTl9DT05U") >= 0 || cmd.indexOf("CONT") >= 0 || cmd.indexOf("LIVE") >= 0 || cmd.indexOf("INFINITE") >= 0 || cmd.indexOf("INFINITO") >= 0) {
    start_continuous_mode();
    broadcast_telemetry();
  } else if (cmd.indexOf("STOP") >= 0 || cmd.indexOf("U1RPUA") >= 0) {
    active_scan_mode = SCAN_NONE;
    Serial.println(F("[ESCANEO] Escaneo detenido manualmente por comando."));
    enter_standby();
    broadcast_telemetry();
  } else if (cmd.indexOf("OFF") >= 0 || cmd.indexOf("T0ZG") >= 0 || cmd.indexOf("SLEEP") >= 0 || cmd == "S" || cmd.indexOf("STANDBY") >= 0 || cmd.indexOf("APAGAR") >= 0) {
    enter_standby();
    broadcast_telemetry();
  } else if (cmd.indexOf("TOGGLE_CONT") >= 0) {
    toggle_continuous_mode();
    broadcast_telemetry();
  } else if (cmd == "MIC") {
    report_i2s_clocks();
  } else if (cmd == "MICSD") {
    report_i2s_sd();
  } else if (cmd.indexOf("STATUS") >= 0 || cmd.indexOf("INFO") >= 0) {
    const char* scan_str = (active_scan_mode == SCAN_CARDIAC) ? "cardiac" :
                           ((active_scan_mode == SCAN_PULMONARY) ? "pulmonary" :
                           ((active_scan_mode == SCAN_CONTINUOUS) ? "continuous" : "none"));
    char status_buf[512];
    snprintf(status_buf, sizeof(status_buf),
             "{\"device\":\"%s\",\"power\":\"%s\",\"ble_connected\":%s,\"sensor_hw\":%s,\"uptime_s\":%lu,\"scan_mode\":\"%s\"}\n",
             BLE_DEVICE_NAME, (power_state == STATE_TRANSMITTING_ACTIVE) ? "active" : "standby",
             ble_connected ? "true" : "false",
             sensor_hw_found ? "true" : "false", millis() / 1000,
             scan_str);
    if (ble_connected && pTelemetryCharacteristic) {
      pTelemetryCharacteristic->setValue((uint8_t*)status_buf, strlen(status_buf));
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
  const char* scan_phase = "none";
  int scan_remaining = 0;

  if (active_scan_mode == SCAN_CARDIAC) {
    scan_str = "cardiac";
    if (!cardiac_locked) {
      scan_phase = "calibrating";
      scan_remaining = 20; // 20s listos a la espera de fijar pulso
    } else {
      scan_phase = "measuring";
      unsigned long elapsed = millis() - scan_start_ms;
      scan_remaining = (elapsed < SCAN_DURATION_MS) ? ((SCAN_DURATION_MS - elapsed) / 1000) : 0;
    }
  } else if (active_scan_mode == SCAN_PULMONARY) {
    scan_str = "pulmonary";
    scan_phase = "measuring";
    unsigned long elapsed = millis() - scan_start_ms;
    scan_remaining = (elapsed < SCAN_DURATION_MS) ? ((SCAN_DURATION_MS - elapsed) / 1000) : 0;
  } else if (active_scan_mode == SCAN_CONTINUOUS) {
    scan_str = "continuous";
    scan_phase = "measuring";
    scan_remaining = (millis() - scan_start_ms) / 1000;
  }

  uint8_t valid_mask = 0;
  if (bpm_valid && beat_avg > 0) valid_mask |= 1;
  if (spo2_valid && spo2_val >= 70.0f) valid_mask |= 2;
  if (hrv_valid && hrv_ms >= 0) valid_mask |= 4;
  if (chip_temp_valid) valid_mask |= 8;
  if (audio_valid) valid_mask |= 16;

  uint32_t sample_age = ppg_last_data_ms ? millis() - ppg_last_data_ms : 86400000;
  const char* quality = !sensor_hw_found ? "sensor_unavailable" :
    !finger_detected ? "no_contact" : sample_age > 250 ? "stale" : bpm_valid ? "good" : "acquiring";
  if (sample_age > 250) valid_mask &= ~7;
  char json_payload[768];
  snprintf(json_payload, sizeof(json_payload),
           "{\"source\":\"real\",\"device_id\":\"ESP32-BIO-01\",\"heartRateValid\":%s,\"bloodOxygenValid\":false,\"spo2Calibrated\":false,\"signalQuality\":\"%s\",\"sampleAgeMs\":%lu,\"audioUnit\":\"dBFS\",\"audioValid\":%s,\"v\":2,\"valid\":%d,\"bpm\":%d,\"spo2\":%.1f,\"systolic\":0,\"diastolic\":0,\"temperature\":%.1f,\"chip_temp\":%.1f,\"stress\":%d,\"hrv\":%d,\"audio_rms\":%.1f,\"audio_peak\":%.6f,\"finger\":%s,\"scan_mode\":\"%s\",\"scan_sec\":%d,\"scan_phase\":\"%s\",\"cardiac_locked\":%s,\"power\":\"%s\",\"cal\":false,\"audio_unit\":\"dBFS\"}\n",
           (valid_mask & 1) ? "true" : "false", quality, (unsigned long)sample_age, audio_valid ? "true" : "false", valid_mask,
           bpm_valid ? beat_avg : 0,
           spo2_valid ? spo2_val : 0.0f,
           0.0f,
           chip_temp_valid ? chip_temp : 0.0f,
           stress_score,
           hrv_valid ? hrv_ms : 0,
           audio_rms, audio_peak,
           finger_detected ? "true" : "false",
           scan_str, scan_remaining, scan_phase,
           cardiac_locked ? "true" : "false",
           (power_state == STATE_TRANSMITTING_ACTIVE) ? "active" : "standby");

  // 1. Envio por BLE (Directo a Google Chrome / Edge y App Nativa Android APK)
  if (ble_connected && pTelemetryCharacteristic != NULL) {
    for (size_t offset = 0; offset < strlen(json_payload); offset += 20) {
      size_t size = min((size_t)20, strlen(json_payload) - offset);
      pTelemetryCharacteristic->setValue((uint8_t*)json_payload + offset, size);
      pTelemetryCharacteristic->notify();
      delay(1);
    }

    if (pHrCharacteristic != NULL) {
      uint8_t hr_packet[2] = { 0, (uint8_t)(bpm_valid ? beat_avg : 0) };
      pHrCharacteristic->setValue(hr_packet, 2);
      pHrCharacteristic->notify();
    }
  }

  // 2. Envio a Consola Serial USB (115200 baud)
  Serial.printf("[TELEMETRIA] FC:%d (v:%d) | SpO2:%.1f (v:%d) | PRV:%dms (v:%d) | TempChip:%.1fC | Audio:%.1fdB (v:%d) | Dedo:%s | Modo:%s (%ds)\r\n",
                bpm_valid ? beat_avg : 0, (valid_mask & 1) ? 1 : 0,
                spo2_valid ? spo2_val : 0.0f, (valid_mask & 2) ? 1 : 0,
                hrv_valid ? hrv_ms : 0, (valid_mask & 4) ? 1 : 0,
                chip_temp_valid ? chip_temp : 0.0f,
                audio_rms, (valid_mask & 16) ? 1 : 0,
                finger_detected ? "SI" : "NO", scan_str, scan_remaining);
  Serial.print(json_payload);
  ausc_send_telemetry(json_payload);
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
  if (ausc_update_leds(NUM_LEDS)) return;

  if (power_state == STATE_STANDBY_SAVER) {
    // LED 0: Power / Alimentación (Verde Esmeralda fijo)
    uint32_t led0_color = sensor_hw_found ? strip.Color(0, 230, 60) : strip.Color(240, 90, 0);
    strip.setPixelColor(0, led0_color);

    // LED 1: Bluetooth BLE (Azul Neón fijo si conectado; suave parpadeo cada 500ms en espera)
    uint32_t led1_color;
    if (ble_connected) {
      led1_color = strip.Color(0, 120, 255);
    } else {
      bool blink_on = (now / 500) % 2;
      led1_color = blink_on ? strip.Color(0, 80, 255) : strip.Color(0, 0, 0);
    }
    strip.setPixelColor(1, led1_color);

    // LEDs 2 al 7: Sensores médicos y acústica totalmente apagados en reposo
    for (int i = 2; i < NUM_LEDS; i++) {
      strip.setPixelColor(i, strip.Color(0, 0, 0));
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
  // Escala digital dBFS: conserva la respuesta equivalente del indicador anterior.
  static float smooth_audio_level = 0.0f;
  float target_level = 0.0f;

  if (audio_valid && audio_rms >= -58.0f) {
    // Umbrales visuales de -58 a -30 dBFS; no son niveles de presión sonora.
    float ratio = (audio_rms + 58.0f) / 28.0f;
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
    // Destello blanco al acercarse al extremo superior del indicador digital.
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

  // ============================================================================
  // AISLAMIENTO ESTRICTO DE LEDS SEGÚN MODO DE ESCANEO
  // ============================================================================
  if (active_scan_mode == SCAN_CARDIAC) {
    // 1. En chequeo cardíaco: El micrófono (LED 6) queda COMPLETAMENTE APAGADO
    strip.setPixelColor(6, strip.Color(0, 0, 0));

    // 2. Si aún está en fase de calibración inicial (!cardiac_locked):
    if (!cardiac_locked) {
      if (!finger_detected) {
        // Sin dedo aún: LED 2 apagado, LED 3 respirando en rubí suave invitando al usuario, LEDs 4, 5, 7 apagados
        strip.setPixelColor(2, strip.Color(0, 0, 0));
        float breath = 0.5f + 0.5f * sin((float)now / 200.0f);
        strip.setPixelColor(3, strip.Color((int)(110.0f * breath + 20.0f), 0, (int)(30.0f * breath)));
        strip.setPixelColor(4, strip.Color(0, 0, 0));
        strip.setPixelColor(5, strip.Color(0, 0, 0));
        strip.setPixelColor(7, strip.Color(0, 0, 0));
      } else {
        // Dedo colocado, estabilizando filtro DC y calculando primer pulso: LED 2 dorado, LED 3 respirando rubí/coral
        strip.setPixelColor(2, strip.Color(200, 130, 0));
        float breath = 0.5f + 0.5f * sin((float)now / 130.0f);
        strip.setPixelColor(3, strip.Color((int)(150.0f * breath + 30.0f), (int)(15.0f * breath), (int)(35.0f * breath)));
        strip.setPixelColor(4, strip.Color(0, (int)(45.0f * breath + 10.0f), (int)(35.0f * breath + 10.0f)));
        strip.setPixelColor(5, strip.Color((int)(45.0f * breath + 10.0f), 0, (int)(30.0f * breath + 10.0f)));
        strip.setPixelColor(7, strip.Color(0, (int)(35.0f * breath + 10.0f), (int)(20.0f * breath + 10.0f)));
      }
    }
  } else if (active_scan_mode == SCAN_PULMONARY) {
    // En auscultación pulmonar: Todos los LEDs biomédicos del sensor óptico (2, 3, 4, 5, 7) quedan TOTALMENTE APAGADOS
    strip.setPixelColor(2, strip.Color(0, 0, 0));
    strip.setPixelColor(3, strip.Color(0, 0, 0));
    strip.setPixelColor(4, strip.Color(0, 0, 0));
    strip.setPixelColor(5, strip.Color(0, 0, 0));
    strip.setPixelColor(7, strip.Color(0, 0, 0));
    // Únicamente LED 0 (Power), LED 1 (BLE) y LED 6 (Micrófono I2S) están activos
  }

  strip.show();
}


// Callbacks para recepcion de comandos BLE desde la App Movil (WAKE, SCAN_CARD, SCAN_PULM, SCAN_CONT, OFF)
class TelemetryCallbacks: public BLECharacteristicCallbacks {
public:
    void onWrite(BLECharacteristic *pCharacteristic) override {
      String cmd = String(pCharacteristic->getValue().c_str());
      if (cmd.length() == 0 && pCharacteristic->getLength() > 0) {
        cmd = String((char*)pCharacteristic->getData(), pCharacteristic->getLength());
      }
      process_incoming(cmd);
    }

    void onWrite(BLECharacteristic *pCharacteristic, esp_ble_gatts_cb_param_t *param) override {
      if (param != nullptr && param->write.len > 0) {
        String cmd = "";
        for (size_t i = 0; i < param->write.len; i++) {
          cmd += (char)param->write.value[i];
        }
        process_incoming(cmd);
      } else {
        onWrite(pCharacteristic);
      }
    }

private:
    void process_incoming(String cmd) {
      cmd.trim();
      Serial.printf("[BLE RX CALLBACK] Comando recibido: \"%s\" (len: %d)\r\n", cmd.c_str(), cmd.length());
      if (cmd.length() > 0) {
        char queued[128] = {};
        cmd.toCharArray(queued, sizeof(queued));
        if (incoming_commands) xQueueSend(incoming_commands, queued, 0);
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
      initial_telemetry_pending = true;
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
  Serial.setTxBufferSize(1024);
  Serial.begin(115200);
  Serial.printf("[FIRMWARE] %s\r\n", FIRMWARE_ID);
  delay(300);

  // Asegurar que el LED Azul interno de la placa permanezca apagado
  pinMode(ONBOARD_LED_PIN, OUTPUT);
  digitalWrite(ONBOARD_LED_PIN, LOW);

  Serial.println(F("\r\n========================================================================="));
  Serial.println(F("  FERIA TECNOLOGICA - SPIROSCAN AI (ESP32 BIO-ACUSTICO REAL)             "));
  Serial.println(F("  [MODO: TELEMETRIA 100% FISICA DE SENSORES - SIN SIMULACIONES]          "));
  Serial.println(F("========================================================================="));


  strip.begin();
  strip.setBrightness(30); // Nivel óptimo de visibilidad, nitidez y elegancia clínica
  // LED 0 (Power - Verde) y LED 1 (Bluetooth - Azul) activos desde el inicio
  strip.setPixelColor(0, strip.Color(0, 230, 60));
  strip.setPixelColor(1, strip.Color(0, 80, 255));
  for (int i = 2; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(0, 0, 0));
  }
  strip.show();

  incoming_commands = xQueueCreate(8, 128);

#if SPIROSCAN_ENABLE_BLE
  // Iniciar BLE (Bluetooth Low Energy / GATT Dual)
  Serial.printf("[*] Iniciando BLE: \"%s\"...\r\n", BLE_DEVICE_NAME);
  BLEDevice::init(BLE_DEVICE_NAME);
  BLEDevice::setMTU(517);

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

#else
  Serial.println("[OK] Modo WiFi/USB: memoria Bluetooth disponible para HTTPS y audio.");
#endif

  // Iniciar sensores fisicos reales
  setup_i2s();
  setup_max30102();
  report_i2s_clocks();
  report_i2s_sd();
  ausc_wifi_begin();

  Serial.println(F("[OK] Firmware inicializado con exito."));
  Serial.println(F("=========================================================================\r\n"));

  // Start acquisition immediately: the web must not depend on a physical button.
  start_continuous_mode();
}

void loop() {
  unsigned long current_millis = millis();
  char queued[128];
  if (incoming_commands && xQueueReceive(incoming_commands, queued, 0) == pdTRUE)
    handle_incoming_commands(String(queued));
  if (initial_telemetry_pending) { initial_telemetry_pending = false; broadcast_telemetry(); }

  // Control desde la app; los GPIO16/17 no se leen como botones.
  if (!ausc_busy()) {
    update_scan_status();
  }

  // 2. Comandos desde Consola Serial USB
  static char serial_command[128] = {};
  static size_t serial_length = 0;
  static bool serial_overflow = false;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      if (!serial_overflow && serial_length) {
        serial_command[serial_length] = '\0';
        handle_incoming_commands(String(serial_command));
      }
      serial_length = 0; serial_overflow = false;
    } else if (c != '\r' && !serial_overflow) {
      if (serial_length + 1 < sizeof(serial_command)) serial_command[serial_length++] = c;
      else serial_overflow = true;
    }
  }

  ausc_net_maintain();
  if (optical_probe_requested && !ausc_busy()) {
    optical_probe_requested = false;
    run_optical_emitter_probe();
  }
  if (!ausc_busy()) {
    String command_id = ausc_take_recording_command();
    if (recording_requested || command_id.length()) {
      recording_requested = false;
      enter_standby();
      if (!ausc_start(command_id)) start_continuous_mode();
    }
  }
  if (ausc_busy()) {
    // I2S pertenece a la grabacion; nunca reutilizar lecturas opticas anteriores.
    ausc_capture_step();
    if (!ausc_busy()) start_continuous_mode();
    update_led_effects();
    return;
  }

  // 3. Procesamiento de Senales Biologicas y Acusticas 100% Reales (Aislamiento Estricto por Modo)
  if (power_state == STATE_TRANSMITTING_ACTIVE) {
    if (active_scan_mode == SCAN_CARDIAC) {
      update_biometric_signals();
      audio_rms = 0.0f;
      audio_peak = 0.0f;
      audio_valid = false;
    } else if (active_scan_mode == SCAN_PULMONARY) {
      update_audio_rms();
      finger_detected = false;
      beat_avg = 0;
      spo2_val = 0.0f;
      systolic_bp = 0;
      diastolic_bp = 0;
      body_temp = 0.0f;
      stress_score = 0;
      hrv_ms = 0;
    } else if (active_scan_mode == SCAN_CONTINUOUS) {
      update_audio_rms();
      update_biometric_signals();
    } else {
      // Activo pero SCAN_NONE (ej. periodo de gracia de 30s para visualizar resultados)
      audio_rms = 0.0f;
      audio_peak = 0.0f;
      audio_valid = false;
    }
  } else {
    // En reposo: microfono y sensor cardiaco en silencio absoluto
    audio_rms = 0.0f;
    audio_peak = 0.0f;
    audio_valid = false;
  }

  // 4. Control de la ventana de transmision activa
  if (power_state == STATE_TRANSMITTING_ACTIVE) {
    if (active_scan_mode == SCAN_CONTINUOUS) {
      active_window_start_ms = current_millis; // Mantener vivo indefinidamente en modo continuo
    } else if (active_scan_mode != SCAN_NONE) {
      active_window_start_ms = current_millis; // Mantener vivo durante escaneos acotados (20s)
    } else {
      // Si no hay ningun escaneo activo, entrar a reposo de inmediato sin retrasos
      enter_standby();
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
    if ((ble_connected || ausc_wifi_ready()) && current_millis - previous_millis_telemetry >= 2500) {
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
