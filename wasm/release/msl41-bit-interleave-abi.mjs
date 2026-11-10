// Bind the bounded arithmetic evaluator's named buffers to the emitted ABI.
// LLVM attributes may vary, but pointer types, parameter order, and linked AIR
// metadata must agree with the authored source exactly.
import assert from 'node:assert/strict';
import {assertMetalLanguageMetadataIR,metalLanguageTuples} from './metal-language.mjs';

export function assertBitInterleaveABI(ir,test) {
  const {bitInterleaveBits:bits,bitInterleaveForm:form,bitInterleaveMode:mode}=test;
  assert([8,16,32].includes(bits));
  assert(['scalar','vector','deinterleave'].includes(form));
  assert(['dynamic','constants'].includes(mode));
  const narrow={8:'uchar',16:'ushort',32:'uint'}[bits],wide={8:'ushort',16:'uint',32:'ulong'}[bits];
  const name=`msl41_${form}_${mode}_${bits}`;
  const scalar={llvm:`i${bits}`,msl:narrow,size:bits/8};
  const vector={llvm:`<2 x i${bits}>`,msl:narrow+'2',size:bits/4};
  const large={llvm:`i${2*bits}`,msl:wide,size:bits/4};
  const input=form==='scalar'?scalar:form==='vector'?vector:large;
  const output=form==='deinterleave'?vector:large;
  const parameters=[...(mode==='dynamic'?[{...input,name:'a',buffer:0,access:'read'}]:[]),{...output,name:'b',buffer:1,access:'read_write'}];
  const pointer=p=>`${p.llvm} addrspace(1)*`;
  const definitions=[...ir.matchAll(/^define void @([\w.]+)\(([^\n]*)\{/gm)];
  assert.equal(definitions.length,1,'Unexpected/missing kernel definition');
  assert.equal(definitions[0][1],name,'Wrong ABI entry');
  const tail=definitions[0][2];let depth=1,end=-1;
  for(let i=0;i<tail.length;i++) {
    if(tail[i]==='(')depth++;
    if(tail[i]===')'&&--depth===0){end=i;break;}
  }
  assert(end>=0,'Malformed function signature');
  const args=tail.slice(0,end).split(',').map(x=>x.trim());
  assert.equal(args.length,parameters.length,'Wrong argument count');
  for(const [i,p] of parameters.entries()) {
    const prefix=pointer(p),suffix=`%${p.name}`,arg=args[i];
    assert(arg.startsWith(prefix+' ')&&arg.endsWith(' '+suffix),'Wrong parameter type, address space, name, or order');
    const attrs=arg.slice(prefix.length,arg.length-suffix.length).trim();
    assert(/^(?:(?:nocapture|noundef|readonly|writeonly|nonnull|noalias|align \d+|dereferenceable(?:_or_null)?\(\d+\))(?: |$))*$/.test(attrs),'Unsupported parameter attributes');
  }

  const nodes=new Map();
  for(const m of ir.matchAll(/^!(\d+) = !\{([^\n]*)\}$/gm)) {
    assert(!nodes.has(m[1]),'Duplicate metadata node');nodes.set(m[1],m[2]);
  }
  const node=id=>{assert(nodes.has(id),`Missing metadata node !${id}`);return nodes.get(id);};
  const roots=[...ir.matchAll(/^!air\.kernel = !\{!(\d+)\}$/gm)];
  assert.equal(roots.length,1,'Missing or duplicate AIR kernel root');
  const entry=node(roots[0][1]),typePrefix=`void (${parameters.map(pointer).join(', ')})* @${name}, `;
  assert(entry.startsWith(typePrefix),'AIR kernel pointer type or entry disagrees with signature');
  const links=entry.slice(typePrefix.length).match(/^!(\d+), !(\d+)$/);
  assert(links,'Malformed kernel metadata links');
  assert.equal(node(links[1]),'','Unexpected kernel return metadata');
  const refs=node(links[2]).split(', ');
  assert.equal(refs.length,parameters.length,'Wrong AIR argument count');
  for(const [i,p] of parameters.entries()) {
    assert(/^!\d+$/.test(refs[i]),'Malformed AIR argument reference');
    const expected=`i32 ${i}, !"air.buffer", !"air.location_index", i32 ${p.buffer}, i32 1, !"air.${p.access}", !"air.address_space", i32 1, !"air.arg_type_size", i32 ${p.size}, !"air.arg_type_align_size", i32 ${p.size}, !"air.arg_type_name", !"${p.msl}", !"air.arg_name", !"${p.name}"`;
    assert.equal(node(refs[i].slice(1)),expected,'AIR buffer index, access, width, alignment, type, or argument identity mismatch');
  }
}

// Actual mode metadata is mandatory for release qualification. This helper
// does not rewrite older preflight IR or infer its version from the test name.
export function assertBitInterleaveMode(ir,test) {
  assert.equal(test.api,3);assert.equal(test.ios,27);assert.equal(test.metalVersion,410);
  const selected=metalLanguageTuples.find(tuple=>tuple.ios===test.ios&&tuple.metalVersion===test.metalVersion);
  assert(selected,'Unsupported language/target tuple');
  assertMetalLanguageMetadataIR(ir,selected);
  const flags=[...ir.matchAll(/^!llvm\.module\.flags = !\{([^\n]*)\}$/gm)];
  assert.equal(flags.length,1,'Missing or duplicate module flags');
  const sdk=[...ir.matchAll(/^!(\d+) = !\{i32 2, !"SDK Version", \[2 x i32\] \[i32 (\d+), i32 (\d+)\]\}$/gm)];
  assert.equal(sdk.length,1,'Missing or duplicate SDK version');
  assert(flags[0][1].split(', ').includes('!'+sdk[0][1]),'SDK version is not linked from module flags');
  assert.deepEqual(sdk[0].slice(2).map(Number),[27,0],'Wrong SDK deployment version');
}
