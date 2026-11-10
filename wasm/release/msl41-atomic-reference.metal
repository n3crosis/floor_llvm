// Authored MSL 4.1 uint atomic probes; no Apple SDK implementation content.
#include <metal_stdlib>
using namespace metal;
#ifndef OP
#define OP add
#endif
#ifndef SPACE
#define SPACE device
#endif
#ifndef ORDER
#define ORDER memory_order_relaxed
#endif
#ifndef FLAGS
#define FLAGS mem_flags::mem_device
#endif
#ifndef EXPLICIT_FLAGS
#define EXPLICIT_FLAGS 0
#endif
#ifndef VOLATILE
#define VOLATILE
#endif
#define FETCH_(op) atomic_fetch_##op##_explicit
#define FETCH(op) FETCH_(op)
kernel void atomic_probe(
    SPACE VOLATILE atomic_uint *object [[OBJECT_BINDING]],
    device uint *output [[buffer(1)]],
    constant uint *input [[buffer(2)]]) {
  output[0] = FETCH(OP)(object, input[0], ORDER
#if EXPLICIT_FLAGS
    , FLAGS
#endif
  );
}
