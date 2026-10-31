#include <metal_stdlib>
using namespace metal;
kernel void contract_on(device float *out [[buffer(0)]], constant float *input [[buffer(1)]]) {
#pragma clang fp contract(on)
  out[0] = input[0] * input[1] + input[2];
}
