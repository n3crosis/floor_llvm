#include <metal_stdlib>
using namespace metal;
// Authored regression only. No pragma changes compiler policy.
kernel void conservative_arithmetic(device float *out [[buffer(0)]],
                                    constant float *input [[buffer(1)]]) {
  out[0] = input[0] * input[1] + input[2];
  out[1] = input[0] - input[0];
  out[2] = 1.0f / input[0];
  out[3] = input[0] * 0.0f;
}
