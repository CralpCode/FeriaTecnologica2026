#pragma once
#include <stdint.h>
#include <deque>
#include <vector>

// Deterministic I2C fault injection; never used by the physical firmware.
class TwoWire {
 public:
  uint8_t registers[256] = {};
  std::deque<uint8_t> source, rx;
  std::vector<uint8_t> tx;
  int selected = 0, bad_register = -1, fifo_requests = 0, short_chunk = -1;
  bool fail_pointer_ack = false, fail_pointer_data = false, fail_fifo_ack = false;
  bool pretend_full_count = false;
  void begin() { registers[0xff] = 0x15; }
  void setClock(uint32_t) {}
  void beginTransmission(uint8_t) { tx.clear(); }
  void write(uint8_t value) { tx.push_back(value); }
  uint8_t endTransmission(bool = true) {
    selected = tx[0];
    if ((fail_pointer_ack && selected == bad_register) || (fail_fifo_ack && selected == 7)) return 2;
    if (tx.size() == 2) registers[selected] = selected == 9 ? 0 : tx[1];
    return 0;
  }
  int requestFrom(int, int count) {
    rx.clear();
    if (selected != 7) {
      if (fail_pointer_data && selected == bad_register) return 0;
      rx.push_back(registers[selected]); return 1;
    }
    ++fifo_requests;
    int requested = count;
    if (fifo_requests == short_chunk) --count;
    while (count-- > 0 && !source.empty()) {
      rx.push_back(source.front()); source.pop_front();
    }
    return pretend_full_count ? requested : int(rx.size());
  }
  int available() { return int(rx.size()); }
  int read() {
    if (rx.empty()) return -1;
    int value = rx.front(); rx.pop_front(); return value;
  }
  void resetFaults() {
    bad_register = short_chunk = -1;
    fail_pointer_ack = fail_pointer_data = fail_fifo_ack = pretend_full_count = false;
    fifo_requests = 0; source.clear(); rx.clear();
    registers[4] = registers[6] = 0;
  }
  void queue(int pairs, uint32_t red = 123456, uint32_t ir = 100000) {
    registers[4] = uint8_t(pairs); registers[6] = 0;
    for (int i = 0; i < pairs; ++i) {
      for (uint32_t value : {red + uint32_t(i), ir + uint32_t(i)}) {
        source.push_back(uint8_t(value >> 16));
        source.push_back(uint8_t(value >> 8)); source.push_back(uint8_t(value));
      }
    }
  }
};
extern TwoWire Wire;
