; RUN: opt -enable-new-pm=0 -MetalImage -verify-each -S %s | FileCheck %s
; RUN: sed 's/i32 4, i32 1, i32 0/i32 4, i32 0, i32 0/' %s | not opt -enable-new-pm=0 -MetalImage -S 2>&1 | FileCheck %s --check-prefix=OLD
;
; Explicit MSL 4.1 integer reads retain their actual sampler and offset.
; Legacy names keep the separate default-sampler path. The literal AIR return
; is the color plus residency byte; the compatibility method extracts color.
; OLD: sampler-backed integer texture reads require Metal 4.1

target triple = "air64-apple-ios27.0.0"
%struct._sampler_t = type opaque
%struct._texture_2d_t = type opaque
declare <4 x float> @floor.opaque.read_image.texture2d.sampler.float.i2(%struct._texture_2d_t addrspace(1)*, %struct._sampler_t addrspace(2)*, i64, <2 x i32>, i32, i32, <2 x i32>, i32, float, i1, i1, i1, <2 x float>, <2 x float>, i1, i32, float, i1)

; CHECK-LABEL: define <4 x float> @sampler_read_2d(
; CHECK-NOT: add
; CHECK-NOT: @air.get_read_sampler
; CHECK: %[[READ29:[a-zA-Z0-9._]+]] = call { <4 x float>, i8 } @air.read_texture_2d.v4f32(%struct._texture_2d_t addrspace(1)* %tex, %struct._sampler_t addrspace(2)* {{[^,]*}}%state, <2 x i32> %coordinate, <2 x i32> %offset, i32 %lod, i32 0)
; CHECK: %[[COLOR29:[a-zA-Z0-9._]+]] = extractvalue { <4 x float>, i8 } %[[READ29]], 0
; CHECK: ret <4 x float> %[[COLOR29]]
define <4 x float> @sampler_read_2d(%struct._texture_2d_t addrspace(1)* %tex, %struct._sampler_t addrspace(2)* %state, <2 x i32> %coordinate, <2 x i32> %offset, i32 %lod, i32 %layer) {
entry:
 %value = call <4 x float> @floor.opaque.read_image.texture2d.sampler.float.i2(%struct._texture_2d_t addrspace(1)* %tex, %struct._sampler_t addrspace(2)* %state, i64 193536, <2 x i32> %coordinate, i32 0, i32 0, <2 x i32> %offset, i32 %lod, float 0.0, i1 true, i1 false, i1 false, <2 x float> zeroinitializer, <2 x float> zeroinitializer, i1 false, i32 0, float 0.0, i1 false)
 ret <4 x float> %value
}
%struct._texture_3d_t = type opaque
declare <4 x float> @floor.opaque.read_image.texture3d.sampler.float.i3(%struct._texture_3d_t addrspace(1)*, %struct._sampler_t addrspace(2)*, i64, <3 x i32>, i32, i32, <3 x i32>, i32, float, i1, i1, i1, <3 x float>, <3 x float>, i1, i32, float, i1)

; CHECK-LABEL: define <4 x float> @sampler_read_3d(
; CHECK-NOT: add
; CHECK-NOT: @air.get_read_sampler
; CHECK: %[[READ39:[a-zA-Z0-9._]+]] = call { <4 x float>, i8 } @air.read_texture_3d.v4f32(%struct._texture_3d_t addrspace(1)* %tex, %struct._sampler_t addrspace(2)* {{[^,]*}}%state, <3 x i32> %coordinate, <3 x i32> %offset, i32 %lod, i32 0)
; CHECK: %[[COLOR39:[a-zA-Z0-9._]+]] = extractvalue { <4 x float>, i8 } %[[READ39]], 0
; CHECK: ret <4 x float> %[[COLOR39]]
define <4 x float> @sampler_read_3d(%struct._texture_3d_t addrspace(1)* %tex, %struct._sampler_t addrspace(2)* %state, <3 x i32> %coordinate, <3 x i32> %offset, i32 %lod, i32 %layer) {
entry:
 %value = call <4 x float> @floor.opaque.read_image.texture3d.sampler.float.i3(%struct._texture_3d_t addrspace(1)* %tex, %struct._sampler_t addrspace(2)* %state, i64 259072, <3 x i32> %coordinate, i32 0, i32 0, <3 x i32> %offset, i32 %lod, float 0.0, i1 true, i1 false, i1 false, <3 x float> zeroinitializer, <3 x float> zeroinitializer, i1 false, i32 0, float 0.0, i1 false)
 ret <4 x float> %value
}
%struct._texture_2d_array_t = type opaque
declare <4 x float> @floor.opaque.read_image.texture2d_array.sampler.float.i2(%struct._texture_2d_array_t addrspace(1)*, %struct._sampler_t addrspace(2)*, i64, <2 x i32>, i32, i32, <2 x i32>, i32, float, i1, i1, i1, <2 x float>, <2 x float>, i1, i32, float, i1)

; CHECK-LABEL: define <4 x float> @sampler_read_2d_array(
; CHECK-NOT: add
; CHECK-NOT: @air.get_read_sampler
; CHECK: %[[READ215:[a-zA-Z0-9._]+]] = call { <4 x float>, i8 } @air.read_texture_2d_array.v4f32(%struct._texture_2d_array_t addrspace(1)* %tex, %struct._sampler_t addrspace(2)* {{[^,]*}}%state, <2 x i32> %coordinate, i32 %layer, <2 x i32> %offset, i32 %lod, i32 0)
; CHECK: %[[COLOR215:[a-zA-Z0-9._]+]] = extractvalue { <4 x float>, i8 } %[[READ215]], 0
; CHECK: ret <4 x float> %[[COLOR215]]
define <4 x float> @sampler_read_2d_array(%struct._texture_2d_array_t addrspace(1)* %tex, %struct._sampler_t addrspace(2)* %state, <2 x i32> %coordinate, <2 x i32> %offset, i32 %lod, i32 %layer) {
entry:
 %value = call <4 x float> @floor.opaque.read_image.texture2d_array.sampler.float.i2(%struct._texture_2d_array_t addrspace(1)* %tex, %struct._sampler_t addrspace(2)* %state, i64 1242112, <2 x i32> %coordinate, i32 %layer, i32 0, <2 x i32> %offset, i32 %lod, float 0.0, i1 true, i1 false, i1 false, <2 x float> zeroinitializer, <2 x float> zeroinitializer, i1 false, i32 0, float 0.0, i1 false)
 ret <4 x float> %value
}

!air.language_version = !{!0}
!0 = !{!"Metal", i32 4, i32 1, i32 0}
