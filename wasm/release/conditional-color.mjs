// Authored compiler ABI regressions, not application shaders or GPU proof.
import assert from 'node:assert/strict';

export const conditionalColorSource = `#include <metal_stdlib>
using namespace metal;
constant bool use_uint [[function_constant(200)]];
constant bool use_float [[function_constant(201)]];
constant bool use_sparse2 [[function_constant(202)]];
constant bool use_sparse7 [[function_constant(207)]];
typedef uint4 PixelWords;
typedef float4 PixelFloats;
struct UIntOut { uint4 value [[color(0)]]; };
struct FloatOut { float4 value [[color(1)]]; };
struct SparseOut { uint4 words [[color(2)]]; float4 floats [[color(7)]]; };
fragment UIntOut conditional_uint(uint4 current [[color(0),function_constant(use_uint)]]) {
  UIntOut o; o.value=use_uint?current^uint4(15u):uint4(0u); return o;
}
fragment FloatOut conditional_float(float4 current [[color(1),function_constant(use_float)]]) {
  FloatOut o; o.value=use_float?current+float4(0.25f):float4(0.0f); return o;
}
fragment SparseOut conditional_sparse(constant uint4* mask [[buffer(29)]],
  const PixelFloats previous7 [[color(7),function_constant(use_sparse7)]],
  PixelWords previous2 [[color(2),function_constant(use_sparse2)]]) {
  SparseOut o; o.words=use_sparse2?previous2^mask[2]:mask[2];
  o.floats=use_sparse7?previous7+float4(mask[7]):float4(mask[7]); return o;
}
`;
export const conditionalColorEntries = [
  {entry:'conditional_uint',parameters:[{name:'current',index:0,type:'uint4',slot:0,constant:'use_uint',constantIndex:200}]},
  {entry:'conditional_float',parameters:[{name:'current',index:0,type:'float4',slot:1,constant:'use_float',constantIndex:201}]},
  {entry:'conditional_sparse',parameters:[
    {name:'previous7',index:1,type:'float4',slot:7,constant:'use_sparse7',constantIndex:207},
    {name:'previous2',index:2,type:'uint4',slot:2,constant:'use_sparse2',constantIndex:202}],
    buffer:{name:'mask',index:0,slot:29}},
];

// LLVM metadata and signatures contain nested aggregate types. Split only at
// top-level commas, preserving quoted strings and addrspace/type parentheses.
function operands(text) {
  const result=[]; let start=0, depth=0, quoted=false, escaped=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted) { if(escaped) escaped=false; else if(c==='\\') escaped=true; else if(c==='"') quoted=false; continue; }
    if(c==='"') quoted=true;
    else if('(<[{'.includes(c)) depth++;
    else if(')>]}'.includes(c)) depth--;
    else if(c===',' && depth===0) { result.push(text.slice(start,i).trim()); start=i+1; }
    assert(depth>=0,'Malformed LLVM operands');
  }
  assert(!quoted && depth===0,'Unbalanced LLVM operands');
  if(text.slice(start).trim()) result.push(text.slice(start).trim());
  return result;
}
function property(node,key) {
  const matches=node.flatMap((value,index)=>value===`!"${key}"`?[index]:[]);
  assert.equal(matches.length,1,`Missing or duplicate ${key}`);
  assert(matches[0]+1<node.length,`Missing value for ${key}`);
  return node[matches[0]+1];
}
export function assertConditionalColorIR(ir, entries=conditionalColorEntries) {
  const nodes=new Map();
  for(const match of ir.matchAll(/^!([\w.]+) = !\{(.*)\}$/gm)) {
    assert(!nodes.has('!'+match[1]),'Duplicate metadata definition');
    nodes.set('!'+match[1],operands(match[2]));
  }
  const node=ref=>{ assert(nodes.has(ref),`Missing metadata ${ref}`); return nodes.get(ref); };
  const fragments=node('!air.fragment').map(node);
  const constants=node('!air.function_constants').map(node);
  for(const spec of entries) {
    assert.match(spec.entry,/^[A-Za-z_]\w*$/);
    const matches=fragments.filter(row=>row[0]?.endsWith('@'+spec.entry));
    assert.equal(matches.length,1,`Missing or duplicate fragment ${spec.entry}`);
    assert.equal(matches[0].length,3,'Unexpected fragment metadata shape');
    const inputs=node(matches[0][2]).map(node);
    const signatures=[...ir.matchAll(new RegExp('^define [^\\n]* @'+spec.entry+'\\((.*)\\) [^\\n]*\\{$','gm'))];
    assert.equal(signatures.length,1,`Missing or duplicate definition ${spec.entry}`);
    const args=operands(signatures[0][1]);
    const findInput=expected=> {
      const found=inputs.filter(row=>property(row,'air.arg_name')===`!"${expected.name}"`);
      assert.equal(found.length,1,`Missing or duplicate input ${spec.entry}.${expected.name}`);
      assert.equal(found[0][0],`i32 ${expected.index}`,'Wrong parameter index');
      assert(args[expected.index]?.endsWith('%'+expected.name),'Signature parameter index/name mismatch');
      return found[0];
    };
    assert.equal(inputs.filter(row=>row.includes('!"air.function_constant"')).length,spec.parameters.length,'Unexpected conditional input count');
    for(const parameter of spec.parameters) {
      const input=findInput(parameter);
      assert.equal(property(input,'air.render_target'),`i32 ${parameter.slot}`,'Wrong color attachment');
      assert.equal(property(input,'air.arg_type_name'),`!"${parameter.type}"`,'Wrong conditional input type');
      const llvmType=parameter.type==='uint4'?'<4 x i32>':'<4 x float>';
      assert(args[parameter.index].startsWith(llvmType+' '),'Wrong signature input type');
      const predicate=node(property(input,'air.function_constant'));
      assert.equal(predicate.length,3,'Unexpected predicate metadata shape');
      assert.match(predicate[0],/^i8 addrspace\(2\)\* @__metal_implicit_fc_pred(?:\.\d+)?$/);
      assert.deepEqual(predicate.slice(1),['!"bool"',`!"${parameter.constant}"`],'Wrong input predicate');
      const definition=constants.filter(row=>row[2]===`!"${parameter.constant}"`);
      assert.equal(definition.length,1,'Missing or duplicate function constant');
      assert.deepEqual(definition[0],[`i8 addrspace(2)* @${parameter.constant}.MTL_FC_INIT_${parameter.constantIndex}_b`,
        '!"bool"',`!"${parameter.constant}"`,`i32 ${parameter.constantIndex}`,'i1 true'],'Wrong required function constant pairing');
      // Tie the descriptive predicate name to actual initializer dataflow, not
      // merely an unrelated global with a plausible spelling.
      const predicateGlobal=predicate[0].split('* ')[1];
      const initializerGlobal=`@${parameter.constant}.MTL_FC_INIT_${parameter.constantIndex}_b`;
      const lines=ir.split('\n');
      assert(lines.some(line=>line.startsWith(predicateGlobal+' = ') && line.includes('global i8 0')),'Missing predicate global');
      assert(lines.some(line=>line.startsWith(initializerGlobal+' = ') && line.includes('section "air.fc_initializer"')),'Missing constant initializer global');
      const initializers=[...ir.matchAll(/^define [^\n]* @([A-Za-z_][\w.]*)\(\) [^\n]*section "air.static_init" \{\n([\s\S]*?)^\}/gm)]
        .filter(match=>match[2].includes('i8 addrspace(2)* '+predicateGlobal+','));
      assert.equal(initializers.length,1,'Missing or duplicate predicate initialization');
      const body=initializers[0][2];
      const loads=[...body.matchAll(/(%[\w.]+) = load i8, i8 addrspace\(2\)\* (@[\w.]+),/g)]
        .filter(match=>match[2]===initializerGlobal);
      assert.equal(loads.length,1,'Predicate reads wrong function constant');
      const normalized=[...body.matchAll(/(%[\w.]+) = (?:tail )?call i8 @air\.normalize_function_constant_predicate\.i8\(i8 (%[\w.]+)\)/g)]
        .filter(match=>match[2]===loads[0][1]);
      assert.equal(normalized.length,1,'Predicate normalization lost its source');
      assert(body.includes(`store i8 ${normalized[0][1]}, i8 addrspace(2)* ${predicateGlobal},`),'Predicate stores wrong normalized value');
      const constructors=lines.find(line=>line.startsWith('@llvm.global_ctors = '));
      assert(constructors?.includes('void ()* @'+initializers[0][1]+','),'Predicate initializer is not registered');
    }
    if(spec.buffer) {
      const input=findInput(spec.buffer);
      assert(input.includes('!"air.buffer"'),'Missing buffer argument');
      assert.equal(property(input,'air.location_index'),`i32 ${spec.buffer.slot}`,'Wrong buffer slot');
    }
  }
}
