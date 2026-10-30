#include <metal_stdlib>
#include <simd/simd.h>

using namespace metal;

struct translated_vertex_out
{
    float4 gl_Position [[position]];
};

vertex translated_vertex_out translated_vertex()
{
    translated_vertex_out out = {};
    out.gl_Position = float4(0.0, 0.0, 0.0, 1.0);
    out.gl_Position.x = 0.25;
    out.gl_Position.y = 0.5;
    out.gl_Position.z = 0.125;
    out.gl_Position.w = 1.0;
    return out;
}

