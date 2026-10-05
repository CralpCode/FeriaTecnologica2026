#include <cassert>
#include <cstring>
#include "recording_command.h"

int main() {
  RecordingCommand command;
  char id[9] = {};
  assert(!command.take(id));
  assert(!command.queue("delete", "abcd1234"));
  assert(!command.queue("grabar", nullptr));
  assert(!command.queue("grabar", "abcd123"));
  assert(!command.queue("grabar", "abcd12345"));
  assert(!command.queue("grabar", "abcd123!"));
  assert(command.queue("grabar", "ABCD1234"));
  assert(!command.queue("grabar", "abcd1234"));
  assert(command.take(id));
  assert(!std::strcmp(id, "abcd1234"));
  assert(!command.take(id));
  assert(!command.queue("grabar", "ABCD1234"));
  assert(command.queue("grabar", "11111111"));
  assert(command.queue("grabar", "22222222"));
  assert(command.take(id));
  assert(!std::strcmp(id, "22222222"));
  assert(!command.take(id));
}
