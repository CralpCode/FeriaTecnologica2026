#pragma once
#include <MAX30105.h>
// Drain all 31 hardware FIFO samples without SparkFun's four-slot software ring.
// This driver is used only with two LEDs (red/IR) at address 0x57.
class MAX30105Buffered : public MAX30105 {
  TwoWire* bus = &Wire;
  uint32_t red[32] = {}, ir[32] = {};   // el FIFO del MAX30102 guarda hasta 32 muestras
  uint8_t count = 0, index = 0;
  bool reg(uint8_t address, uint8_t& value) {
    bus->beginTransmission(0x57); bus->write(address);
    if (bus->endTransmission(false) != 0) return false;
    if (bus->requestFrom((uint8_t)0x57, (uint8_t)1) != 1) return false;
    value = bus->read(); return true;
  }
public:
  bool begin(TwoWire& wire = Wire, uint32_t speed = I2C_SPEED_STANDARD) {
    bus = &wire; return MAX30105::begin(wire, speed);
  }
  void clearFIFO() { count = index = 0; MAX30105::clearFIFO(); }
  uint16_t check() {
    if (available()) return 0;
    count = index = 0;
    uint8_t read = 0, write = 0, overflow = 0;
    if (!reg(0x04, write) || !reg(0x05, overflow) || !reg(0x06, read)) return 65535;
    uint8_t pending = (write - read) & 31;
    // FIFO desbordado (p. ej. al arrancar): el contador solo vuelve a 0 cuando se LEEN muestras,
    // asi que se vacia (32 muestras con el FIFO lleno) y se informa como hueco: el llamador las descarta.
    if (overflow && !pending) pending = 32;
    while (count < pending) {
      uint8_t batch = min((int)(pending - count), 5);
      uint8_t bytes = batch * 6;
      bus->beginTransmission(0x57); bus->write(0x07);
      if (bus->endTransmission(true) != 0 || bus->requestFrom((uint8_t)0x57, bytes) != bytes) {
        count = index = 0; return 65535;
      }
      for (uint8_t i = 0; i < batch; ++i) {
        uint32_t r = 0, v = 0;
        for (int b = 0; b < 3; ++b) r = (r << 8) | bus->read();
        for (int b = 0; b < 3; ++b) v = (v << 8) | bus->read();
        red[count] = r & 0x3ffff; ir[count] = v & 0x3ffff; ++count;
      }
    }
    if (overflow) { count = index = 0; return 65535; }   // muestras con un hueco antes: no se usan
    return count;
  }
  uint8_t available() { return count - index; }
  uint32_t getFIFOIR() { return available() ? ir[index] : 0; }
  uint32_t getFIFORed() { return available() ? red[index] : 0; }
  void nextSample() { if (available()) ++index; }
};
