import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {samplerReadGeometries,msl41TextureReadCases,assertMSL41TextureReadIR,assertMSL41TextureReadDiagnostic,splitIRArguments} from './msl41-texture-read.mjs';
const select=(g,mode)=>msl41TextureReadCases.find(t=>t.kind===1&&t.status===0&&t.textureGeometry===g.type&&t.textureReadMode===mode);
function fixture(g,mode) {
 const v=`<${g.width} x i32>`,tex=`%struct._texture_${g.air}_t addrspace(1)*`,sampler='%struct._sampler_t addrspace(2)*';
 const args=['%struct.Resources addrspace(2)* nocapture readonly align 8 dereferenceable(24) %resources',`${v} addrspace(1)* nocapture readonly %coords`,`${v} addrspace(1)* nocapture readonly %offsets`,'i32 addrspace(2)* nocapture readonly %lod','<4 x float> addrspace(1)* nocapture %out',...(g.array?['i32 addrspace(2)* readonly %layer']:[])];
 const entry=`msl41_read_${g.type}_${mode}`;
 const q=mode==='boundaries'?(g.width===3?'<i32 -2, i32 4, i32 -1>':'<i32 -2, i32 4>'):'%q';
 const o=mode==='defaults'?'zeroinitializer':mode==='boundaries'?(g.width===3?'<i32 -8, i32 7, i32 1>':'<i32 -8, i32 7>'):'%o';
 const call=s=>`call { <4 x float>, i8 } @air.read_texture_${g.air}.v4f32(${tex} %tex, ${sampler} ${s}, ${v} ${q}, ${g.array?'i32 %a, ':''}${v} ${s==='%state'?o:'zeroinitializer'}, i32 ${mode==='defaults'?'0':'%l'}, i32 0)`;
 return `target triple = "air64-apple-ios27.0.0"\n%struct.Resources = type { [8 x i8], %"struct.metal::${g.type}", ${sampler} }\n%"struct.metal::${g.type}" = type { ${tex} }\n%struct._texture_${g.air}_t = type opaque\n%struct._sampler_t = type opaque\ndefine void @${entry}(${args.join(', ')}) local_unnamed_addr #0 {\nentry:\n`+
  `  %texptr = getelementptr inbounds %struct.Resources, %struct.Resources addrspace(2)* %resources, i32 0, i32 1, i32 0\n  %tex = load ${tex}, ${tex} addrspace(2)* %texptr, align 8\n  %stateptr = getelementptr inbounds %struct.Resources, %struct.Resources addrspace(2)* %resources, i32 0, i32 2\n  %state = load ${sampler}, ${sampler} addrspace(2)* %stateptr, align 8\n`+
  (mode!=='boundaries'?`  %q = load ${v}, ${v} addrspace(1)* %coords, align 16\n`:'')+
  (!['boundaries','defaults'].includes(mode)?`  %o = load ${v}, ${v} addrspace(1)* %offsets, align 16\n`:'')+
  (mode!=='defaults'?'  %l = load i32, i32 addrspace(2)* %lod, align 4\n':'')+
  (g.array?'  %a = load i32, i32 addrspace(2)* %layer, align 4\n':'')+
  `  %read = ${call('%state')}\n  %value = extractvalue { <4 x float>, i8 } %read, 0\n  store <4 x float> %value, <4 x float> addrspace(1)* %out, align 16\n`+
  (mode==='mixed'?`  %readsampler = call ${sampler} @air.get_read_sampler()\n  %old = ${call('%readsampler')}\n  %oldcolor = extractvalue { <4 x float>, i8 } %old, 0\n  %dest = getelementptr inbounds <4 x float>, <4 x float> addrspace(1)* %out, i32 1\n  store <4 x float> %oldcolor, <4 x float> addrspace(1)* %dest, align 16\n`:'')+
  `  ret void\n}\n!air.version = !{!0}\n!air.language_version = !{!1}\n!llvm.module.flags = !{!2}\n!air.kernel = !{!3}\n!0 = !{i32 2, i32 9, i32 0}\n!1 = !{!"Metal", i32 4, i32 1, i32 0}\n!2 = !{i32 2, !"SDK Version", [2 x i32] [i32 27, i32 0]}\n!3 = !{void (${args.map(a=>a.replace(/(?: nocapture| readonly)?(?: nocapture| readonly)? %[\w.]+$/,'')).join(', ')})* @${entry}, !4, !5}\n!4 = !{}\n!5 = !{${args.map((_,i)=>'!'+(i+6)).join(', ')}}\n!6 = !{i32 0, !"air.indirect_buffer", !"air.buffer_size", i32 24, !"air.location_index", i32 0, i32 1, !"air.read", !"air.address_space", i32 2, !"air.struct_type_info", !20, !"air.arg_type_size", i32 24, !"air.arg_type_align_size", i32 8, !"air.arg_type_name", !"Resources", !"air.arg_name", !"resources"}\n!20 = !{i32 8, i32 8, i32 0, !"${g.type}<float, sample>", !"tex", !"air.indirect_argument", !21, i32 16, i32 8, i32 0, !"sampler", !"state", !"air.indirect_argument", !22}\n!21 = !{i32 0, !"air.texture", !"air.location_index", i32 1, i32 1, !"air.sample", !"air.arg_type_name", !"${g.type}<float, sample>", !"air.arg_name", !"tex"}\n!22 = !{i32 1, !"air.sampler", !"air.location_index", i32 2, i32 1, !"air.arg_type_name", !"sampler", !"air.arg_name", !"state"}\n`+
  [['coords',1,`int${g.width}`,g.width*4,g.width===3?16:8,'read'],['offsets',1,`int${g.width}`,g.width*4,g.width===3?16:8,'read'],['lod',2,'uint',4,4,'read'],['out',1,'float4',16,16,'read_write'],...(g.array?[['layer',2,'uint',4,4,'read']]:[])].map(([name,space,type,size,align,access],i)=>`!${i+7} = !{i32 ${i+1}, !"air.buffer", !"air.location_index", i32 ${i+1}, i32 1, !"air.${access}", !"air.address_space", i32 ${space}, !"air.arg_type_size", i32 ${size}, !"air.arg_type_align_size", i32 ${align}, !"air.arg_type_name", !"${type}", !"air.arg_name", !"${name}"}`).join('\n')+'\n' ;
}
test('generic inventory covers all shapes, modes, profiles, output kinds and address spaces',()=>{
 assert.equal(msl41TextureReadCases.length,71);assert.equal(new Set(msl41TextureReadCases.map(t=>t.name)).size,71);
 for(const g of samplerReadGeometries)for(const mode of ['dynamic','defaults','boundaries','mixed'])for(const math of [0,1])for(const kind of [0,1]) {
  const t=msl41TextureReadCases.find(t=>t.textureGeometry===g.type&&t.textureReadMode===mode&&t.math===math&&t.kind===kind);assert(t);
  for(const space of ['thread','device','constant','threadgroup'])assert(t.source.includes('check_'+space+'('));
 }
 for(const t of msl41TextureReadCases)assert(Buffer.byteLength(t.source)<4096);
});
for(const g of samplerReadGeometries)for(const mode of ['dynamic','defaults','boundaries','mixed'])test(`checks exact ${g.type} ${mode} read dataflow`,()=>assertMSL41TextureReadIR(fixture(g,mode),select(g,mode)));
test('validator rejects ABI, operand, mode, and metadata mutations',()=>{
 const g=samplerReadGeometries[0],t=select(g,'dynamic'),text=fixture(g,'dynamic');
 const mutations=[
  text.replace('ios27','ios26'),text.replace('i32 9','i32 7'),text.replace('i32 4, i32 1','i32 4, i32 0'),
  text.replace('i32 27, i32 0','i32 26, i32 0'),text.replace('%state, <2 x i32>','%unused, <2 x i32>'),
  text.replace('%tex, %struct','%wrong, %struct'),text.replace('<2 x i32> %q, <2 x i32> %o','<2 x i32> %o, <2 x i32> %q'),
  text.replace('<2 x i32> %o, i32 %l','<2 x i32> zeroinitializer, i32 %l'),text.replace('i32 %l, i32 0','i32 0, i32 0'),
  text.replace('i32 %l, i32 0','i32 %l, i32 1'),text.replace('store <4 x float> %value','store <4 x float> zeroinitializer'),
  text.replace('} %read, 0','} %read, 1'),text.replace('} %read, 0','} %wrong, 0'),
  text.replace('addrspace(1)* %out, align','addrspace(1)* %wrong, align'),text.replace('air.read_texture_2d.v4f32','air.sample_texture_2d.v4f32'),
  text.replace('!"air.location_index", i32 2','!"air.location_index", i32 3'),text.replace('!"air.sample"','!"air.read"'),
  text.replace('!air.kernel = !{!3}','!air.kernel = !{!6}'),text.replace('!5 = !{!6, !7','!5 = !{!7, !6'),
  text.replace('!7 =','!70 ='),text+'!air.kernel = !{!3}\n',text+'!6 = !{}\n',
 ];
 for(const [i,mutant] of mutations.entries()){assert.notEqual(mutant,text);assert.throws(()=>assertMSL41TextureReadIR(mutant,t),undefined,'mutation '+i);}
});
test('constant offsets and coordinates are independently checked',()=>{
 for(const g of samplerReadGeometries){const t=select(g,'boundaries'),text=fixture(g,'boundaries');
  for(const [a,b] of [['i32 -8','i32 -7'],['i32 7','i32 0'],['i32 -2','i32 0']])assert.throws(()=>assertMSL41TextureReadIR(text.replace(a,b),t));
 }
});
test('array layer must preserve its independent buffer',()=>{
 const g=samplerReadGeometries[1],t=select(g,'dynamic'),text=fixture(g,'dynamic');
 assert.throws(()=>assertMSL41TextureReadIR(text.replace('i32 %a, <2','i32 %l, <2'),t));
});
test('diagnostics reject unrelated failures',()=>{
 for(const t of msl41TextureReadCases.filter(t=>t.status===3)){assert(t.diagnosticPattern);assert.throws(()=>assertMSL41TextureReadDiagnostic('unrelated build failure',t));}
});
test('argument tokenizer does not split vector literals or attributes',()=>{
 assert.deepEqual(splitIRArguments('<2 x i32> <i32 -8, i32 7>, i32 addrspace(2)* align 4 %lod'),['<2 x i32> <i32 -8, i32 7>','i32 addrspace(2)* align 4 %lod']);
 assert.throws(()=>splitIRArguments('<2 x i32> <i32 1, i32 2'));
});
test('header and trust list agree on exact new signatures and version guards',()=>{
 const header=readFileSync(new URL('../api/include/metal_texture',import.meta.url),'utf8'),trust=readFileSync(new URL('../api/texture_trust.inc',import.meta.url),'utf8');
 for(const g of samplerReadGeometries){
  assert.equal(header.split(`floor.opaque.read_image.${g.type}.sampler.float.i${g.width}`).length-1,1);
  assert(trust.includes(`"metal::__texture_detail::__sampler_read_${g.type}","floor.opaque.read_image.${g.type}.sampler.float.i${g.width}"`));
  assert.equal(header.split(`return __texture_detail::__sampler_read_${g.type}(`).length-1,4);
 }
 assert.equal(header.split('#if __METAL_VERSION__ >= 410').length-1,6);
 assert(trust.includes('function->getASTContext().getLangOpts().MetalVersion < 410'));
});

import {createHash} from 'node:crypto';
import {assertMSL41TextureReadMetallib} from './msl41-texture-read.mjs';
import {positiveCases,referenceCases} from './apple-reference.mjs';
function metallibFixture(t) {
 const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;},u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
 const tag=(n,b)=>Buffer.concat([Buffer.from(n),u16(b.length),b]),end=Buffer.from('ENDT'),code=Buffer.from('AIR0');
 const payload=Buffer.concat([tag('NAME',Buffer.from(`msl41_read_${t.textureGeometry}_${t.textureReadMode}\0`)),tag('TYPE',Buffer.from([2])),tag('HASH',createHash('sha256').update(code).digest()),tag('VERS',Buffer.from([2,0,9,0,4,0,1,0])),tag('OFFT',Buffer.alloc(24)),tag('MDSZ',u64(4)),end]);
 const row=Buffer.concat([u32(payload.length+4),payload]),po=92+row.length+4,qo=po+8,bo=qo+8;
 return Buffer.concat([Buffer.from('MTLB'),Buffer.alloc(8),u16(27),Buffer.alloc(2),u64(bo+4),...[88,row.length,po,8,qo,8,bo,4].map(u64),u32(1),row,end,u32(8),end,u32(8),end,code]);
}
test('metallib validator binds entry, deployment, and AIR/MSL version',()=>{
 const t={...select(samplerReadGeometries[0],'dynamic'),kind:0},b=metallibFixture(t);
 assertMSL41TextureReadMetallib(b,t);
 for(const [index,value] of [[12,26],[b.indexOf('VERS')+6+2,7],[b.indexOf('VERS')+6+6,0]]) {
  const wrong=Buffer.from(b);wrong[index]=value;assert.throws(()=>assertMSL41TextureReadMetallib(wrong,t));
 }
 assert.throws(()=>assertMSL41TextureReadMetallib(b,{...t,textureReadMode:'defaults'}));
});
test('Apple comparison includes all24 source/profile variants without output-kind duplication',()=>{
 const cases=positiveCases(msl41TextureReadCases);assert.equal(cases.length,24);
 for(const c of cases)assert(referenceCases().some(x=>x.sourceSha256===c.sourceSha256&&x.api===3&&x.appleMetalVersion===410&&x.floorMetalVersion===410&&x.ios===27&&x.math===c.math));
});
test('mixed mode proves complete legacy sampler, coordinates, access and output dataflow',()=>{
 for(const g of samplerReadGeometries) {
  const t=select(g,'mixed'),text=fixture(g,'mixed');
  const oldLine=text.split('\n').find(line=>line.includes('%old = call'));
  const changed=line=>text.replace(oldLine,line);
  const mutants=[changed(oldLine.replace('%readsampler','%wrong')),changed(oldLine.replace('%q,','%o,')),changed(oldLine.replace('i32 %l, i32 0','i32 0, i32 0')),changed(oldLine.replace('i32 %l, i32 0','i32 %l, i32 1')),
   text.replace('%old, 0','%old, 1'),text.replace('%old, 0','%read, 0'),text.replace('i32 1\n  store','i32 2\n  store'),text.replace('store <4 x float> %oldcolor','store <4 x float> %value'),text.replace('addrspace(1)* %dest, align 16','addrspace(1)* %out, align 16'),text.replace(/  store <4 x float> %oldcolor[^\n]*\n/,'')];
  if(g.array)mutants.push(changed(oldLine.replace('i32 %a,','i32 %l,')));
  for(const [i,mutant] of mutants.entries()){assert.notEqual(mutant,text);assert.throws(()=>assertMSL41TextureReadIR(mutant,t),undefined,g.type+' mutation '+i);}
 }
});
test('argument-buffer resource lineage and nested bindings cannot be spoofed',()=>{
 const g=samplerReadGeometries[0],t=select(g,'dynamic'),text=fixture(g,'dynamic');
 const mutations=[
  text.replace('%resources, i32 0, i32 1, i32 0','%other, i32 0, i32 1, i32 0'),
  text.replace('%resources, i32 0, i32 1, i32 0','%resources, i32 0, i32 0, i32 0'),
  text.replace('%resources, i32 0, i32 2','%resources, i32 0, i32 1'),
  text.replace('addrspace(2)* %texptr, align 8','addrspace(2)* %wrong, align 8'),
  text.replace('addrspace(2)* %stateptr, align 8','addrspace(2)* %wrong, align 8'),
  text.replace('!"air.buffer_size", i32 24','!"air.buffer_size", i32 16'),
  text.replace('!"air.struct_type_info", !20','!"air.struct_type_info", !21'),
  text.replace('!20 = !{i32 8,','!20 = !{i32 0,'),
  text.replace('i32 16, i32 8, i32 0, !"sampler"','i32 8, i32 8, i32 0, !"sampler"'),
  text.replace('!"air.indirect_argument", !22','!"air.indirect_argument", !21'),
 ];
 for(const [i,mutant] of mutations.entries()){assert.notEqual(mutant,text);assert.throws(()=>assertMSL41TextureReadIR(mutant,t),undefined,'resource mutation '+i);}
});
test('actual IR resource storage cannot disagree with claimed metadata offsets',()=>{
 const g=samplerReadGeometries[0],t=select(g,'dynamic'),text=fixture(g,'dynamic');
 assert.throws(()=>assertMSL41TextureReadIR(text.replace('[8 x i8]','[16 x i8]'),t));
 assert.throws(()=>assertMSL41TextureReadIR(text.replace('= type { %struct._texture_2d_t addrspace(1)* }','= type { %struct._texture_3d_t addrspace(1)* }'),t));
});

test('all buffer argument metadata must match ordinal, binding, access, space and type',()=>{
 for(const g of samplerReadGeometries) {
  const t=select(g,'dynamic'),text=fixture(g,'dynamic');
  assertMSL41TextureReadIR(text,t);
  for(let ordinal=1;ordinal<(g.array?6:5);ordinal++) {
   const row=text.split('\n').find(line=>line.startsWith(`!${ordinal+6} = `));
   const changes=[
    row.replace(`!{i32 ${ordinal},`,`!{i32 999,`),
    row.replace(`!"air.location_index", i32 ${ordinal}, i32 1`,`!"air.location_index", i32 0, i32 1`),
    row.replace(/!"air.(?:read|read_write)"/,'!"air.write"'),
    row.replace(/!"air.address_space", i32 \d/,'!"air.address_space", i32 3'),
    row.replace(/!"air.arg_type_size", i32 \d+/,'!"air.arg_type_size", i32 999'),
    row.replace(/!"air.arg_type_align_size", i32 \d+/,'!"air.arg_type_align_size", i32 999'),
    row.replace(/!"air.arg_type_name", !"[^"]+"/,'!"air.arg_type_name", !"wrong"'),
    row.replace(/!"air.arg_name", !"[^"]+"/,'!"air.arg_name", !"wrong"'),
   ];
   for(const changed of changes){assert.notEqual(row,changed);assert.throws(()=>assertMSL41TextureReadIR(text.replace(row,changed),t),/Wrong buffer metadata/);}
  }
  const refs=`!5 = !{${Array(g.array?6:5).fill('!6').join(', ')}}`;
  assert.throws(()=>assertMSL41TextureReadIR(text.replace(/^!5 = .*$/m,refs),t),/Wrong buffer metadata/);
 }
});
test('duplicate, conflicting and missing resource metadata tags fail closed',()=>{
 const g=samplerReadGeometries[0],t=select(g,'dynamic'),text=fixture(g,'dynamic');
 for(const id of [6,7,8,9,10,21,22]) {
  const row=text.split('\n').find(line=>line.startsWith(`!${id} = `));
  for(const tag of ['!"air.read"','!"air.sample"','!"air.arg_type_name", !"wrong"','!"air.location_index", i32 99, i32 1'])
   assert.throws(()=>assertMSL41TextureReadIR(text.replace(row,row.replace(/}$/,`, ${tag}}`)),t),/metadata/);
  assert.throws(()=>assertMSL41TextureReadIR(text.replace(row,row.replace(/!"air.arg_type_name", !"[^"]+", /,'')),t),/metadata/);
 }
 const texture=text.split('\n').find(line=>line.startsWith('!21 = '));
 assert.throws(()=>assertMSL41TextureReadIR(text.replace(texture,texture.replace('!"air.sample"','!"air.sample", !"air.read"')),t),/metadata/);
});
test('comments cannot supply resource definitions or output stores',()=>{
 const g=samplerReadGeometries[0],t=select(g,'dynamic'),text=fixture(g,'dynamic');
 const forged=text.replace('  %texptr = getelementptr','  ; %texptr = getelementptr').replace('  %tex = load','  %texptr = inttoptr i64 8 to %struct._texture_2d_t addrspace(1)* addrspace(2)*\n  %tex = load');
 assert.throws(()=>assertMSL41TextureReadIR(forged,t),/Unsupported sampler-read instruction/);
 for(const start of ['%texptr =','%stateptr =','%tex =','%state =','store <4 x float>'])
  assert.throws(()=>assertMSL41TextureReadIR(text.replace('  '+start,'  ; '+start),t));
});
test('single-block oracle rejects overwrites, early exits and unsupported instructions',()=>{
 for(const g of samplerReadGeometries)for(const mode of ['dynamic','defaults','boundaries','mixed']) {
  const t=select(g,mode),text=fixture(g,mode);
  const additions=[
   'store <4 x float> zeroinitializer, <4 x float> addrspace(1)* %out, align 16',
   'store <4 x float> %value, <4 x float> addrspace(1)* %out, align 16',
   'ret void','br label %other','other:','unreachable',
   'call void @unknown()', '%extra = add i32 1, 2',
   '%extra = alloca i32, align 4', '%extra = load volatile i32, i32 addrspace(2)* %lod, align 4',
  ];
  for(const addition of additions)assert.throws(()=>assertMSL41TextureReadIR(text.replace('  ret void',`  ${addition}\n  ret void`),t));
  assert.throws(()=>assertMSL41TextureReadIR(text.replace('  store <4 x float> %value','  ret void\n  store <4 x float> %value'),t));
 }
});
test('SSA use-before-definition and duplicate definitions are rejected',()=>{
 const g=samplerReadGeometries[0],t=select(g,'dynamic'),text=fixture(g,'dynamic');
 const load=text.split('\n').find(line=>line.startsWith('  %state = '));
 assert.throws(()=>assertMSL41TextureReadIR(text.replace(load,load+'\n'+load),t),/Duplicate SSA/);
 assert.throws(()=>assertMSL41TextureReadIR(text.replace(load+'\n','').replace('  ret void',load+'\n  ret void'),t),/Undefined\/forward SSA/);
});
test('ordinary FLOOR instruction metadata, call attributes, comments and SSA names remain accepted',()=>{
 for(const g of samplerReadGeometries)for(const mode of ['dynamic','defaults','boundaries','mixed']) {
  const t=select(g,mode),text=fixture(g,mode);
  const decorated=text.split('\n').map(line=>{
   if(/^  .* = (?:tail )?call /.test(line))return line+' #1 ; ordinary call attributes';
   if(/^  .* = (?:load|getelementptr) /.test(line)||/^  store /.test(line))return line+', !tbaa !30 ; ordinary memory metadata';
   return line;
  }).join('\n').replace(/%texptr\b/g,'%__handle.i').replace(/%stateptr\b/g,'%__state.i')+'!30 = !{!"type;with;semicolons"}\n';
  assertMSL41TextureReadIR('; harmless preamble\n'+decorated,t);
 }
});
