#include <metal_stdlib>
using namespace metal;
#define RELAX _Pragma("clang fp contract(fast)")
kernel void macro_pragma(device float *out [[buffer(0)]], constant float *input [[buffer(1)]]) {
  RELAX
  out[0] = input[0] * 1.0f;
}
