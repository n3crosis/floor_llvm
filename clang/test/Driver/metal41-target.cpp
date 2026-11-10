// RUN: %clang_cc1 -triple air64-apple-ios27.0.0 -x metal -std=metal4.1 -fsyntax-only %s
// RUN: %clang_cc1 -triple air64-apple-macosx27.0.0 -x metal -std=metal4.1 -fsyntax-only %s
// RUN: %clang_cc1 -triple air64-apple-tvos27.0.0 -x metal -std=metal4.1 -fsyntax-only %s
// RUN: %clang_cc1 -triple air64-apple-xros27.0.0 -x metal -std=metal4.1 -fsyntax-only %s
// RUN: not %clang_cc1 -triple air64-apple-ios26.0.0 -x metal -std=metal4.1 -fsyntax-only %s 2>&1 | FileCheck %s
// RUN: not %clang_cc1 -triple air64-apple-macosx26.0.0 -x metal -std=metal4.1 -fsyntax-only %s 2>&1 | FileCheck %s
// RUN: not %clang_cc1 -triple air64-apple-darwin27.0.0 -x metal -std=metal4.1 -fsyntax-only %s 2>&1 | FileCheck %s
// RUN: not %clang_cc1 -triple x86_64-unknown-linux-gnu -x metal -std=metal4.1 -fsyntax-only %s 2>&1 | FileCheck %s
// CHECK: Metal 4.1 requires an AIR target for iOS, tvOS, macOS, or visionOS 27 or later
static_assert(__METAL_VERSION__ == 410, "actual language version");
static_assert(__cplusplus == 201703L, "MSL 4.1 C++17 baseline");
