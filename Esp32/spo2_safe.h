#pragma once
#include <stdint.h>

// MAXREFDES117 reference calculation with 64-bit optical products.
void spiroscan_oxygen_saturation(uint32_t* ir, int32_t length, uint32_t* red,
    int32_t* spo2, int8_t* spo2_valid, int32_t* pulse, int8_t* pulse_valid);
// Exact ratio selected by the legacy peak/table calculation on its last call.
// Zero means no usable ratio was selected, not a physiological measurement.
float spiroscan_reference_ratio();
