// Pruebas de ppg_logic.h con senales sinteticas (no demuestran exactitud clinica).
#include "../ppg_logic.h"
#include <assert.h>
#include <stdio.h>

int main() {
  // Contacto: requiere 300 ms sobre 50000.
  FingerDetector f;
  uint32_t t = 0;
  for (; t < 290; t += 10) assert(!f.update(80000, t));
  for (; t <= 320; t += 10) f.update(80000, t);
  assert(f.present());
  // Titubeo al apoyar: caidas breves (< 500 ms) bajo 30000 no lo retiran.
  for (int k = 0; k < 5; ++k) {
    for (uint32_t e = t + 200; t < e; t += 10) assert(f.update(20000, t));
    for (uint32_t e = t + 100; t < e; t += 10) assert(f.update(80000, t));
  }
  // Valores entre los umbrales no cambian el estado.
  for (uint32_t e = t + 2000; t < e; t += 10) assert(f.update(40000, t));
  // Retiro real: 500 ms bajo 30000.
  for (uint32_t e = t + 490; t < e; t += 10) assert(f.update(10000, t));
  for (uint32_t e = t + 30; t < e; t += 10) f.update(10000, t);
  assert(!f.present());
  // Ruido de un instante sobre 50000 no cuenta como dedo.
  f.update(90000, t); t += 10;
  for (uint32_t e = t + 400; t < e; t += 10) assert(!f.update(20000, t));

  // RMSSD: intervalos estables ~800 ms con variacion de 30 ms.
  uint32_t steady[10] = {800000, 830000, 800000, 830000, 800000, 830000, 800000, 830000, 800000, 830000};
  assert(clean_rmssd_ms(steady, 10) == 30);
  // Un latido falso (intervalo partido en dos) no infla el resultado.
  uint32_t artifact[11] = {800000, 830000, 800000, 830000, 400000, 430000, 800000, 830000, 800000, 830000, 800000};
  int r = clean_rmssd_ms(artifact, 11);
  assert(r == 30);
  // Sin suficientes pares limpios: no hay valor.
  uint32_t few[4] = {800000, 810000, 805000, 815000};
  assert(clean_rmssd_ms(few, 4) == -1);
  uint32_t chaos[8] = {400000, 900000, 500000, 1300000, 450000, 1000000, 600000, 1400000};
  assert(clean_rmssd_ms(chaos, 8) == -1);
  puts("ppg_logic OK");
  return 0;
}
