#include <cassert>
#include "../MAX30105Buffered.h"
TwoWire Wire;
int main() {
  MAX30105Buffered sensor;
  assert(sensor.begin());
  // Hardware pointer wrap: 30 -> 29 holds 31 unread red/IR pairs.
  Wire.read_pointer = 30; Wire.write_pointer = 29;
  for (uint32_t i = 0; i < 31; ++i) {
    for (uint32_t value : {50000 + i, 100000 + i})
      for (int shift : {16, 8, 0}) Wire.fifo.push_back((value >> shift) & 255);
  }
  assert(sensor.check() == 31);
  assert(sensor.available() == 31);
  // Polling again must preserve undrained data.
  assert(sensor.check() == 0);
  for (uint32_t i = 0; i < 31; ++i) {
    assert(sensor.getFIFORed() == 50000 + i);
    assert(sensor.getFIFOIR() == 100000 + i);
    sensor.nextSample();
  }
  assert(sensor.available() == 0);
  sensor.clearFIFO();
  Wire.overflow = 1;
  assert(sensor.check() > 31);
  assert(sensor.available() == 0);
  sensor.clearFIFO();
  Wire.write_pointer = 1; Wire.fail_fifo = true;
  assert(sensor.check() > 31);
  assert(sensor.available() == 0);
}
