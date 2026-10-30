// Actual pinned v0.2.0 LLVM output for retained synthetic constant-position shader.
// SHA256 42421fed5ecfb812602f91b4f4c721bae95f51f39f555ca2d0ec0427fe68fc9c
static constexpr const char NoArgumentsIR[] = R"AIR_TEST_IR(; ModuleID = '/input/shader.metal'
source_filename = "/input/shader.metal"
target datalayout = "e-p:64:64:64-i1:8:8-i8:8:8-i16:16:16-i32:32:32-i64:64:64-f32:32:32-f64:64:64-v16:16:16-v24:32:32-v32:32:32-v48:64:64-v64:64:64-v96:128:128-v128:128:128-v192:256:256-v256:256:256-v512:512:512-v1024:1024:1024-n8:16:32"
target triple = "air64-apple-ios18.0.0"

; Function Attrs: mustprogress nofree norecurse nosync nounwind readnone willreturn
define { <4 x float> } @translated_vertex() local_unnamed_addr #0 {
entry:
  ret { <4 x float> } { <4 x float> <float 2.500000e-01, float 5.000000e-01, float 1.250000e-01, float 1.000000e+00> }
}

attributes #0 = { mustprogress nofree norecurse nosync nounwind readnone willreturn "frame-pointer"="none" "min-legal-vector-width"="0" "no-builtins" "no-trapping-math"="true" "stack-protector-buffer-size"="8" }

!llvm.module.flags = !{!0, !1, !2, !3, !4, !5, !6, !7}
!llvm.ident = !{!8}
!air.version = !{!9}
!air.language_version = !{!10}
!air.compile_options = !{!11, !12, !13}
!air.vertex = !{!14}
!air.sampler_states = !{}
!llvm.linker.options = !{}

!0 = !{i32 2, !"SDK Version", [2 x i32] [i32 18, i32 0]}
!1 = !{i32 1, !"wchar_size", i32 4}
!2 = !{i32 7, !"air.max_device_buffers", i32 31}
!3 = !{i32 7, !"air.max_constant_buffers", i32 31}
!4 = !{i32 7, !"air.max_threadgroup_buffers", i32 31}
!5 = !{i32 7, !"air.max_textures", i32 128}
!6 = !{i32 7, !"air.max_read_write_textures", i32 8}
!7 = !{i32 7, !"air.max_samplers", i32 16}
!8 = !{!"clang version 14.0.6 (https://github.com/n3crosis/floor_llvm bedfa07922b0dc9d8e45d28135ad69d07eb78ae7)"}
!9 = !{i32 2, i32 7, i32 0}
!10 = !{!"Metal", i32 3, i32 2, i32 0}
!11 = !{!"air.compile.denorms_disable"}
!12 = !{!"air.compile.fast_math_enable"}
!13 = !{!"air.compile.framebuffer_fetch_enable"}
!14 = !{{ <4 x float> } ()* @translated_vertex, !15, !17}
!15 = !{!16}
!16 = !{!"air.position", !"air.arg_type_name", !"float4", !"air.arg_name", !"gl_Position"}
!17 = !{}
)AIR_TEST_IR";
