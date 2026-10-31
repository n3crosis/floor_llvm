#include <metal_stdlib>
using namespace metal;
kernel void constant_fold(device float *out [[buffer(0)]]) {
#pragma clang fp contract(fast)
  constexpr float value = 2.0f * 3.0f;
  out[0] = value;
}
