#ifndef FLOOR_AIR_TARGET_OPTIONS_H
#define FLOOR_AIR_TARGET_OPTIONS_H
#include <stdint.h>
namespace floor_air {
struct TargetOptions {
  const char *triple;
  const char *standard;
  uint32_t metalVersion;
  uint32_t airMinor;
};
// An explicit v3 tuple is deliberately narrower than all theoretically valid
// deployment/language combinations. Never infer a new standard from an OS.
inline bool selectTarget(uint32_t ios, uint32_t metal, bool explicitLanguage,
                         TargetOptions &out) {
  if (!explicitLanguage) {
    if (metal != 320 || (ios != 18 && ios != 26)) return false;
    out = {ios == 18 ? "air64-apple-ios18.0.0" : "air64-apple-ios26.0.0",
           "-std=metal3.2", 320, 7};
    return true;
  }
  if (ios == 18 && metal == 320) {
    out = {"air64-apple-ios18.0.0", "-std=metal3.2", 320, 7};
    return true;
  }
  if (ios == 26 && metal == 400) {
    out = {"air64-apple-ios26.0.0", "-std=metal4.0", 400, 8};
    return true;
  }
  if (ios == 27 && metal == 410) {
    out = {"air64-apple-ios27.0.0", "-std=metal4.1", 410, 9};
    return true;
  }
  return false;
}
}
#endif
