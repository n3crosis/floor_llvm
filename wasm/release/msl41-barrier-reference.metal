#include <metal_stdlib>
using namespace metal;
#ifndef PROBE
#define PROBE 0
#endif
#if PROBE == 0
kernel void barrier_legacy() { threadgroup_barrier(mem_flags::mem_threadgroup); }
#elif PROBE == 1
kernel void barrier_acquire() { threadgroup_barrier(mem_flags::mem_threadgroup, memory_order_acquire); }
#elif PROBE == 2
kernel void barrier_release() { threadgroup_barrier(mem_flags::mem_threadgroup, memory_order_release); }
#elif PROBE == 3
kernel void barrier_acq_rel() { threadgroup_barrier(mem_flags::mem_threadgroup, memory_order_acq_rel); }
#elif PROBE == 4
kernel void barrier_seq_cst() { threadgroup_barrier(mem_flags::mem_threadgroup, memory_order_seq_cst); }
#elif PROBE == 5
kernel void barrier_relaxed() { threadgroup_barrier(mem_flags::mem_threadgroup, memory_order_relaxed); }
#elif PROBE == 6
kernel void barrier_device() { threadgroup_barrier(mem_flags::mem_device, memory_order_acq_rel, thread_scope_device); }
#elif PROBE == 7
kernel void barrier_none() { threadgroup_barrier(mem_flags::mem_none, memory_order_relaxed, thread_scope_threadgroup); }
#elif PROBE == 8
kernel void simd_acquire() { simdgroup_barrier(mem_flags::mem_threadgroup, memory_order_acquire); }
#elif PROBE == 9
kernel void simd_release() { simdgroup_barrier(mem_flags::mem_threadgroup, memory_order_release); }
#elif PROBE == 10
kernel void simd_acq_rel() { simdgroup_barrier(mem_flags::mem_threadgroup, memory_order_acq_rel); }
#elif PROBE == 11
kernel void simd_seq_cst() { simdgroup_barrier(mem_flags::mem_threadgroup, memory_order_seq_cst); }
#elif PROBE == 12
kernel void simd_relaxed() { simdgroup_barrier(mem_flags::mem_threadgroup, memory_order_relaxed); }
#elif PROBE == 13
kernel void barrier_thread() { threadgroup_barrier(mem_flags::mem_threadgroup, memory_order_acquire, thread_scope_thread); }
#elif PROBE == 14
kernel void barrier_simd() { threadgroup_barrier(mem_flags::mem_threadgroup, memory_order_acquire, thread_scope_simdgroup); }
#elif PROBE == 15
kernel void simd_device() { simdgroup_barrier(mem_flags::mem_device, memory_order_acq_rel, thread_scope_device); }
#elif PROBE == 16
kernel void enum_values(device uint *out [[buffer(0)]]) {
  out[0]=uint(memory_order_relaxed); out[1]=uint(memory_order_acquire); out[2]=uint(memory_order_release);
  out[3]=uint(memory_order_acq_rel); out[4]=uint(memory_order_seq_cst);
  out[5]=uint(thread_scope_thread); out[6]=uint(thread_scope_simdgroup); out[7]=uint(thread_scope_threadgroup); out[8]=uint(thread_scope_device);
  out[9]=uint(mem_flags::mem_none); out[10]=uint(mem_flags::mem_device); out[11]=uint(mem_flags::mem_threadgroup);
  out[12]=uint(mem_flags::mem_texture); out[13]=uint(mem_flags::mem_threadgroup_imageblock); out[14]=uint(mem_flags::mem_object_data);
}
#elif PROBE == 17
kernel void bad_order() { threadgroup_barrier(mem_flags::mem_threadgroup, memory_order(17)); }
#elif PROBE == 18
kernel void dynamic_order(device uint *in [[buffer(0)]]) { threadgroup_barrier(mem_flags::mem_threadgroup, memory_order(in[0])); }
#elif PROBE == 19
vertex float4 vertex_barrier() { threadgroup_barrier(mem_flags::mem_threadgroup, memory_order_acquire); return float4(0); }
#elif PROBE == 20
fragment float4 fragment_barrier() { threadgroup_barrier(mem_flags::mem_threadgroup, memory_order_acquire); return float4(0); }
#elif PROBE == 21
kernel void bad_scope() { threadgroup_barrier(mem_flags::mem_threadgroup, memory_order_acquire, thread_scope(17)); }
#elif PROBE == 23
kernel void simd_legacy() { simdgroup_barrier(mem_flags::mem_threadgroup); }
#elif PROBE == 22
kernel void bad_flags() { threadgroup_barrier(mem_flags(128), memory_order_acquire); }
#endif
