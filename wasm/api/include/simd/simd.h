// Authored vector aliases only. Unsupported SIMD operations remain compile errors.
#ifndef FLOOR_AIR_SIMD
#define FLOOR_AIR_SIMD
#include <metal_stdlib>
namespace simd {
using metal::char2;
using metal::char3;
using metal::char4;
using metal::uchar2;
using metal::uchar3;
using metal::uchar4;
using metal::short2;
using metal::short3;
using metal::short4;
using metal::ushort2;
using metal::ushort3;
using metal::ushort4;
using metal::int2;
using metal::int3;
using metal::int4;
using metal::uint2;
using metal::uint3;
using metal::uint4;
using metal::long2;
using metal::long3;
using metal::long4;
using metal::ulong2;
using metal::ulong3;
using metal::ulong4;
using metal::half2;
using metal::half3;
using metal::half4;
using metal::float2;
using metal::float3;
using metal::float4;
}
#endif
