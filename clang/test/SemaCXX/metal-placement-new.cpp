// RUN: %clang_cc1 -triple air64-apple-ios27.0.0 -x metal -std=metal4.1 -I %S/../../../wasm/api/include -fsyntax-only -verify %s
// RUN: %clang_cc1 -triple air64-apple-ios26.0.0 -x metal -std=metal4.0 -I %S/../../../wasm/api/include -fsyntax-only -verify=old %s
#include <metal_common>
using namespace metal;

#if __METAL_VERSION__ < 410
void old_mode(device uint *p) {
  new (p) device uint(7); // old-error {{placement new requires Metal 4.1}}
  new (p) device uint[2]; // old-error {{placement new requires Metal 4.1}}
}
#else
struct ThreadItem { volatile uint value; ThreadItem(uint x) thread : value(x) {} ~ThreadItem() thread { value=19; } };
struct GroupItem { volatile uint value; GroupItem(uint x) threadgroup : value(x) {} ~GroupItem() threadgroup { value=19; } };
struct DeviceItem { volatile uint value; DeviceItem(uint x) device : value(x) {} ~DeviceItem() device { value=19; } };
struct alignas(32) Aligned { uint x; };
void valid(thread void *t, threadgroup void *g, device void *d) {
  thread ThreadItem *a = new (t) thread ThreadItem(7);
  threadgroup GroupItem *b = new (g) threadgroup GroupItem(7);
  device DeviceItem *c = new (d) device DeviceItem(7);
  a->~ThreadItem(); b->~GroupItem(); c->~DeviceItem();
  a = new (t) thread ThreadItem(11);
  b = new (g) threadgroup GroupItem(11);
  c = new (d) device DeviceItem(11);
  a->~ThreadItem(); b->~GroupItem(); c->~DeviceItem();
  auto ta = new (t) thread uint[2]{7, 11};
  auto ga = new (g) threadgroup uint[2]{7, 11};
  auto da = new (d) device uint[2]{7, 11};
  static_assert(__is_same(decltype(ta), thread uint*), "thread result");
  static_assert(__is_same(decltype(ga), threadgroup uint*), "threadgroup result");
  static_assert(__is_same(decltype(da), device uint*), "device result");
  auto aligned = new (d) device Aligned{7};
  static_assert(alignof(Aligned) == 32, "alignment");
}

template<class T> device T *construct(device void *p) {
  return new (p) device T(7);
}
void valid_template(device void *p) { construct<uint>(p); }

void invalid(device uint *p, uint count) {
  new uint; // expected-error {{dynamic allocation is not permitted in Metal 4.1}}
  new uint[2]; // expected-error {{dynamic allocation is not permitted in Metal 4.1}}
  delete p; // expected-error {{delete is not permitted in Metal 4.1}}
  delete[] p; // expected-error {{delete is not permitted in Metal 4.1}}
  new (p) uint; // expected-error {{requires an explicitly thread, threadgroup, or device qualified allocated type}}
  new (p) constant uint(7); // expected-error {{requires an explicitly thread, threadgroup, or device qualified allocated type}}
  new (p) threadgroup uint(7); // expected-error {{requires the standard storage-pointer overload in the allocated address space}}
  new (p, 0) device uint; // expected-error {{requires exactly one storage pointer}}
  new (p) device uint[count]; // expected-error {{runtime-bound placement arrays are not supported}}
}

struct Custom {
  static device void *operator new(size_t, device void *p) { return p; }
};
void reject_class_allocator(device void *p) {
  new (p) device Custom; // expected-error {{requires the standard storage-pointer overload in the allocated address space}}
}
#endif
