#include <iostream>
#include <iomanip>
#include "spo2_signal.h"
#include "spo2_safe.h"

int main() {
  uint32_t ir[100], red[100];
  while (std::cin >> ir[0]) {
    for (int i = 1; i < 100; ++i) if (!(std::cin >> ir[i])) return 2;
    for (int i = 0; i < 100; ++i) if (!(std::cin >> red[i])) return 2;
    SpO2Signal r = spiroscan_analyze_spo2(ir, red, 100);
    int32_t spo2 = 0, pulse = 0;
    int8_t spo2_valid = 0, pulse_valid = 0;
    spiroscan_oxygen_saturation(ir, 100, red, &spo2, &spo2_valid, &pulse, &pulse_valid);
    float reference_ratio = spiroscan_reference_ratio();
    std::cout << std::setprecision(8)
      << "{\"ratio_rms\":" << r.ratio << ",\"pulse_cycles_bpm\":" << r.pulse_bpm
      << ",\"cycles\":" << int(r.cycles) << ",\"ratio_mad_fraction\":" << r.ratio_mad_fraction
      << ",\"interval_cv\":" << r.interval_cv << ",\"min_correlation\":" << r.min_correlation
      << ",\"quality_valid\":" << (r.quality_valid ? "true" : "false")
      << ",\"status\":\"" << r.status << "\",\"reference_ratio\":" << reference_ratio
      << ",\"reference_spo2\":" << spo2 << ",\"reference_valid\":" << int(spo2_valid)
      << ",\"ratios_agree\":" << (spiroscan_spo2_ratios_agree(reference_ratio, r.ratio) ? "true" : "false")
      << "}" << std::endl;
  }
}
