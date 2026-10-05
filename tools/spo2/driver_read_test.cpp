#include <cassert>
#include <iostream>
#include "MAX30105Buffered.h"

TwoWire Wire;
// Same zero-initialized lifetime as particleSensor in the firmware.
MAX30105Buffered sensor;

void mustFail() {
  assert(sensor.check() == UINT16_MAX);
  assert(sensor.available() == 0);
}

int main() {
  assert(sensor.begin());
  sensor.setup(0x35, 4, 2, 400, 411, 4096);
  Wire.resetFaults(); Wire.queue(31);
  assert(sensor.check() == 31 && sensor.available() == 31);
  for (int i = 0; i < 31; ++i) {
    assert(sensor.getFIFORed() == 123456u + i);
    assert(sensor.getFIFOIR() == 100000u + i);
    sensor.nextSample();
  }
  assert(sensor.available() == 0);

  // Verify exact ordering as the 64-position ring wraps.
  for (int batch : {31, 6}) {
    Wire.resetFaults(); Wire.queue(batch);
    assert(sensor.check() == batch && sensor.available() == batch);
    for (int i = 0; i < batch; ++i) {
      assert(sensor.getFIFORed() == 123456u + i);
      assert(sensor.getFIFOIR() == 100000u + i);
      sensor.nextSample();
    }
    assert(sensor.available() == 0);
  }

  for (int reg : {4, 6}) {
    Wire.resetFaults(); Wire.queue(1); Wire.bad_register = reg; Wire.fail_pointer_ack = true;
    mustFail(); assert(Wire.fifo_requests == 0);
    Wire.resetFaults(); Wire.queue(1); Wire.bad_register = reg; Wire.fail_pointer_data = true;
    mustFail(); assert(Wire.fifo_requests == 0);
    Wire.resetFaults(); Wire.queue(1); Wire.registers[reg] = 255;
    mustFail(); assert(Wire.fifo_requests == 0);
  }
  Wire.resetFaults(); Wire.queue(1); Wire.fail_fifo_ack = true;
  mustFail(); assert(Wire.fifo_requests == 0);

  for (int chunk : {1, 2}) {
    for (bool full_count : {false, true}) {
      Wire.resetFaults(); Wire.queue(7); Wire.short_chunk = chunk; Wire.pretend_full_count = full_count;
      mustFail(); // Second-chunk failure must also discard the first five pairs.
    }
  }
  Wire.resetFaults(); Wire.queue(1);
  assert(sensor.check() == 1 && sensor.available() == 1);
  assert(sensor.getFIFOIR() == 100000u && sensor.getFIFORed() == 123456u);
  sensor.nextSample();
  Wire.resetFaults(); assert(sensor.check() == 0);
  // Actual saturation is valid transport data; optical quality rejects it.
  Wire.queue(1, 262143, 262143);
  assert(sensor.check() == 1 && sensor.getFIFOIR() == 262143u);
  std::cout << "17 driver cases passed: complete batches, ring wrap, I2C faults, partial transfers, recovery, actual saturation\n";
}
