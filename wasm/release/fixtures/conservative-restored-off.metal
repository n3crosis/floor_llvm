#include <metal_stdlib>
using namespace metal;
kernel void restored_off(device float *out [[buffer(0)]], constant float *input [[buffer(1)]]) {
#pragma clang fp contract(fast)
#pragma clang fp contract(off)
  out[0] = input[0] * 1.0f;
}
