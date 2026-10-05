#include "spo2_signal.h"
#include <math.h>
#include <stdlib.h>

namespace {
constexpr int N = 100;
constexpr float RATE = 25.0f;
// Conservative engineering limits, not medically validated thresholds.
constexpr float MIN_CORRELATION = 0.85f;
constexpr float MAX_INTERVAL_CV = 0.20f;
constexpr float MAX_RATIO_MAD = 0.15f;
constexpr float MIN_RELATIVE_AC = 0.0002f;

float median(float* values, int count) {
  for (int i = 1; i < count; ++i) {
    float value = values[i];
    int j = i;
    while (j > 0 && values[j - 1] > value) {
      values[j] = values[j - 1]; --j;
    }
    values[j] = value;
  }
  return count % 2 ? values[count / 2] :
    (values[count / 2 - 1] + values[count / 2]) * 0.5f;
}
}

bool spiroscan_spo2_ratios_agree(float reference_ratio, float cycle_ratio) {
  return reference_ratio > 0 && cycle_ratio > 0 &&
    fabsf(reference_ratio - cycle_ratio) <= 0.20f * cycle_ratio;
}

SpO2Signal spiroscan_analyze_spo2(const uint32_t* ir, const uint32_t* red, int count) {
  SpO2Signal out;
  if (!ir || !red || count != N) return out;
  float mean = 0, slope = 0, denominator = 0;
  for (int i = 0; i < N; ++i) {
    if (ir[i] == 0 || red[i] == 0) { out.status = "no_contact"; return out; }
    if (ir[i] >= 260000 || red[i] >= 260000) {
      out.status = "optical_clipping"; return out;
    }
    mean += ir[i];
  }
  mean /= N;
  for (int i = 0; i < N; ++i) {
    float t = i - (N - 1) * 0.5f;
    slope += t * (ir[i] - mean); denominator += t * t;
  }
  slope /= denominator;
  float ac[N], smooth[N] = {}, energy = 0;
  for (int i = 0; i < N; ++i)
    ac[i] = ir[i] - mean - slope * (i - (N - 1) * 0.5f);
  for (int i = 1; i < N - 1; ++i) {
    smooth[i] = (ac[i - 1] + ac[i] + ac[i + 1]) / 3;
    energy += smooth[i] * smooth[i];
  }
  float rms = sqrtf(energy / (N - 2));
  if (rms / mean < MIN_RELATIVE_AC) { out.status = "weak_signal"; return out; }

  // Rank local valleys by their prominence on both sides. A 10-sample
  // exclusion prevents counting the dicrotic notch as another pulse.
  int candidates[N], candidate_count = 0;
  float prominence[N];
  for (int i = 2; i < N - 2; ++i) {
    if (!(smooth[i] < smooth[i - 1] && smooth[i] <= smooth[i + 1])) continue;
    float left = smooth[i], right = smooth[i];
    for (int j = i - 8; j < i; ++j)
      if (j >= 1 && smooth[j] > left) left = smooth[j];
    for (int j = i + 1; j <= i + 8; ++j)
      if (j < N - 1 && smooth[j] > right) right = smooth[j];
    float p = fminf(left, right) - smooth[i];
    if (p > 0.5f * rms) {
      candidates[candidate_count] = i; prominence[candidate_count++] = p;
    }
  }
  for (int i = 1; i < candidate_count; ++i) {
    int pos = candidates[i], j = i; float p = prominence[i];
    while (j > 0 && prominence[j - 1] < p) {
      candidates[j] = candidates[j - 1]; prominence[j] = prominence[j - 1]; --j;
    }
    candidates[j] = pos; prominence[j] = p;
  }
  int valleys[10], valley_count = 0;
  for (int i = 0; i < candidate_count && valley_count < 10; ++i) {
    bool separated = true;
    for (int j = 0; j < valley_count; ++j)
      if (abs(candidates[i] - valleys[j]) < 10) separated = false;
    if (separated) valleys[valley_count++] = candidates[i];
  }
  for (int i = 1; i < valley_count; ++i) {
    int pos = valleys[i], j = i;
    while (j > 0 && valleys[j - 1] > pos) { valleys[j] = valleys[j - 1]; --j; }
    valleys[j] = pos;
  }

  float ratios[9], intervals[9], deviations[9];
  out.min_correlation = 1;
  bool rejected_cycle = false;
  for (int k = 0; k < valley_count - 1; ++k) {
    int a = valleys[k], b = valleys[k + 1], length = b - a;
    // Complete cycles only; approximately 45-150 BPM at 25 Hz.
    if (length < 10 || length > 33) { rejected_cycle = true; continue; }
    float dc_ir = 0, dc_red = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (int i = a; i <= b; ++i) {
      float fraction = float(i - a) / length;
      // Remove a separate linear baseline in each channel over the SAME cycle.
      float x = float(ir[i]) - (float(ir[a]) + (float(ir[b]) - ir[a]) * fraction);
      float y = float(red[i]) - (float(red[a]) + (float(red[b]) - red[a]) * fraction);
      dc_ir += ir[i]; dc_red += red[i];
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    float n = float(length + 1);
    dc_ir /= n; dc_red /= n;
    float vx = fmaxf(0, sxx / n - (sx / n) * (sx / n));
    float vy = fmaxf(0, syy / n - (sy / n) * (sy / n));
    float norm_ir = sqrtf(vx) / dc_ir, norm_red = sqrtf(vy) / dc_red;
    if (norm_ir < MIN_RELATIVE_AC || norm_red < MIN_RELATIVE_AC) {
      rejected_cycle = true; continue;
    }
    float correlation = (sxy / n - sx * sy / (n * n)) / sqrtf(vx * vy);
    out.min_correlation = fminf(out.min_correlation, correlation);
    if (correlation < MIN_CORRELATION) { rejected_cycle = true; continue; }
    ratios[out.cycles] = norm_red / norm_ir;
    intervals[out.cycles] = float(length);
    ++out.cycles;
  }
  if (out.cycles == 0) { out.status = "insufficient_cycles"; return out; }
  out.ratio = median(ratios, out.cycles);
  for (int i = 0; i < out.cycles; ++i) deviations[i] = fabsf(ratios[i] - out.ratio);
  out.ratio_mad_fraction = median(deviations, out.cycles) / out.ratio;
  float interval_mean = 0, variance = 0;
  for (int i = 0; i < out.cycles; ++i) interval_mean += intervals[i];
  interval_mean /= out.cycles;
  for (int i = 0; i < out.cycles; ++i)
    variance += (intervals[i] - interval_mean) * (intervals[i] - interval_mean);
  out.interval_cv = sqrtf(variance / out.cycles) / interval_mean;
  out.pulse_bpm = RATE * 60 / interval_mean;
  if (out.cycles < 3) { out.status = "insufficient_cycles"; return out; }
  if (rejected_cycle || out.interval_cv > MAX_INTERVAL_CV ||
      out.ratio_mad_fraction > MAX_RATIO_MAD) {
    out.status = "unstable_signal"; return out;
  }
  out.quality_valid = true;
  // Range of the existing MAXREFDES117 lookup, not a fitted calibration curve.
  out.status = out.ratio > 0.02f && out.ratio < 1.84f ? "signal_ok" : "ratio_out_of_range";
  return out;
}
