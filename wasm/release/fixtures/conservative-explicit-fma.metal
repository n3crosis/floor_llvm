#include <metal_stdlib>
using namespace metal;
// Explicit accurate FMA is not implicit source contraction or air.fast_*.
kernel void explicit_fma(device float *out [[buffer(0)]], constant float *input [[buffer(1)]]) {
  out[0] = metal::fma(input[0], input[1], input[2]);
}
