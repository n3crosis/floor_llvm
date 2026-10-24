; RUN: opt -passes=sroa -S < %s | FileCheck %s
; RUN: opt -opaque-pointers -passes=sroa -S < %s | FileCheck %s

; The alloca's allocated type remains available with opaque pointers. The
; floor NPOT-hole helper must inspect that type, not the pointer's element type.
; Both allocas below require SROA rather than direct scalar promotion.

target datalayout = "e-p:64:64-i32:32-n8:16:32:64"

define i32 @struct_allocated_type() {
; CHECK-LABEL: @struct_allocated_type(
; CHECK-NOT: alloca
; CHECK: ret i32 7
  %a = alloca { i32, i32 }, align 4
  %field = getelementptr { i32, i32 }, { i32, i32 }* %a, i32 0, i32 1
  store i32 7, i32* %field, align 4
  %value = load i32, i32* %field, align 4
  ret i32 %value
}

define i32 @array_allocated_type() {
; CHECK-LABEL: @array_allocated_type(
; CHECK-NOT: alloca
; CHECK: ret i32 9
  %a = alloca [2 x i32], align 4
  %element = getelementptr [2 x i32], [2 x i32]* %a, i32 0, i32 1
  store i32 9, i32* %element, align 4
  %value = load i32, i32* %element, align 4
  ret i32 %value
}
