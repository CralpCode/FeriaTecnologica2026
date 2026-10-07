#include <cassert>
#include "../SpiroScanTLSClient.h"

int main() {
  // Reproducir el fallo de la biblioteca sin la correccion.
  {
    WiFiClientSecure original;
    original.stop();
    WiFiClientSecure::file_zero_open = true;
    original.stop();
    assert(!WiFiClientSecure::file_zero_open);
  }
  // Un nuevo archivo que reutilice FD0 sobrevive a los cierres repetidos
  // desde HTTPClient y a ambos destructores.
  WiFiClientSecure* fixed = new SpiroScanTLSClient;
  fixed->stop();
  WiFiClientSecure::file_zero_open = true;
  fixed->stop();
  assert(WiFiClientSecure::file_zero_open);
  delete fixed;
  assert(WiFiClientSecure::file_zero_open);
}
