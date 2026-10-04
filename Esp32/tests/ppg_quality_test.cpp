// Synthetic protocol fixtures only; these do not demonstrate clinical accuracy.
#include "../ppg_quality.h"
#include <assert.h>
#include <string.h>

static void acquire(PpgQuality& quality, uint32_t start = 0) {
  for (uint32_t t = 0; t <= 6000; t += 10) {
    quality.sample(100000, 90000, start + t);
    if (t % 800 == 0) quality.beat(start + t, start + t);
  }
}

int main() {
  PpgQuality q;
  assert(!q.valid(0));
  assert(q.age(0) == UINT32_MAX);
  acquire(q);
  assert(q.valid(6000));
  assert(q.bpm(6000) == 75);
  assert(!q.valid(6251)); // no fresh samples
  assert(!strcmp(q.quality(6251), "stale"));
  q.sample(100000, 90000, 6251);
  assert(!q.valid(6251)); // reacquisition must settle again
  acquire(q, 7000);
  assert(q.valid(13000));
  q.sample(262143, 90000, 13010);
  assert(!q.valid(13010)); // clipping invalidates previous beats
  assert(!strcmp(q.quality(13010), "poor"));
  acquire(q, 14000);
  q.sample(1000, 1000, 20010);
  assert(!q.valid(20010));
  assert(!q.contact(20010));
  assert(q.bpm(20010) == 0); // removal never retains old BPM
  acquire(q, 21000);
  for (uint32_t t = 27010; t <= 30500; t += 10) q.sample(100000, 90000, t);
  assert(!q.valid(30500)); // fresh DC signal without a new beat is insufficient
  PpgQuality wrap;
  acquire(wrap, UINT32_MAX - 3000);
  assert(wrap.valid(2999)); // millis() rollover is handled by unsigned differences
  wrap.invalidate("sensor_unavailable");
  assert(!wrap.valid(2999));
}
