#include <metal_stdlib>
using namespace metal;
// No unsafe frontend option is requested. The final-IR callee check must see
// through pointer casts even when the result is integer and optnone retains it.
__attribute__((optnone)) kernel void casted_fast_call(
    device unsigned int *out [[buffer(0)]],
    constant unsigned int *input [[buffer(1)]]) {
  out[0] = reinterpret_cast<unsigned int(*)(unsigned int)>(
      &metal::__air_detail::sqrt)(input[0]);
}
