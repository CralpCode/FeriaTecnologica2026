// ==============================================================================
// Logica del pulso optico sin dependencias de Arduino (se prueba en la Mac: tests/ppg_logic_test.cpp).
// ==============================================================================
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <math.h>
#include <algorithm>

// Contacto del dedo con histeresis y retardo. Con un solo umbral, la senal cruzaba varias veces
// al apoyar el dedo y cada cruce reiniciaba latidos, oxigeno y variabilidad.
class FingerDetector {
 public:
  static constexpr uint32_t ON_LEVEL = 50000;     // IR para empezar a contar contacto
  static constexpr uint32_t OFF_LEVEL = 30000;    // IR por debajo del cual se cuenta retiro
  static constexpr uint32_t ON_MS = 300;          // contacto sostenido para confirmarlo
  static constexpr uint32_t OFF_MS = 500;         // retiro sostenido para confirmarlo

  // Una muestra de IR en el instante now_ms. Devuelve true mientras haya dedo confirmado.
  bool update(uint32_t ir, uint32_t now_ms) {
    if (!present_) {
      if (ir > ON_LEVEL) {
        if (!candidate_) { candidate_ = true; since_ = now_ms; }
        if (now_ms - since_ >= ON_MS) { present_ = true; candidate_ = false; }
      } else {
        candidate_ = false;
      }
    } else {
      if (ir < OFF_LEVEL) {
        if (!candidate_) { candidate_ = true; since_ = now_ms; }
        if (now_ms - since_ >= OFF_MS) { present_ = false; candidate_ = false; }
      } else {
        candidate_ = false;
      }
    }
    return present_;
  }
  bool present() const { return present_; }
  void reset() { present_ = candidate_ = false; }

 private:
  bool present_ = false;
  bool candidate_ = false;
  uint32_t since_ = 0;
};

// RMSSD (ms) con rechazo de artefactos: solo intervalos a +-20 % de la mediana; cuenta solo pares
// sucesivos en los que ambos intervalos son limpios. Devuelve -1 si no hay al menos min_pairs pares.
// intervals_us: en orden cronologico.
inline int clean_rmssd_ms(const uint32_t* intervals_us, size_t n, size_t min_pairs = 6) {
  if (n < min_pairs + 1 || n > 64) return -1;
  uint32_t sorted[64];
  std::copy(intervals_us, intervals_us + n, sorted);
  std::sort(sorted, sorted + n);
  double median = n % 2 ? sorted[n / 2] : (sorted[n / 2 - 1] + (double)sorted[n / 2]) / 2.0;
  auto clean = [&](uint32_t v) { return v >= median * 0.8 && v <= median * 1.2; };
  double sum_sq = 0;
  size_t pairs = 0;
  for (size_t i = 1; i < n; ++i) {
    if (!clean(intervals_us[i]) || !clean(intervals_us[i - 1])) continue;
    double d = ((double)intervals_us[i] - (double)intervals_us[i - 1]) / 1000.0;
    sum_sq += d * d;
    ++pairs;
  }
  if (pairs < min_pairs) return -1;
  return (int)lround(sqrt(sum_sq / pairs));
}
