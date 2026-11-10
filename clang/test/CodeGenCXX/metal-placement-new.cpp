// RUN: %clang_cc1 -triple air64-apple-ios27.0.0 -x metal -std=metal4.1 -I %S/../../../wasm/api/include -O2 -emit-llvm -o - %s | FileCheck %s
#include <metal_common>
using namespace metal;

// No allocation function call, new-result null check, or address-space cast.
// CHECK-LABEL: define {{.*}}device_scalar
// CHECK-NOT: call
// CHECK-NOT: icmp
// CHECK-NOT: addrspacecast
// CHECK: store volatile i32 7, i32 addrspace(1)*
// CHECK: ret i32 addrspace(1)*
device volatile uint *device_scalar(device void *p) {
  return new (p) device volatile uint(7);
}
// CHECK-LABEL: define {{.*}}group_scalar
// CHECK-NOT: call
// CHECK-NOT: icmp
// CHECK-NOT: addrspacecast
// CHECK: store volatile i32 7, i32 addrspace(3)*
// CHECK: ret i32 addrspace(3)*
threadgroup volatile uint *group_scalar(threadgroup void *p) {
  return new (p) threadgroup volatile uint(7);
}
// CHECK-LABEL: define {{.*}}thread_scalar
// CHECK-NOT: call
// CHECK-NOT: icmp
// CHECK-NOT: addrspacecast
// CHECK: store volatile i32 7, i32*
// CHECK: ret i32*
thread volatile uint *thread_scalar(thread void *p) {
  return new (p) thread volatile uint(7);
}
struct Item {
  volatile uint value;
  Item() device : value(7) {}
  ~Item() device { value = 19; }
};
// Nontrivial destructor must not introduce an 8-byte array cookie.
// CHECK-LABEL: define {{.*}}device_array
// CHECK-NOT: store i64
// CHECK-NOT: call
// CHECK-NOT: icmp
// CHECK: getelementptr inbounds %struct.Item, %struct.Item addrspace(1)* {{.*}}, i{{32|64}} 0, i32 0
// CHECK: store volatile i32 7, i32 addrspace(1)*
// CHECK: getelementptr inbounds %struct.Item, %struct.Item addrspace(1)* {{.*}}, i{{32|64}} 1, i32 0
// CHECK: store volatile i32 7, i32 addrspace(1)*
// CHECK-NOT: store i64
// CHECK: ret %struct.Item addrspace(1)*
device Item *device_array(device Item *p) { return new (p) device Item[2]; }

// CHECK-LABEL: define {{.*}}lifetime
// CHECK: store volatile i32 7
// CHECK: store volatile i32 19
// CHECK: store volatile i32 7
// CHECK: store volatile i32 19
// CHECK: ret void
void lifetime(device Item *storage) {
  device Item *p = new (storage) device Item;
  p->~Item();
  p = new (storage) device Item;
  p->~Item();
}
struct alignas(32) Aligned { volatile uint value; Aligned(uint x) device : value(x) {} };
// CHECK-LABEL: define {{.*}}aligned
// CHECK-NOT: call
// CHECK: store volatile i32 17, i32 addrspace(1)* {{.*}}, align 32
// CHECK: ret %struct.Aligned addrspace(1)*
device Aligned *aligned(device Aligned *p) { return new (p) device Aligned(17); }
