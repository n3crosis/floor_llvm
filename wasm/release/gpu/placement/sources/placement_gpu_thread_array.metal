// Original authored placement GPU probe. MSL4.1 / iOS27, conservative math.
// Input: six uint words. Output: 32 uint words; host guards precede/follow it.
// Arena: 64 bytes, placement starts at byte16. Payload is8 or16 bytes; all
// surrounding bytes are canaries. Extra suffix capacity safely catches old
// eight-byte cookie/pointer-adjustment regressions rather than overrunning storage.
#include <metal_stdlib>
using namespace metal;
struct Item_thread {
  volatile uint value; volatile uint stamp;
  Item_thread() thread : value(0x13579bdfu), stamp(0x2468ace0u) {}
  Item_thread(uint v,uint s) thread : value(v), stamp(s) {}
  ~Item_thread() thread { value=value^0xa5a5a5a5u; stamp=stamp+0x10203040u; }
};
static_assert(sizeof(Item_thread)==8 && alignof(Item_thread)==4,"placement record layout");
uint placement_word(const thread uchar* p,uint o) {
  return uint(p[o]) | (uint(p[o+1])<<8) | (uint(p[o+2])<<16) | (uint(p[o+3])<<24);
}
kernel void placement_gpu_thread_array(device const uint* input [[buffer(0)]], device uint* out [[buffer(1)]]) {
  alignas(4) thread uchar arena[64];
  // Exactly one thread is dispatched. Shared storage never has concurrent users.
  for(uint i=0;i<64;++i) arena[i]=uchar((i*37u)^input[0]^(input[5]>>8)^0x5au);
  thread uchar* base=arena+16;
  thread Item_thread* p=new(base) thread Item_thread[2];
  out[0]=0x504c4143u; out[1]=2u; out[2]=p==(thread Item_thread*)base;
  out[3]=sizeof(Item_thread); out[4]=alignof(Item_thread);
  out[5]=p[0].value; out[6]=p[0].stamp;
  out[7]=p[1].value; out[8]=p[1].stamp;
  p[0].~Item_thread(); p[1].~Item_thread();
  // Inspect only unsigned-char storage representation after lifetime ends.
  // Never access a dead Item's fields or call its members.
  out[9]=placement_word(base,0); out[10]=placement_word(base,4);
  out[11]=placement_word(base,8); out[12]=placement_word(base,12);
  thread Item_thread* a=new(base) thread Item_thread(input[2],input[3]);
  thread Item_thread* b=new(base+8) thread Item_thread(input[4],input[5]);
  out[13]=a==(thread Item_thread*)base;
  out[14]=b==(thread Item_thread*)(base+8);
  out[15]=a->value ^ b->value;
  a->~Item_thread(); b->~Item_thread();
  for(uint i=0;i<16;++i) out[16+i]=placement_word(arena,i*4);
}
