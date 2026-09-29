#include "wokwi-api.h"
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

#define MAX30102_I2C_ADDR 0x57

// Registers
#define REG_INT_STATUS_1   0x00
#define REG_INT_STATUS_2   0x01
#define REG_INT_ENABLE_1   0x02
#define REG_INT_ENABLE_2   0x03
#define REG_FIFO_WR_PTR    0x04
#define REG_OVF_COUNTER    0x05
#define REG_FIFO_RD_PTR    0x06
#define REG_FIFO_DATA      0x07
#define REG_FIFO_CONFIG    0x08
#define REG_MODE_CONFIG    0x09
#define REG_SPO2_CONFIG    0x0A
#define REG_LED1_PA        0x0C
#define REG_LED2_PA        0x0D
#define REG_MULTI_LED_1    0x11
#define REG_MULTI_LED_2    0x12
#define REG_TEMP_INTR      0x1F
#define REG_TEMP_FRAC      0x20
#define REG_TEMP_CONFIG    0x21
#define REG_REV_ID         0xFE
#define REG_PART_ID        0xFF

typedef struct {
  pin_t pin_int;
  uint8_t reg_addr;
  bool is_first_byte;
  uint8_t registers[256];
  uint32_t step;
} chip_state_t;

static bool on_i2c_connect(void *user_data, uint32_t address, bool read) {
  chip_state_t *chip = (chip_state_t *)user_data;
  chip->is_first_byte = true;
  return true; // ACK
}

static uint8_t on_i2c_read(void *user_data) {
  chip_state_t *chip = (chip_state_t *)user_data;
  
  if (chip->reg_addr == REG_FIFO_DATA) {
    // Generate realistic PPG waveform for Red and IR LEDs
    chip->step++;
    float t = (float)(chip->step % 50) / 50.0f * 2.0f * M_PI;
    // Heartbeat pulse wave simulation:
    float pulse = expf(-powf((float)(chip->step % 50 - 15) / 6.0f, 2.0f));
    
    uint32_t ir_val = (uint32_t)(50000.0f + pulse * 25000.0f + sinf(t) * 1000.0f);
    uint32_t red_val = (uint32_t)(48000.0f + pulse * 22000.0f + sinf(t) * 900.0f);
    
    // Output 6 bytes (3 bytes Red, 3 bytes IR)
    static uint8_t byte_idx = 0;
    uint8_t ret = 0;
    switch (byte_idx) {
      case 0: ret = (red_val >> 16) & 0x03; break;
      case 1: ret = (red_val >> 8) & 0xFF; break;
      case 2: ret = red_val & 0xFF; break;
      case 3: ret = (ir_val >> 16) & 0x03; break;
      case 4: ret = (ir_val >> 8) & 0xFF; break;
      case 5: ret = ir_val & 0xFF; break;
    }
    byte_idx = (byte_idx + 1) % 6;
    return ret;
  }
  
  uint8_t val = chip->registers[chip->reg_addr];
  chip->reg_addr++; // auto-increment
  return val;
}

static bool on_i2c_write(void *user_data, uint8_t data) {
  chip_state_t *chip = (chip_state_t *)user_data;
  if (chip->is_first_byte) {
    chip->reg_addr = data;
    chip->is_first_byte = false;
  } else {
    chip->registers[chip->reg_addr] = data;
    chip->reg_addr++;
  }
  return true; // ACK
}

static void on_i2c_disconnect(void *user_data) {
  // Transfer complete
}

void chip_init(void) {
  chip_state_t *chip = malloc(sizeof(chip_state_t));
  chip->pin_int = pin_init("INT", OUTPUT);
  pin_write(chip->pin_int, HIGH); // Active low, idle high
  
  // Set default registers
  for (int i = 0; i < 256; i++) chip->registers[i] = 0;
  chip->registers[REG_PART_ID] = 0x15; // MAX30102 Part ID
  chip->registers[REG_REV_ID] = 0x00;
  chip->reg_addr = 0;
  chip->is_first_byte = true;
  chip->step = 0;

  const i2c_config_t i2c_config = {
    .user_data = chip,
    .address = MAX30102_I2C_ADDR,
    .scl = pin_init("SCL", INPUT),
    .sda = pin_init("SDA", INPUT),
    .connect = on_i2c_connect,
    .read = on_i2c_read,
    .write = on_i2c_write,
    .disconnect = on_i2c_disconnect,
  };
  i2c_init(&i2c_config);
}
