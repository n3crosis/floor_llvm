import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {msl41BitInterleaveCases,assertMSL41BitInterleaveIR,assertMSL41BitInterleaveArithmeticIR,bitInterleaveTypes,bitInterleaveInputs,bitListInterleave,bitListDeinterleave} from './msl41-bit-interleave.mjs';
import {evaluateBitInterleaveKernel,integerBytes} from './msl41-bit-interleave-ir.mjs';
const positive=(bits,form,mode='dynamic')=>msl41BitInterleaveCases.find(t=>t.status===0&&t.kind===1&&t.math===0&&t.bitInterleaveBits===bits&&t.bitInterleaveForm===form&&t.bitInterleaveMode===mode);

// Deliberately uses per-bit extraction, unlike the header's parallel masks.
// Fixtures test the validator itself; they are not claimed compiler output.
function fixture(bits,form,mode='dynamic') {
  const name=`msl41_${form}_${mode}_${bits}`,narrow=`i${bits}`,wide=`i${bits*2}`,vector=`<2 x ${narrow}>`;
  const narrowName={8:'uchar',16:'ushort',32:'uint'}[bits],wideName={8:'ushort',16:'uint',32:'ulong'}[bits];
  const input=form==='scalar'?narrow:form==='vector'?vector:wide,output=form==='deinterleave'?vector:wide;
  const inputName=form==='scalar'?narrowName:form==='vector'?narrowName+'2':wideName,outputName=form==='deinterleave'?narrowName+'2':wideName;
  const params=[...(mode==='dynamic'?[{type:input,name:'a',buffer:0,msl:inputName,size:form==='scalar'?bits/8:bits/4}]:[]),{type:output,name:'b',buffer:1,msl:outputName,size:bits/4}];
  const pointer=p=>`${p.type} addrspace(1)*`;
  let body=`target triple = "air64-apple-ios27.0.0"\n!llvm.module.flags = !{!0}\n!0 = !{i32 2, !"SDK Version", [2 x i32] [i32 27, i32 0]}\n!air.version = !{!1}\n!1 = !{i32 2, i32 9, i32 0}\n!air.language_version = !{!2}\n!2 = !{!"Metal", i32 4, i32 1, i32 0}\n!air.kernel = !{!3}\n!3 = !{void (${params.map(pointer).join(', ')})* @${name}, !4, !5}\n!4 = !{}\n!5 = !{${params.map((_,i)=>`!${i+6}`).join(', ')}}\n`;
  for(const [i,p] of params.entries())body+=`!${i+6} = !{i32 ${i}, !"air.buffer", !"air.location_index", i32 ${p.buffer}, i32 1, !"air.${p.name==='a'?'read':'read_write'}", !"air.address_space", i32 1, !"air.arg_type_size", i32 ${p.size}, !"air.arg_type_align_size", i32 ${p.size}, !"air.arg_type_name", !"${p.msl}", !"air.arg_name", !"${p.name}"}\n`;
  body+=`define void @${name}(${params.map(p=>`${pointer(p)} nocapture noundef %${p.name}`).join(', ')}) {\nentry:\n`;
  const append=line=>{body+=`  ${line}\n`;};
  if(mode==='constants') {
    const all=bitInterleaveInputs(bits),values=form==='deinterleave'?[...all.words.slice(0,6),...all.words.slice(-4)]:[...all.pairs.slice(0,12),...all.pairs.slice(-4)];
    const type=form==='deinterleave'?vector:wide;
    for(const [i,value] of values.entries()) {
      if(i)append(`%p${i} = getelementptr inbounds ${type}, ${type} addrspace(1)* %b, i32 ${i}`);
      const literal=form==='deinterleave'?`<${bitListDeinterleave(value,bits).map(x=>`${narrow} ${x}`).join(', ')}>`:bitListInterleave(...value,bits).toString();
      append(`store volatile ${type} ${literal}, ${type} addrspace(1)* ${i?`%p${i}`:'%b'}, align 1`);
    }
  } else {
    if(form==='scalar') {
      append(`%x = load volatile ${narrow}, ${narrow} addrspace(1)* %a, align 1`);
      append(`%p = getelementptr inbounds ${narrow}, ${narrow} addrspace(1)* %a, i32 1`);
      append(`%y = load volatile ${narrow}, ${narrow} addrspace(1)* %p, align 1`);
    } else if(form==='vector') {
      append(`%xy = load volatile ${vector}, ${vector} addrspace(1)* %a, align 1`);
      append(`%x = extractelement ${vector} %xy, i32 0`);
      append(`%y = extractelement ${vector} %xy, i32 1`);
    } else append(`%z = load volatile ${wide}, ${wide} addrspace(1)* %a, align 1`);
    if(form!=='deinterleave') {
      append(`%xw = zext ${narrow} %x to ${wide}`);append(`%yw = zext ${narrow} %y to ${wide}`);
      let previous='0';
      for(let i=0;i<bits;i++)for(const [lane,value] of ['%xw','%yw'].entries()) {
        const id=2*i+lane;
        append(`%s${id} = lshr ${wide} ${value}, ${i}`);
        append(`%m${id} = and ${wide} %s${id}, 1`);
        append(`%v${id} = shl ${wide} %m${id}, ${id}`);
        append(`%r${id} = or ${wide} ${previous}, %v${id}`);previous=`%r${id}`;
      }
      append(`store volatile ${wide} ${previous}, ${wide} addrspace(1)* %b, align 1`);
    } else {
      for(let lane=0;lane<2;lane++) {
        let previous='0';
        for(let i=0;i<bits;i++) {
          const id=2*i+lane;
          append(`%s${id} = lshr ${wide} %z, ${id}`);
          append(`%m${id} = and ${wide} %s${id}, 1`);
          append(`%v${id} = shl ${wide} %m${id}, ${i}`);
          append(`%r${id} = or ${wide} ${previous}, %v${id}`);previous=`%r${id}`;
        }
        append(`%n${lane} = trunc ${wide} ${previous} to ${narrow}`);
      }
      append(`%v0out = insertelement ${vector} poison, ${narrow} %n0, i32 0`);
      append(`%vout = insertelement ${vector} %v0out, ${narrow} %n1, i32 1`);
      append(`store volatile ${vector} %vout, ${vector} addrspace(1)* %b, align 1`);
    }
  }
  return body+'  ret void\n}\n';
}

test('bounded, unique API3/410 matrix covers every exact signature',()=>{
  assert.equal(msl41BitInterleaveCases.length,157);
  assert.equal(new Set(msl41BitInterleaveCases.map(t=>t.name)).size,157);
  assert.equal(msl41BitInterleaveCases.filter(t=>t.status===0).length,72);
  assert.equal(msl41BitInterleaveCases.filter(t=>t.status===3&&!t.bitInterleaveGate).length,49);
  assert.equal(msl41BitInterleaveCases.filter(t=>t.bitInterleaveGate).length,36);
  for(const t of msl41BitInterleaveCases)assert(Buffer.byteLength(t.source)<4096);
  for(const types of bitInterleaveTypes)for(const form of ['scalar','vector','deinterleave'])for(const mode of ['dynamic','constants'])for(const math of [0,1])for(const kind of [0,1]){
    const t=msl41BitInterleaveCases.filter(t=>t.bitInterleaveBits===types.bits&&t.bitInterleaveForm===form&&t.bitInterleaveMode===mode&&t.math===math&&t.kind===kind);
    assert.equal(t.length,1);assert.equal(t[0].api,3);assert.equal(t[0].metalVersion,410);assert.equal(t[0].ios,27);
    assert(t[0].source.includes('static_assert(__is_same(decltype('));
  }
  for(const api of [1,2,3])assert(msl41BitInterleaveCases.some(t=>t.bitInterleaveGate&&t.api===api));
});
test('public header uses only specified pairs and guards all new declarations',()=>{
  const header=readFileSync(new URL('../api/include/metal_integer',import.meta.url),'utf8');
  const block=header.split('// BEGIN MSL 4.1 bit interleave')[1].split('// END MSL 4.1 bit interleave')[0];
  assert.match(block,/#if defined\(__METAL_VERSION__\) && __METAL_VERSION__ >= 410/);
  assert.deepEqual([...block.matchAll(/^AIR_BIT_INTERLEAVE\((\w+), (\w+)\)$/gm)].map(m=>m.slice(1)),[['uchar','ushort'],['ushort','uint'],['uint','ulong']]);
  assert(!/\b__asm__\b|\bair\./.test(block));
  assert.equal([...block.matchAll(/= delete;/g)].length,3);
});
test('independent bit-list oracle has known exact lane and high-bit order',()=>{
  for(const bits of [8,16,32]) {
    const all=(1n<<BigInt(bits))-1n,wide=(1n<<BigInt(2*bits))-1n;
    assert.equal(bitListInterleave(all,0n,bits),wide/3n);
    assert.equal(bitListInterleave(0n,all,bits),2n*(wide/3n));
    assert.deepEqual(bitListDeinterleave(wide,bits),[all,all]);
    for(let bit=0;bit<bits;bit++) {
      assert.equal(bitListInterleave(1n<<BigInt(bit),0n,bits),1n<<BigInt(2*bit));
      assert.equal(bitListInterleave(0n,1n<<BigInt(bit),bits),1n<<BigInt(2*bit+1));
    }
  }
  assert.equal(bitListInterleave(0x89abcdefn,0x01234567n,32),0x40434c4f70737c7fn);
  assert.deepEqual(bitListDeinterleave(0x8000000000000001n,32),[1n,0x80000000n]);
  assert.throws(()=>bitListInterleave(-1n,0n,8));assert.throws(()=>bitListDeinterleave(65536n,8));
});
test('all 65536 16-bit words round trip through the reference oracle',()=>{
  for(let value=0n;value<65536n;value++)assert.equal(bitListInterleave(...bitListDeinterleave(value,8),8),value);
});
test('dynamic input corpus includes boundaries, every bit, and repeatable random values',()=>{
  for(const bits of [8,16,32]) {
    const a=bitInterleaveInputs(bits),b=bitInterleaveInputs(bits);assert.deepEqual(a,b);
    assert.equal(a.pairs.length,44+2*bits);assert.equal(a.words.length,38+2*bits);
    assert(a.pairs.some(([x,y])=>x>=(1n<<BigInt(bits-1))&&y>=(1n<<BigInt(bits-1))));
    assert(a.words.some(x=>x>=(1n<<BigInt(2*bits-1))));
  }
});
for(const bits of [8,16,32])test(`validator checks all dynamic/folded ${bits}-bit forms`,()=>{
  for(const form of ['scalar','vector','deinterleave'])for(const mode of ['dynamic','constants'])
    assertMSL41BitInterleaveIR(fixture(bits,form,mode),positive(bits,form,mode));
});
test('validator rejects wrong bit order, inputs, masks, lanes, and destinations',()=>{
  const scalar=fixture(32,'scalar'),vector=fixture(32,'vector'),deinterleave=fixture(32,'deinterleave');
  const mutations=[
    [scalar.replace('lshr i64 %xw, 0','lshr i64 %yw, 0'),'scalar'],
    [scalar.replace('shl i64 %m1, 1','shl i64 %m1, 0'),'scalar'],
    [scalar.replace('and i64 %s0, 1','and i64 %s0, 0'),'scalar'],
    [scalar.replace('i64 %r63, i64 addrspace(1)* %b','i64 %r61, i64 addrspace(1)* %b'),'scalar'],
    [scalar.replace('i32 1\n','i32 0\n'),'scalar'],
    [vector.replace('extractelement <2 x i32> %xy, i32 1','extractelement <2 x i32> %xy, i32 0'),'vector'],
    [deinterleave.replace('i32 %n1, i32 1','i32 %n0, i32 1'),'deinterleave'],
    [deinterleave.replace('i32 %n0, i32 0','i32 %n0, i32 1'),'deinterleave'],
  ];
  for(const [bad,form] of mutations)assert.throws(()=>assertMSL41BitInterleaveIR(bad,positive(32,form)));
});
test('validator rejects missing stores, undefined bytes, extra calls, and unmodeled effects',()=>{
  const ir=fixture(8,'scalar'),t=positive(8,'scalar');
  for(const bad of [ir.replace('!air.kernel','!other'),ir.replace('msl41_scalar_dynamic_8','wrong'),ir.replace(/  store .*\n/,''),ir.replace('i16 %r15, i16 addrspace(1)* %b','i16 poison, i16 addrspace(1)* %b'),ir.replace('store volatile','store'),ir.replace('shl i16 %m0, 0','shl i16 %m0, 16'),ir.replace('  ret void','  br label %next\nnext:\n  ret void'),ir+'\n%result = call i16 @air.fake(i16 1)',ir+'\n%x = uitofp i16 1 to float',ir.replace('  ret void',''),ir.replace('i16 addrspace(1)* %b','i16 addrspace(1)* %a')])
    assert.throws(()=>assertMSL41BitInterleaveIR(bad,t));
  assert.throws(()=>assertMSL41BitInterleaveIR('x'.repeat(2*1024*1024),t));
  assert.throws(()=>assertMSL41BitInterleaveIR(ir,{...t,metalVersion:400}));
});
test('constant validation detects data changes and missing/duplicate stores',()=>{
  const ir=fixture(32,'deinterleave','constants'),t=positive(32,'deinterleave','constants');
  for(const bad of [ir.replace('<i32 0, i32 0>','<i32 0, i32 1>'),ir.replace('i32 1\n','i32 0\n'),ir.replace(/  store .*\n/,''),ir.replace('i32 4294967295, i32 4294967295','i32 2147483647, i32 4294967295')])assert.throws(()=>assertMSL41BitInterleaveIR(bad,t));
});
test('qualification binds exact formal ABI, kernel metadata, and buffer records',()=>{
  const ir=fixture(16,'vector'),t=positive(16,'vector');
  const params='<2 x i16> addrspace(1)* nocapture noundef %a, i32 addrspace(1)* nocapture noundef %b';
  const bad=[
    ir.replace(params,'i32 addrspace(1)* nocapture noundef %b, <2 x i16> addrspace(1)* nocapture noundef %a'),
    ir.replace(params,params.replace('<2 x i16>','i32')),
    ir.replace(params,params.replace('addrspace(1)','addrspace(2)')),
    ir.replace(params,params.replace('%a','%other')),
    ir.replace('!5 = !{!6, !7}','!5 = !{!7, !6}'),
    ir.replace('!5 = !{!6, !7}','!5 = !{!6}'),
    ir.replace('!4 = !{}','!4 = !{i32 0}'),
    ir.replace('!air.kernel = !{!3}','!air.kernel = !{!4}'),
    ir.replace(')* @msl41_vector_dynamic_16, !4',')* @wrong, !4'),
    ir.replace('void (<2 x i16> addrspace(1)*, i32 addrspace(1)*)*','void (i32 addrspace(1)*, <2 x i16> addrspace(1)*)*'),
    ir.replace('!"air.location_index", i32 1, i32 1','!"air.location_index", i32 0, i32 1'),
    ir.replace('!"air.location_index", i32 1, i32 1','!"air.location_index", i32 1, i32 2'),
    ir.replace('!7 = !{i32 1,','!7 = !{i32 0,'),
    ir.replace('!"air.read_write"','!"air.read"'),
    ir.replace('!"air.address_space", i32 1','!"air.address_space", i32 2'),
    ir.replace('!"air.arg_type_size", i32 4','!"air.arg_type_size", i32 8'),
    ir.replace('!"air.arg_type_align_size", i32 4','!"air.arg_type_align_size", i32 2'),
    ir.replace('!"air.arg_type_name", !"ushort2"','!"air.arg_type_name", !"uint"'),
    ir.replace('!"air.arg_name", !"b"','!"air.arg_name", !"a"'),
    ir+'\n!7 = !{}\n',
  ];
  for(const mutated of bad)assert.throws(()=>assertMSL41BitInterleaveIR(mutated,t));
  const constant=fixture(16,'vector','constants'),ct=positive(16,'vector','constants');
  assertMSL41BitInterleaveIR(constant,ct);
  assert.throws(()=>assertMSL41BitInterleaveIR(constant.replace('!6 = !{i32 0,','!6 = !{i32 1,'),ct));
  assert.throws(()=>assertMSL41BitInterleaveIR(constant.replace('!"air.location_index", i32 1, i32 1','!"air.location_index", i32 0, i32 1'),ct));
});
test('qualification checks actual linked mode/target/SDK metadata; preflight is separate',()=>{
  const ir=fixture(8,'scalar'),t=positive(8,'scalar');
  for(const bad of [
    ir.replace('ios27.0.0','ios26.0.0'),
    ir.replace('!1 = !{i32 2, i32 9, i32 0}','!1 = !{i32 2, i32 8, i32 0}'),
    ir.replace('!2 = !{!"Metal", i32 4, i32 1, i32 0}','!2 = !{!"Metal", i32 1, i32 0, i32 0}'),
    ir.replace('!air.language_version = !{!2}','!air.language_version = !{!1}'),
    ir.replace('!air.version = !{!1}','!air.version = !{!2}'),
    ir.replace('[i32 27, i32 0]','[i32 26, i32 0]'),
    ir.replace('!llvm.module.flags = !{!0}','!llvm.module.flags = !{}'),
    ir+'\n!air.language_version = !{!2}\n',
    ir+'\ntarget triple = "air64-apple-ios27.0.0"\n',
    ir+'\n!99 = !{i32 2, !"SDK Version", [2 x i32] [i32 27, i32 0]}\n',
  ])assert.throws(()=>assertMSL41BitInterleaveIR(bad,t));
  const old=ir.replace('ios27.0.0','ios26.0.0').replace('[i32 27, i32 0]','[i32 26, i32 0]').replace('i32 2, i32 9, i32 0','i32 2, i32 7, i32 0').replace('!"Metal", i32 4, i32 1, i32 0','!"Metal", i32 3, i32 2, i32 0');
  assert.throws(()=>assertMSL41BitInterleaveIR(old,t));
  assertMSL41BitInterleaveArithmeticIR(old,t);
  assert.throws(()=>assertMSL41BitInterleaveArithmeticIR(old.replace('!"air.location_index", i32 1, i32 1','!"air.location_index", i32 0, i32 1'),t));
});
test('SSA evaluator permits dead poison lanes but rejects stored poison and overflow',()=>{
  const body=`define void @test() {\nentry:\n%v = shl <2 x i32> <i32 1, i32 1>, <i32 0, i32 32>\n%x = extractelement <2 x i32> %v, i32 0\nstore volatile i32 %x, i32 addrspace(1)* %b, align 4\nret void\n}`;
  assert.deepEqual(evaluateBitInterleaveKernel(body,[],4),integerBytes([1n],32));
  assert.throws(()=>evaluateBitInterleaveKernel(body.replace('%v, i32 0','%v, i32 1'),[],4));
  for(const instruction of ['add nuw i32 4294967295, 1','add nsw i32 2147483647, 1','lshr exact i32 3, 1']) {
    const wrong=`define void @test() {\nentry:\n%x = ${instruction}\nstore volatile i32 %x, i32 addrspace(1)* %b, align 4\nret void\n}`;
    assert.throws(()=>evaluateBitInterleaveKernel(wrong,[],4));
  }
});
