// Codifica PCM int16 (stdin) con el mismo rice_codec.h del firmware y escribe el flujo rice1 (stdout).
// Uso en las pruebas: Backend/tests/test_audio_codec.py lo compila y compara con audio_codec.decode.
#include <cstdio>
#include <vector>
#include "../rice_codec.h"

int main() {
  std::vector<int16_t> pcm;
  int16_t s;
  while (fread(&s, sizeof(s), 1, stdin) == 1) pcm.push_back(s);
  uint8_t out[RICE_MAX_OUT];
  for (size_t i = 0; i < pcm.size(); i += RICE_BLOCK) {
    size_t n = pcm.size() - i < RICE_BLOCK ? pcm.size() - i : RICE_BLOCK;
    fwrite(out, 1, rice_encode_block(&pcm[i], n, out), stdout);
  }
  return 0;
}
