// Authored MSL 4.1 section 6.13 sampler-backed integer texel reads.
// Scope: the existing float, sample-access 2D, 2D-array, and 3D views.
// Compile/IR evidence alone does not establish sampler or GPU semantics.
import assert from 'node:assert/strict';
import {assertBitInterleaveMode} from './msl41-bit-interleave-abi.mjs';
import {assertMetallibMetadata} from './metallib-metadata.mjs';
const header='#include <metal_stdlib>\nusing namespace metal;\n';
export const samplerReadGeometries=[
 {type:'texture2d',air:'2d',width:2,array:false},
 {type:'texture2d_array',air:'2d_array',width:2,array:true},
 {type:'texture3d',air:'3d',width:3,array:false},
];
export function makeSamplerReadSource(g,mode='dynamic') {
 assert(samplerReadGeometries.includes(g));assert(['dynamic','defaults','boundaries','mixed'].includes(mode));
 const v=`int${g.width}`, q=mode==='boundaries'?`${v}(${g.width===3?'-2,4,-1':'-2,4'})`:'coords[0]';
 const offset=mode==='boundaries'?`${v}(${g.width===3?'-8,7,1':'-8,7'})`:'offsets[0]';
 const args=`resources.state,${q}${g.array?',layer[0]':''}${mode==='defaults'?'':`,${offset},lod[0]`}`;
 const helpers=['thread','device','constant','threadgroup'].map(space=>
  `static inline float4 check_${space}(const ${space} ${g.type}<float>& tex,sampler state,${v} q,${v} offset,uint lod${g.array?',uint layer':''}){return tex.read(state,q,${g.array?'layer,':''}offset,lod);}`).join('\n');
 return header+helpers+`\nstruct Resources {${g.type}<float> tex [[id(1)]];sampler state [[id(2)]];};\nkernel void msl41_read_${g.type}_${mode}(constant Resources& resources [[buffer(0)]], device const ${v}* coords [[buffer(1)]], device const ${v}* offsets [[buffer(2)]], constant uint* lod [[buffer(3)]], device float4* out [[buffer(4)]]${g.array?',constant uint* layer [[buffer(5)]]':''}) {\nout[0]=resources.tex.read(${args});\n`+
  (mode==='mixed'?`out[1]=resources.tex.read(uint${g.width}(coords[0])${g.array?',layer[0]':''},lod[0]);\n`:'')+'}\n';
}
export const msl41TextureReadCases=[];
for(const g of samplerReadGeometries)for(const mode of ['dynamic','defaults','boundaries','mixed'])for(const math of [0,1])for(const kind of [0,1])
 msl41TextureReadCases.push({name:`msl41-sampler-read-${g.type}-${mode}-math${math}-kind${kind}`,source:makeSamplerReadSource(g,mode),api:3,ios:27,metalVersion:410,math,kind,status:0,msl41TextureRead:true,textureGeometry:g.type,textureReadMode:mode});
for(const g of samplerReadGeometries) {
 for(const options of [{api:3,ios:18,metalVersion:320},{api:3,ios:26,metalVersion:400},{api:1,ios:18},{api:2,ios:26}])
  msl41TextureReadCases.push({name:`reject-msl41-sampler-read-${g.type}-api${options.api}-ios${options.ios}`,source:makeSamplerReadSource(g,'defaults'),...options,math:0,kind:1,status:3,msl41TextureRead:true,diagnosticPattern:'no matching member function|no matching function|too many arguments'});
 for(const value of [-9,8]) {
  const source=makeSamplerReadSource(g,'boundaries').replace(g.width===3?'int3(-8,7,1)':'int2(-8,7)',`int${g.width}(${value})`);
  msl41TextureReadCases.push({name:`reject-msl41-sampler-offset-${g.type}-${value<0?'minus9':'plus8'}`,source,api:3,ios:27,metalVersion:410,math:0,kind:1,status:3,msl41TextureRead:true,diagnosticPattern:'offset out of range.*\\[-8, 7\\]'});
 }
}
for(const options of [{api:3,ios:18,metalVersion:320},{api:3,ios:26,metalVersion:400},{api:2,ios:26}])
 msl41TextureReadCases.push({name:`reject-msl41-sampler-read-version-spoof-api${options.api}-ios${options.ios}`,source:'#undef __METAL_VERSION__\n#define __METAL_VERSION__ 410\n'+makeSamplerReadSource(samplerReadGeometries[0],'defaults'),...options,math:0,kind:1,status:3,msl41TextureRead:true,diagnosticPattern:'assembly|asm'});
// Neither a namespace/name imitation nor #line spoofing makes user assembly
// declarations part of the immutable physical compatibility header.
for(const line of [false,true])msl41TextureReadCases.push({name:`reject-msl41-sampler-read-forged-asm-${line?'line':'plain'}`,api:3,ios:27,metalVersion:410,math:0,kind:1,status:3,msl41TextureRead:true,diagnosticPattern:'assembly|asm',source:header+(line?'#line 1 "/include/metal_texture"\n':'')+'float4 fake(image2d_t,sampler_t,ulong,int2,uint,uint,int2,int,float,bool,bool,bool,float2,float2,bool,uint,float,bool) __asm__("floor.opaque.read_image.texture2d.sampler.float.i2");\nkernel void bad(device uint* out [[buffer(0)]]){out[0]=0u;}\n'});

// Split typed argument lists while preserving vectors, addrspace(), and attrs.
export function splitIRArguments(text) {
 const result=[];let depth=0,start=0;
 for(let i=0;i<text.length;i++) {
  if('<([{'.includes(text[i]))depth++;
  else if('>)]}'.includes(text[i])){assert(depth>0,'Unbalanced IR arguments');depth--;}
  else if(text[i]===','&&depth===0){result.push(text.slice(start,i).trim());start=i+1;}
 }
 assert.equal(depth,0,'Unbalanced IR arguments');result.push(text.slice(start).trim());return result;
}
function valueOf(arg) {
 const v=arg.match(/(%[\w.]+|zeroinitializer|<i32 [^>]+>|-?\d+)$/);assert(v,'Unsupported IR operand: '+arg);return v[1];
}
function typeWithoutAttrs(arg) {
 return arg.replace(/\b(?:nocapture|noundef|readonly|writeonly|nonnull|noalias|align \d+|dereferenceable(?:_or_null)?\(\d+\))\b\s*/g,'').trim();
}
// This oracle intentionally accepts the straight-line typed-pointer IR emitted
// for these fixed FLOOR probes, not arbitrary LLVM IR or Apple's distinct ABI.
// Strip comments outside strings so commented instructions can never establish
// resource provenance. Preserve semicolons inside quoted type/metadata names.
function withoutIRComments(ir) {
 return ir.split('\n').map(line=>{
  let quoted=false;
  for(let i=0;i<line.length;i++) {
   if(line[i]==='"'&&(i===0||line[i-1]!=='\\'))quoted=!quoted;
   if(line[i]===';'&&!quoted)return line.slice(0,i).trimEnd();
  }
  return line;
 }).join('\n');
}
function assertStraightLineTextureBody(body,g,mode,ir) {
 const lines=body.split('\n').map(line=>line.trim()).filter(Boolean);
 if(lines[0]==='entry:')lines.shift();
 assert.equal(lines.pop(),'ret void','Missing final return');
 const definitions=new Set(['%resources','%coords','%offsets','%lod','%out',...(g.array?['%layer']:[])]);
 const types=new Set([...ir.matchAll(/^(%(?:"[^"]+"|[\w.]+)) = type /gm)].map(m=>m[1]));
 const stores=[];
 for(const raw of lines) {
  // Only ordinary numeric metadata attachments and call attribute-group refs
  // vary here. Do not erase semantic instructions or memory modifiers.
  const line=raw.replace(/(?:, ![\w.]+ !\d+)+$/,'').replace(/ #\d+$/,'');
  const assignment=line.match(/^(%[\w.]+) = (.*)$/);
  const rhs=assignment?assignment[2]:line;
  for(const ref of rhs.matchAll(/%(?:"[^"]+"|[\w.]+)/g))
   assert(types.has(ref[0])||definitions.has(ref[0]),'Undefined/forward SSA operand '+ref[0]);
  if(assignment){assert(!definitions.has(assignment[1]),'Duplicate SSA definition');definitions.add(assignment[1]);}
  const vector=`<${g.width} x i32>`;
  let allowed=false;
  if(assignment&&rhs.startsWith('load ')) {
   const args=splitIRArguments(rhs.slice(5));
   assert.equal(args.length,3,'Unsupported load');assert(/^align [1-9]\d*$/.test(args[2]),'Invalid load alignment');
   const scalar=['lod',...(g.array?['layer']:[])];
   allowed=(args[0]===vector&&['coords','offsets'].some(name=>args[1]===`${vector} addrspace(1)* %${name}`))||
    (args[0]==='i32'&&scalar.some(name=>args[1]===`i32 addrspace(2)* %${name}`))||
    ([`%struct._texture_${g.air}_t addrspace(1)*`,'%struct._sampler_t addrspace(2)*'].some(type=>
      args[0]===type&&args[1].startsWith(type+' addrspace(2)* %')));
  } else if(assignment&&rhs.startsWith('getelementptr inbounds ')) {
   allowed=/^getelementptr inbounds %struct\.Resources, %struct\.Resources addrspace\(2\)\* %resources, i32 0, i32 (?:1, i32 0|2)$/.test(rhs)||
    (mode==='mixed'&&/^getelementptr inbounds <4 x float>, <4 x float> addrspace\(1\)\* %out, i(?:32|64) 1$/.test(rhs));
  } else if(assignment&&/^(?:tail )?call /.test(rhs)) {
   const prefix=rhs.replace(/^tail /,'');
   allowed=(prefix.startsWith(`call { <4 x float>, i8 } @air.read_texture_${g.air}.v4f32(`)&&prefix.endsWith(')'))||
    (mode==='mixed'&&prefix==='call %struct._sampler_t addrspace(2)* @air.get_read_sampler()');
  } else if(assignment&&/^extractvalue \{ <4 x float>, i8 \} %[\w.]+, 0$/.test(rhs))allowed=true;
  else if(!assignment&&/^store <4 x float> %[\w.]+, <4 x float> addrspace\(1\)\* %[\w.]+, align [1-9]\d*$/.test(rhs)) {
   stores.push(rhs);allowed=true;
  }
  assert(allowed,'Unsupported sampler-read instruction: '+raw);
 }
 // Existing operand checks below identify each expected store. An exact count
 // excludes additional writes, while this single block excludes bypass paths,
 // early returns, loops, and stores hidden after a terminator.
 assert.equal(stores.length,mode==='mixed'?2:1,'Unexpected output writes');
}
export function assertMSL41TextureReadIR(ir,test) {
 assert(test.msl41TextureRead&&test.status===0&&test.kind===1,'Not a successful sampler-read IR case');
 assert(typeof ir==='string'&&ir.length>0&&ir.length<2*1024*1024,'Invalid sampler-read IR size');
 ir=withoutIRComments(ir);
 assertBitInterleaveMode(ir,test);
 const g=samplerReadGeometries.find(g=>g.type===test.textureGeometry),mode=test.textureReadMode;
 assert(g&&['dynamic','defaults','boundaries','mixed'].includes(mode));
 assert(!/floor\.opaque\.|@_Z|\b(?:sitofp|uitofp|fptosi|fptoui)\b/.test(ir),'Unlowered helper or unwanted float coordinate conversion');
 const entry=`msl41_read_${g.type}_${mode}`;
 const bodies=[...ir.matchAll(new RegExp(`^define void @${entry}\\(([^\\n]*)\\{([^]*?)^}`,'gm'))];
 assert.equal(bodies.length,1,'Missing/duplicate sampler-read entry');
 const body=bodies[0][2];
 assertStraightLineTextureBody(body,g,mode,ir);
 const signature=bodies[0][1];const end=signature.lastIndexOf(')');assert(end>=0);
 const parameters=splitIRArguments(signature.slice(0,end));
 assert.equal(parameters.length,g.array?6:5,'Wrong texture-read argument count');
 const expectedNames=['resources','coords','offsets','lod','out',...(g.array?['layer']:[])];
 assert.deepEqual(parameters.map(p=>p.match(/%([\w.]+)$/)?.[1]),expectedNames,'Wrong argument order');
 const input=name=>{const p=parameters.find(p=>p.endsWith(' %'+name));assert(p,'Missing input '+name);return p;};
 assert.match(input('resources'),/^%struct\.Resources addrspace\(2\)\*[^,]* %resources$/,'Wrong argument-buffer storage');
 for(const [name,type,space] of [['coords',`<${g.width} x i32>`,1],['offsets',`<${g.width} x i32>`,1],['lod','i32',2],['out','<4 x float>',1],...(g.array?[['layer','i32',2]]:[])])
  assert(typeWithoutAttrs(input(name)).startsWith(`${type} addrspace(${space})* `),'Wrong input storage '+name);
 const readName=`air.read_texture_${g.air}.v4f32`,escape=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const calls=[...body.matchAll(new RegExp(`(%[\\w.]+) = (?:tail )?call (?:[\\w]+ )*\\{ <4 x float>, i8 \\} @${escape(readName)}\\(([^\\n]*)\\)`,'g'))];
 assert.equal(calls.length,mode==='mixed'?2:1,'Wrong texture read count/symbol');
 const args=splitIRArguments(calls[0][2]);assert.equal(args.length,g.array?7:6,'Wrong read ABI argument count');
 const records=[...ir.matchAll(/^%struct\.Resources = type \{ \[8 x i8\], (%(?:"[^"]+"|[\w.]+)), %struct\._sampler_t addrspace\(2\)\* \}$/gm)];
 assert.equal(records.length,1,'Wrong actual argument-buffer storage layout');
 assert(new RegExp(`^${escape(records[0][1])} = type \\{ %struct\\._texture_${g.air}_t addrspace\\(1\\)\\* \\}$`,'m').test(ir),'Wrong actual texture handle storage');
 const resourceLoad=(arg,kind)=>{
  const type=kind==='texture'?`%struct._texture_${g.air}_t addrspace(1)*`:'%struct._sampler_t addrspace(2)*';
  assert(arg.startsWith(type+' '),'Wrong resource handle type');
  const val=valueOf(arg),loads=[...body.matchAll(new RegExp(`${escape(val)} = load ${escape(type)}, ${escape(type)} addrspace\\(2\\)\\* (%[\\w.]+), align 8(?:, ![^\\n]*)?`,'g'))];
  assert.equal(loads.length,1,'Missing resource handle load');
  const indices=kind==='texture'?'i32 0, i32 1, i32 0':'i32 0, i32 2';
  assert(new RegExp(`${escape(loads[0][1])} = getelementptr inbounds %struct\\.Resources, %struct\\.Resources addrspace\\(2\\)\\* %resources, ${indices}(?:\\n|, !)`,'m').test(body),'Wrong resource field lineage');
 };
 resourceLoad(args[0],'texture');resourceLoad(args[1],'sampler');
 const index={coord:2,layer:3,offset:g.array?4:3,lod:g.array?5:4,access:g.array?6:5};
 for(const i of [index.coord,index.offset])assert(args[i].startsWith(`<${g.width} x i32> `),'Wrong signed coord/offset ABI width');
 assert.equal(args[index.access],'i32 0','Wrong sample-access tag');
 const fromLoad=(arg,inputName,type,space)=>{
  const v=valueOf(arg),re=new RegExp(`^\\s*${escape(v)} = load ${escape(type)}, ${escape(type)} addrspace\\(${space}\\)\\* %${inputName}, align \\d+(?:, ![^\\n]*)?$`,'m');
  assert(re.test(body),'Operand no longer comes from '+inputName);
 };
 if(mode==='boundaries') {
  assert.equal(valueOf(args[index.coord]),g.width===3?'<i32 -2, i32 4, i32 -1>':'<i32 -2, i32 4>','Changed signed coordinates');
  assert.equal(valueOf(args[index.offset]),g.width===3?'<i32 -8, i32 7, i32 1>':'<i32 -8, i32 7>','Changed offset boundaries');
 } else {
  fromLoad(args[index.coord],'coords',`<${g.width} x i32>`,1);
  if(mode==='defaults')assert.equal(valueOf(args[index.offset]),'zeroinitializer','Nonzero default offset');
  else fromLoad(args[index.offset],'offsets',`<${g.width} x i32>`,1);
 }
 if(mode==='defaults')assert.equal(args[index.lod],'i32 0','Nonzero default LOD');else fromLoad(args[index.lod],'lod','i32',2);
 if(g.array)fromLoad(args[index.layer],'layer','i32',2);
 const extraction=[...body.matchAll(new RegExp(`(%[\\w.]+) = extractvalue \\{ <4 x float>, i8 \\} ${escape(calls[0][1])}, 0`,'g'))];
 assert.equal(extraction.length,1,'Missing color extraction from AIR result');
 assert(new RegExp(`store <4 x float> ${escape(extraction[0][1])}, <4 x float> addrspace\\(1\\)\\* %out, align \\d+`).test(body),'Texture result not stored to output');
 const readSamplerCalls=[...body.matchAll(/(%[\w.]+) = (?:tail )?call %struct\._sampler_t addrspace\(2\)\* @air\.get_read_sampler\(\)/g)];
 assert.equal(readSamplerCalls.length,mode==='mixed'?1:0,'Explicit sampler read replaced with default read sampler');
 if(mode==='mixed') {
  const old=splitIRArguments(calls[1][2]);assert.equal(old.length,args.length);
  resourceLoad(old[0],'texture');assert.equal(valueOf(old[1]),readSamplerCalls[0][1],'Legacy sampler not produced by get_read_sampler');
  assert.equal(valueOf(old[index.offset]),'zeroinitializer','Legacy sampler-less offset changed');
  assert.equal(old[index.access],'i32 0','Wrong legacy sample-access tag');
  fromLoad(old[index.coord],'coords',`<${g.width} x i32>`,1);
  fromLoad(old[index.lod],'lod','i32',2);
  if(g.array)fromLoad(old[index.layer],'layer','i32',2);
  const legacyColors=[...body.matchAll(new RegExp(`(%[\\w.]+) = extractvalue \\{ <4 x float>, i8 \\} ${escape(calls[1][1])}, 0`,'g'))];
  assert.equal(legacyColors.length,1,'Missing legacy color extraction');
  const destinations=[...body.matchAll(/(%[\w.]+) = getelementptr inbounds <4 x float>, <4 x float> addrspace\(1\)\* %out, i(?:32|64) 1\b/g)];
  assert.equal(destinations.length,1,'Missing output[1] destination');
  assert(new RegExp(`store <4 x float> ${escape(legacyColors[0][1])}, <4 x float> addrspace\\(1\\)\\* ${escape(destinations[0][1])}, align \\d+`).test(body),'Legacy result not stored to output[1]');
 }
 // Resolve the kernel root and argument links, so orphan metadata cannot
 // make a mismatched texture/sampler binding appear valid.
 const nodes=new Map();
 for(const m of ir.matchAll(/^!(\d+) = !\{([^\n]*)\}$/gm)){assert(!nodes.has(m[1]),'Duplicate metadata node');nodes.set(m[1],m[2]);}
 const node=id=>{assert(nodes.has(id),'Missing metadata link '+id);return nodes.get(id);};
 const roots=[...ir.matchAll(/^!air\.kernel = !\{!(\d+)\}$/gm)];assert.equal(roots.length,1,'Wrong AIR kernel roots');
 const kernel=node(roots[0][1]);assert(kernel.includes('* @'+entry+', '),'Kernel metadata points elsewhere');
 const links=kernel.match(/, !(\d+), !(\d+)$/);assert(links,'Invalid kernel metadata links');assert.equal(node(links[1]),'');
 const argumentsMetadata=node(links[2]).split(', ');assert.equal(argumentsMetadata.length,parameters.length);
 for(const ref of argumentsMetadata){assert(/^!\d+$/.test(ref),'Invalid argument metadata');node(ref.slice(1));}
 assert(/^!\d+$/.test(argumentsMetadata[0]));const resource=node(argumentsMetadata[0].slice(1));
 const layout=resource.match(/!"air.struct_type_info", !(\d+)/);assert(layout,'Missing argument-buffer layout');
 assert.equal(resource,`i32 0, !"air.indirect_buffer", !"air.buffer_size", i32 24, !"air.location_index", i32 0, i32 1, !"air.read", !"air.address_space", i32 2, !"air.struct_type_info", !${layout[1]}, !"air.arg_type_size", i32 24, !"air.arg_type_align_size", i32 8, !"air.arg_type_name", !"Resources", !"air.arg_name", !"resources"`,'Wrong argument-buffer metadata');
 const buffers=[['coords',1,`int${g.width}`,g.width*4,g.width===3?16:8,'read'],['offsets',1,`int${g.width}`,g.width*4,g.width===3?16:8,'read'],['lod',2,'uint',4,4,'read'],['out',1,'float4',16,16,'read_write'],...(g.array?[['layer',2,'uint',4,4,'read']]:[])];
 for(const [index,[name,space,type,size,align,access]] of buffers.entries()) {
  const ordinal=index+1;
  assert.equal(node(argumentsMetadata[ordinal].slice(1)),`i32 ${ordinal}, !"air.buffer", !"air.location_index", i32 ${ordinal}, i32 1, !"air.${access}", !"air.address_space", i32 ${space}, !"air.arg_type_size", i32 ${size}, !"air.arg_type_align_size", i32 ${align}, !"air.arg_type_name", !"${type}", !"air.arg_name", !"${name}"`,'Wrong buffer metadata: '+name);
 }
 const fields=node(layout[1]),linksToFields=[...fields.matchAll(/!"air.indirect_argument", !(\d+)/g)];assert.equal(linksToFields.length,2);
 const typename=`${g.type}<float, sample>`;
 assert.equal(fields,`i32 8, i32 8, i32 0, !"${typename}", !"tex", !"air.indirect_argument", !${linksToFields[0][1]}, i32 16, i32 8, i32 0, !"sampler", !"state", !"air.indirect_argument", !${linksToFields[1][1]}`,'Wrong indirect storage offsets/types');
 for(const [i,name,kind,binding] of [[0,'tex','texture',1],[1,'state','sampler',2]]) {
  const arg=node(linksToFields[i][1]);
  assert.equal(arg,`i32 ${i}, !"air.${kind}", !"air.location_index", i32 ${binding}, i32 1, ${kind==='texture'?'!"air.sample", ':''}!"air.arg_type_name", !"${kind==='texture'?typename:'sampler'}", !"air.arg_name", !"${name}"`,'Wrong resource metadata');
 }


}
export function assertMSL41TextureReadDiagnostic(diagnostics,test) {
 assert(test.msl41TextureRead&&test.status===3&&test.diagnosticPattern);
 assert.match(diagnostics,new RegExp(test.diagnosticPattern,'i'),'Wrong sampler-read rejection reason');
}

export function assertMSL41TextureReadMetallib(bytes,test) {
 assert(test.msl41TextureRead&&test.status===0&&test.kind===0);
 assert.equal(test.api,3);assert.equal(test.ios,27);assert.equal(test.metalVersion,410);
 const entry=`msl41_read_${test.textureGeometry}_${test.textureReadMode}`;
 const info=assertMetallibMetadata(bytes,[{entry,parameters:[]}]);
 assert.equal(Buffer.from(bytes).readUInt16LE(12),27,'Wrong sampler-read deployment');
 for(const fn of info.functions)assert.deepEqual(fn.versions,[[2,9,0],[4,1,0]],'Wrong sampler-read AIR/MSL VERS');
 return info;
}
