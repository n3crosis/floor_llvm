// RUN: %clang_cc1 -triple air64-apple-ios18.0.0 -x metal -std=metal3.2 -E -dM %s | FileCheck %s --check-prefix=MSL32
// RUN: %clang_cc1 -triple air64-apple-ios26.0.0 -x metal -std=metal4.0 -E -dM %s | FileCheck %s --check-prefix=MSL40
// RUN: %clang_cc1 -triple air64-apple-ios27.0.0 -x metal -std=metal4.1 -E -dM %s | FileCheck %s --check-prefix=MSL41
// RUN: %clang_cc1 -triple air64-apple-ios26.0.0 -x metal -std=metal3.2 -E -dM %s | FileCheck %s --check-prefix=MSL32
// MSL32: #define __METAL_VERSION__ 320
// MSL32: #define __METAL__ 1
// MSL40: #define __METAL_VERSION__ 400
// MSL40: #define __METAL__ 1
// MSL41: #define __METAL_VERSION__ 410
// MSL41: #define __METAL__ 1
// MSL41: #define __cplusplus 201703L
