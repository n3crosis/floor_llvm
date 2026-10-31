#include <metal_stdlib>
using namespace metal;
int relaxed_cast(float value) {
#pragma clang fp reassociate(on)
  return value;
}
kernel void implicit_cast(device int *out [[buffer(0)]], constant float *input [[buffer(1)]]) {
  out[0] = relaxed_cast(input[0]);
}
