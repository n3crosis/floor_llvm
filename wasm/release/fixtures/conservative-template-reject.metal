#include <metal_stdlib>
using namespace metal;
template<class T> T relaxed_helper(T value) {
  _Pragma("clang fp contract(fast)")
  return value * 1.0f;
}
kernel void template_pragma(device float *out [[buffer(0)]], constant float *input [[buffer(1)]]) {
  out[0] = relaxed_helper(input[0]);
}
