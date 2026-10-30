#include <metal_stdlib>
#include <simd/simd.h>

using namespace metal;

struct translated_vertex_out
{
    float4 gl_Position [[position]];
};

struct translated_vertex_in
{
    float4 in_attr0 [[attribute(0)]];
};

vertex translated_vertex_out translated_vertex(translated_vertex_in in [[stage_in]])
{
    translated_vertex_out out = {};
    out.gl_Position = float4(0.0, 0.0, 0.0, 1.0);
    out.gl_Position.x = in.in_attr0.x;
    return out;
}

