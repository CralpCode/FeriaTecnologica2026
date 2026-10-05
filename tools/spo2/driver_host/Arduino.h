#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <algorithm>
using std::min;
using byte = uint8_t;
using boolean = bool;
inline unsigned long millis() { static unsigned long now = 0; return ++now; }
inline void delay(unsigned long) {}
