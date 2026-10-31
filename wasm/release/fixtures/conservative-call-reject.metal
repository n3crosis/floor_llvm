#include <metal_stdlib>
using namespace metal;
float identity(float value) { return value; }
float relaxed_call(float value) {
#pragma clang fp contract(fast)
  return identity(value);
}
kernel void folded_call(device float *out [[buffer(0)]], constant float *input [[buffer(1)]]) {
  out[0] = relaxed_call(input[0]);
}
