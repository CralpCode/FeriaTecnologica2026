#include "wokwi-api.h"
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

typedef struct {
  pin_t pin_lr;
  pin_t pin_ws;
  pin_t pin_sck;
  pin_t pin_sd;
  pin_t pin_vdd;
  pin_t pin_gnd;
  
  uint32_t sample_index;
  int32_t current_sample;
  uint8_t bit_pos;
} chip_state_t;

static void on_sck_change(void *user_data, pin_t pin, uint32_t value) {
  chip_state_t *chip = (chip_state_t *)user_data;
  
  // On falling edge of SCK, output next bit
  if (value == LOW) {
    bool ws = pin_read(chip->pin_ws);
    bool lr = pin_read(chip->pin_lr); // LOW = Left, HIGH = Right
    
    // Check if it's our active channel (L/R tied to GND means left channel, WS=LOW)
    if (ws == lr) {
      bool bit = (chip->current_sample >> (23 - chip->bit_pos)) & 1;
      pin_write(chip->pin_sd, bit ? HIGH : LOW);
      chip->bit_pos++;
      if (chip->bit_pos >= 24) {
        chip->bit_pos = 0;
      }
    } else {
      pin_write(chip->pin_sd, LOW);
      chip->bit_pos = 0;
    }
  }
}

static void on_ws_change(void *user_data, pin_t pin, uint32_t value) {
  chip_state_t *chip = (chip_state_t *)user_data;
  chip->bit_pos = 0;
  
  // Generate a smooth simulated sine audio waveform (e.g. 440Hz / tone)
  chip->sample_index++;
  float phase = (float)(chip->sample_index % 100) / 100.0f * 2.0f * M_PI;
  chip->current_sample = (int32_t)(sinf(phase) * 500000.0f);
}

void chip_init(void) {
  chip_state_t *chip = malloc(sizeof(chip_state_t));
  chip->pin_lr  = pin_init("L/R", INPUT_PULLDOWN);
  chip->pin_ws  = pin_init("WS", INPUT);
  chip->pin_sck = pin_init("SCK", INPUT);
  chip->pin_sd  = pin_init("SD", OUTPUT);
  chip->pin_vdd = pin_init("VDD", INPUT_PULLUP);
  chip->pin_gnd = pin_init("GND", INPUT_PULLDOWN);

  chip->sample_index = 0;
  chip->current_sample = 0;
  chip->bit_pos = 0;

  const pin_watch_config_t sck_config = {
    .edge = BOTH,
    .pin_change = on_sck_change,
    .user_data = chip,
  };
  pin_watch(chip->pin_sck, &sck_config);

  const pin_watch_config_t ws_config = {
    .edge = BOTH,
    .pin_change = on_ws_change,
    .user_data = chip,
  };
  pin_watch(chip->pin_ws, &ws_config);
}
