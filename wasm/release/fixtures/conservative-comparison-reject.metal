#include <metal_stdlib>
using namespace metal;
bool relaxed_compare(float value) {
#pragma clang fp reassociate(on)
  return value == value;
}
kernel void comparison(device unsigned int *out [[buffer(0)]], constant float *input [[buffer(1)]]) {
  out[0] = relaxed_compare(input[0]) ? 1u : 0u;
}
