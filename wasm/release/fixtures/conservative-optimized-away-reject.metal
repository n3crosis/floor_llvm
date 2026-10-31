#include <metal_stdlib>
using namespace metal;
// Old WASM optimized this to load/store only: final IR flags cannot catch it.
kernel void optimized_away(device float *out [[buffer(0)]], constant float *input [[buffer(1)]]) {
#pragma clang fp contract(fast)
  out[0] = input[0] * 1.0f;
}
