#pragma once
#include <stdint.h>

// Engineering acquisition checks, not a validated clinical signal-quality score.
// Thresholds must be evaluated on the assembled optical/mechanical device.
class PpgQuality {
 public:
  static constexpr uint32_t SAMPLE_MAX_AGE_MS = 250;
  static constexpr uint32_t BEAT_MAX_AGE_MS = 3000;
  static constexpr uint32_t SETTLE_MS = 5000;

  void invalidate(const char* reason) {
    valid_ = false;
    count_ = spot_ = 0;
    have_beat_ = false;
    contact_ = false;
    reason_ = reason;
  }

  bool sample(uint32_t ir, uint32_t red, uint32_t now) {
    if (have_sample_ && now - last_sample_ > SAMPLE_MAX_AGE_MS) invalidate("stale");
    have_sample_ = true;
    last_sample_ = now;
    // 18-bit ADC: reject clipping; low IR is a contact heuristic, not proof of a finger.
    if (ir >= 262000 || red >= 262000 || red == 0) {
      invalidate("poor");
      return false;
    }
    if (ir < 45000) {
      invalidate("no_contact");
      return false;
    }
    if (!contact_) {
      contact_ = true;
      contact_start_ = now;
      reason_ = "acquiring";
    }
    return true;
  }

  void beat(uint32_t sample_clock_ms, uint32_t now) {
    if (!contact_) return;
    if (!have_beat_) {
      have_beat_ = true;
      last_beat_clock_ = sample_clock_ms;
      last_beat_ = now;
      return;
    }
    uint32_t interval = sample_clock_ms - last_beat_clock_;
    last_beat_clock_ = sample_clock_ms;
    last_beat_ = now;
    // Accepted detector range, not healthy/abnormal thresholds. Never clamp a value.
    if (interval < 273 || interval > 2000) {
      count_ = spot_ = 0;
      valid_ = false;
      reason_ = "poor";
      return;
    }
    intervals_[spot_] = interval;
    spot_ = (spot_ + 1) % 4;
    if (count_ < 4) count_++;
    valid_ = count_ >= 3;
    reason_ = "acquiring";
  }

  bool valid(uint32_t now) const {
    return contact_ && valid_ && have_sample_ && have_beat_
        && now - last_sample_ <= SAMPLE_MAX_AGE_MS
        && now - last_beat_ <= BEAT_MAX_AGE_MS
        && now - contact_start_ >= SETTLE_MS;
  }

  int bpm(uint32_t now) const {
    if (!valid(now)) return 0;
    uint32_t sum = 0;
    for (uint8_t i = 0; i < count_; i++) sum += intervals_[i];
    return (60000UL * count_ + sum / 2) / sum;
  }

  bool contact(uint32_t now) const {
    return contact_ && age(now) <= SAMPLE_MAX_AGE_MS;
  }

  uint32_t age(uint32_t now) const {
    return have_sample_ ? now - last_sample_ : UINT32_MAX;
  }

  const char* quality(uint32_t now) const {
    if (have_sample_ && age(now) > SAMPLE_MAX_AGE_MS) return "stale";
    if (contact_ && have_beat_ && now - last_beat_ > BEAT_MAX_AGE_MS) return "stale";
    return valid(now) ? "good" : reason_;
  }

 private:
  bool contact_ = false, valid_ = false, have_sample_ = false, have_beat_ = false;
  uint8_t count_ = 0, spot_ = 0;
  uint32_t intervals_[4] = {0};
  uint32_t last_sample_ = 0, last_beat_ = 0, last_beat_clock_ = 0, contact_start_ = 0;
  const char* reason_ = "sensor_unavailable";
};
