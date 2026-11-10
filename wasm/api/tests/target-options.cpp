#include "../air_compiler.h"
#include "../air_target_options.h"
#include <cassert>
#include <cstring>
#include <limits>
int main() {
  floor_air::TargetOptions target{};
  const uint32_t os[] = {0, 17, 18, 19, 25, 26, 27, 28, std::numeric_limits<uint32_t>::max()};
  const uint32_t versions[] = {0, 32, 320, 321, 400, 401, 410, 411, std::numeric_limits<uint32_t>::max()};
  for (auto ios : os) for (auto metal : versions) {
    bool matched = (ios == 18 && metal == 320) || (ios == 26 && metal == 400) || (ios == 27 && metal == 410);
    assert(floor_air::selectTarget(ios, metal, true, target) == matched);
    bool legacy = (ios == 18 || ios == 26) && metal == 320;
    assert(floor_air::selectTarget(ios, metal, false, target) == legacy);
  }
  assert(floor_air::selectTarget(27, AIR_METAL_4_1, true, target));
  assert(std::strcmp(target.triple, "air64-apple-ios27.0.0") == 0);
  assert(std::strcmp(target.standard, "-std=metal4.1") == 0);
  assert(target.metalVersion == 410 && target.airMinor == 9);
  assert(floor_air::selectTarget(26, AIR_METAL_4_0, true, target));
  assert(std::strcmp(target.standard, "-std=metal4.0") == 0);
  assert(target.metalVersion == 400 && target.airMinor == 8);
  assert(floor_air::selectTarget(26, AIR_METAL_3_2, false, target));
  assert(std::strcmp(target.standard, "-std=metal3.2") == 0);
  assert(target.metalVersion == 320 && target.airMinor == 7);
}
