#pragma once
#include <stdint.h>

// Engineering signal checks at the existing 25 Hz / 100 sample window.
// These checks do not establish the calibration of the optical assembly.
struct SpO2Signal {
  float ratio = 0;
  float pulse_bpm = 0;
  float ratio_mad_fraction = 0;
  float interval_cv = 0;
  float min_correlation = 0;
  uint8_t cycles = 0;
  bool quality_valid = false;
  const char* status = "insufficient_samples";
};

SpO2Signal spiroscan_analyze_spo2(const uint32_t* ir, const uint32_t* red, int count);
// Cross-check two AC/DC estimators on correlated cycles; does not convert RMS
// through the peak calibration table. Twenty percent is an engineering limit.
bool spiroscan_spo2_ratios_agree(float reference_ratio, float cycle_ratio);
