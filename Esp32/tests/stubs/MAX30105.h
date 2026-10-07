#pragma once
#include <cstdint>
#include <algorithm>
#include <deque>
#include <vector>
using std::min;
#define I2C_SPEED_STANDARD 100000
class TwoWire {
public:
  uint8_t selected = 0, read_pointer = 0, write_pointer = 0, overflow = 0;
  bool fail_fifo = false;
  std::deque<uint8_t> response;
  std::vector<uint8_t> fifo;
  size_t offset = 0;
  void beginTransmission(uint8_t) {}
  void write(uint8_t value) { selected = value; }
  int endTransmission(bool = true) { return 0; }
  uint8_t requestFrom(uint8_t, uint8_t n) {
    response.clear();
    if (selected == 7) {
      if (fail_fifo) return 0;
      for (uint8_t i = 0; i < n; ++i) response.push_back(fifo.at(offset++));
      overflow = 0;   // como el chip real: leer muestras reinicia el contador de desborde
    } else response.push_back(selected == 4 ? write_pointer : selected == 5 ? overflow : read_pointer);
    return n;
  }
  int read() { int value = response.front(); response.pop_front(); return value; }
};
extern TwoWire Wire;
class MAX30105 {
public:
  bool begin(TwoWire&, uint32_t) { return true; }
  // Como el chip real observado: escribir 0 en los punteros no reinicia el contador de desborde.
  void clearFIFO() { Wire.read_pointer = Wire.write_pointer = 0; }
};
