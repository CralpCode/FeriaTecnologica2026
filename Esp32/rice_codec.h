// ==============================================================================
// Compresion SIN PERDIDA del audio (formato "rice1"), para enviar menos datos.
// El servidor la deshace en Backend/audio_codec.py y comprueba el SHA-256 del PCM
// original: si una sola muestra no coincide, la grabacion se rechaza y no se analiza.
//
// El audio se corta en bloques de RICE_BLOCK muestras (el ultimo puede ser menor).
// Cada bloque empieza con un byte H:
//   H == 0xFF -> bloque sin comprimir: n muestras int16 little-endian.
//   si no     -> orden = H >> 4 (1 o 2), k = H & 0x0F. Siguen las primeras `orden`
//                muestras como int16 LE y luego, bit a bit (el mas significativo primero),
//                el residuo de cada muestra respecto a la prediccion:
//                  orden 1: x[i-1]          orden 2: 2*x[i-1] - x[i-2]
//                en zigzag (0,-1,1,-2,... -> 0,1,2,3,...) con codigo Rice de parametro k:
//                (u >> k) unos, un cero y los k bits bajos de u. Relleno con ceros hasta el byte.
// Si comprimir no ahorra espacio en un bloque, se guarda sin comprimir: nunca ocupa mas
// que el original + 1 byte por bloque.
// ==============================================================================
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

#define RICE_BLOCK   1024
#define RICE_MAX_OUT (1 + 2 * RICE_BLOCK)

static inline uint32_t rice_zigzag(int32_t r) {
  return r >= 0 ? (uint32_t)r << 1 : (((uint32_t)(-r)) << 1) - 1;
}

static inline int32_t rice_residual(const int16_t* x, size_t i, int order) {
  int32_t pred = order == 1 ? (int32_t)x[i - 1] : 2 * (int32_t)x[i - 1] - (int32_t)x[i - 2];
  return (int32_t)x[i] - pred;
}

// Comprime n (<= RICE_BLOCK) muestras en out (al menos RICE_MAX_OUT bytes). Devuelve los bytes escritos.
static size_t rice_encode_block(const int16_t* x, size_t n, uint8_t* out) {
  const size_t raw_size = 1 + 2 * n;
  int best_order = 0, best_k = 0;
  uint64_t best_bits = UINT64_MAX;
  for (int order = 1; order <= 2 && n > (size_t)order; order++) {
    uint64_t sum = 0;
    for (size_t i = order; i < n; i++) sum += rice_zigzag(rice_residual(x, i, order));
    uint64_t mean = sum / (n - order);
    int k0 = 0;
    while (k0 < 15 && ((uint64_t)1 << (k0 + 1)) <= mean) k0++;
    for (int k = k0 > 0 ? k0 - 1 : 0; k <= k0 + 1 && k <= 15; k++) {
      uint64_t bits = 0;
      for (size_t i = order; i < n; i++) bits += (rice_zigzag(rice_residual(x, i, order)) >> k) + 1 + k;
      if (bits < best_bits) { best_bits = bits; best_order = order; best_k = k; }
    }
  }
  if (!best_order || 1 + 2 * (size_t)best_order + (size_t)((best_bits + 7) / 8) >= raw_size) {
    out[0] = 0xFF;
    for (size_t i = 0; i < n; i++) {
      out[1 + 2 * i] = (uint8_t)((uint16_t)x[i] & 0xFF);
      out[2 + 2 * i] = (uint8_t)((uint16_t)x[i] >> 8);
    }
    return raw_size;
  }

  size_t pos = 0;
  out[pos++] = (uint8_t)(best_order << 4 | best_k);
  for (int i = 0; i < best_order; i++) {
    out[pos++] = (uint8_t)((uint16_t)x[i] & 0xFF);
    out[pos++] = (uint8_t)((uint16_t)x[i] >> 8);
  }
  uint8_t acc = 0;
  int filled = 0;
#define RICE_PUT(bit) do { acc = (uint8_t)(acc << 1 | (bit)); if (++filled == 8) { out[pos++] = acc; acc = 0; filled = 0; } } while (0)
  for (size_t i = best_order; i < n; i++) {
    uint32_t u = rice_zigzag(rice_residual(x, i, best_order));
    for (uint32_t q = u >> best_k; q; q--) RICE_PUT(1);
    RICE_PUT(0);
    for (int b = best_k - 1; b >= 0; b--) RICE_PUT((u >> b) & 1);
  }
  if (filled) out[pos++] = (uint8_t)(acc << (8 - filled));
#undef RICE_PUT
  return pos;
}
