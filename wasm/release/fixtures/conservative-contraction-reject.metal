#include <metal_stdlib>
using namespace metal;
// Negative compiler-policy fixture. Must reject, never silently clear the flags.
kernel void contraction_override(device float *out [[buffer(0)]],
                                 constant float *input [[buffer(1)]]) {
#pragma clang fp contract(fast)
  out[0] = input[0] * input[1] + input[2];
}
