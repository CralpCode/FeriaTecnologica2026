#pragma once
#include <cstring>

// The server repeats an armed command until /audio/start consumes it.
// Call under the same lock from the network task and the main loop.
class RecordingCommand {
 public:
  bool queue(const char* action, const char* id) {
    if (!action || std::strcmp(action, "grabar") || !id || std::strlen(id) != 8) return false;
    char normalized[9] = {};
    for (int i = 0; i < 8; ++i) {
      char c = id[i];
      if (c >= 'A' && c <= 'F') c += 'a' - 'A';
      if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
      normalized[i] = c;
    }
    if (!std::strcmp(last_, normalized)) return false;
    std::memcpy(last_, normalized, sizeof(last_));
    std::memcpy(pending_, normalized, sizeof(pending_));
    return true;
  }

  bool take(char (&id)[9]) {
    if (!pending_[0]) return false;
    std::memcpy(id, pending_, sizeof(pending_));
    pending_[0] = '\0';
    return true;
  }

 private:
  char last_[9] = {};
  char pending_[9] = {};
};
