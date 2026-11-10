// Original authored placement GPU probe. MSL4.1 / iOS27, conservative math.
// Input: six uint words. Output: 32 uint words; host guards precede/follow it.
// Arena: 64 bytes, placement starts at byte16. Payload is8 or16 bytes; all
// surrounding bytes are canaries. Extra suffix capacity safely catches old
// eight-byte cookie/pointer-adjustment regressions rather than overrunning storage.
#include <metal_stdlib>
using namespace metal;
struct Item_threadgroup {
  volatile uint value; volatile uint stamp;
  Item_threadgroup() threadgroup : value(0x13579bdfu), stamp(0x2468ace0u) {}
  Item_threadgroup(uint v,uint s) threadgroup : value(v), stamp(s) {}
  ~Item_threadgroup() threadgroup { value=value^0xa5a5a5a5u; stamp=stamp+0x10203040u; }
};
static_assert(sizeof(Item_threadgroup)==8 && alignof(Item_threadgroup)==4,"placement record layout");
uint placement_word(const threadgroup uchar* p,uint o) {
  return uint(p[o]) | (uint(p[o+1])<<8) | (uint(p[o+2])<<16) | (uint(p[o+3])<<24);
}
kernel void placement_gpu_threadgroup_array(device const uint* input [[buffer(0)]], device uint* out [[buffer(1)]], threadgroup uchar* arena [[threadgroup(0)]]) {
  
  // Exactly one thread is dispatched. Shared storage never has concurrent users.
  for(uint i=0;i<64;++i) arena[i]=uchar((i*37u)^input[0]^(input[5]>>8)^0x5au);
  threadgroup uchar* base=arena+16;
  threadgroup Item_threadgroup* p=new(base) threadgroup Item_threadgroup[2];
  out[0]=0x504c4143u; out[1]=2u; out[2]=p==(threadgroup Item_threadgroup*)base;
  out[3]=sizeof(Item_threadgroup); out[4]=alignof(Item_threadgroup);
  out[5]=p[0].value; out[6]=p[0].stamp;
  out[7]=p[1].value; out[8]=p[1].stamp;
  p[0].~Item_threadgroup(); p[1].~Item_threadgroup();
  // Inspect only unsigned-char storage representation after lifetime ends.
  // Never access a dead Item's fields or call its members.
  out[9]=placement_word(base,0); out[10]=placement_word(base,4);
  out[11]=placement_word(base,8); out[12]=placement_word(base,12);
  threadgroup Item_threadgroup* a=new(base) threadgroup Item_threadgroup(input[2],input[3]);
  threadgroup Item_threadgroup* b=new(base+8) threadgroup Item_threadgroup(input[4],input[5]);
  out[13]=a==(threadgroup Item_threadgroup*)base;
  out[14]=b==(threadgroup Item_threadgroup*)(base+8);
  out[15]=a->value ^ b->value;
  a->~Item_threadgroup(); b->~Item_threadgroup();
  for(uint i=0;i<16;++i) out[16+i]=placement_word(arena,i*4);
}
