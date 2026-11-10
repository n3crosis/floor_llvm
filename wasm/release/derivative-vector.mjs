// Authored generic coverage. MSL 4.1 section 6.11.1.1, Table 6.19, p235.
// Compiler lowering checks, not numerical or Apple GPU execution proof.
import assert from 'node:assert/strict';
const header='#include <metal_stdlib>\nusing namespace metal;\n';
const ops=['dfdx','dfdy','fwidth'];
const widths=[1,2,3,4];
const type=n=>n===1?'float':`float${n}`;
const field=n=>n===1?'x':'xyzw'.slice(0,n);
export const derivativeVectorSource=header+ops.flatMap(op=>widths.map(n=>
  `fragment ${type(n)} dv_${op}_${n}(float4 p [[position]]) { return ${op}(p.${field(n)}); }`
)).join('\n')+'\n'+ops.map(op=>
  // Authored numerical fixture: RGB32Float render targets do not exist.
  `fragment float4 dv_probe_${op}_3(float4 p [[position]]) { float3 v=${op}(p.xyz); return float4(v,0.0f); }`
).join('\n');
export const derivativeVectorCases=[];
for(const ios of [18,26]) for(const math of [0,1]) {
  for(const kind of [0,1]) derivativeVectorCases.push({
    name:`derivative-vector-ios${ios}-math${math}-kind${kind}`,
    source:derivativeVectorSource,ios,math,kind,status:0,derivativeVector:true});
  // Each operation must reject each stage independently, even through vector wrappers.
  for(const op of ops) for(const stage of ['vertex','kernel']) {
    const n=ios===18?2:4;
    const result=n===2?`${op}(input.p.xy),0.0f,1.0f`:`${op}(input.p)`;
    const body=stage==='vertex'
      ? `struct In { float4 p [[attribute(0)]]; }; struct Out { float4 p [[position]]; }; vertex Out bad(In input [[stage_in]]) { Out o; o.p=float4(${result}); return o; }`
      : `kernel void bad(device float${n}* out [[buffer(0)]], device float${n}* input [[buffer(1)]]) { out[0]=${op}(input[0]); }`;
    derivativeVectorCases.push({name:`reject-${stage}-${op}-ios${ios}-math${math}`,
      source:header+body,ios,math,kind:0,status:4,derivativeVector:true});
  }
}
// Unsupported vector families: each call has its own compilation.
for(const [index,op] of ops.entries()) for(const t of ['half2','int3']) {
  derivativeVectorCases.push({name:`reject-${op}-${t}`,ios:index===1?26:18,math:index%2,
    kind:0,status:3,derivativeVector:true,
    source:header+`fragment float4 bad(float4 p [[position]]) { ${t} x=${t}(p.xy${t==='int3'?'z':''}); return float4(float2(${op}(x).xy),0.0f,1.0f); }`});
}

export function assertDerivativeVectorIR(ir,test) {
  assert(test.derivativeVector && test.status===0,'Not a successful derivative case');
  assert.match(ir,/!air\.fragment = !\{/,'Missing fragment metadata');
  const attributes=new Map([...ir.matchAll(/^attributes #(\d+) = \{([^\n]*)\}/gm)].map(m=>[m[1],m[2]]));
  for(const op of ops) for(const n of widths) for(const probe of n===3?[false,true]:[false]) {
    const entry=probe?`dv_probe_${op}_3`:`dv_${op}_${n}`;
    const definitions=[...ir.matchAll(new RegExp(`^define [^\\n]* @${entry}\\([^\\n]*\\) [^\\n]*\\{\\n([\\s\\S]*?)^\\}`,'gm'))];
    assert.equal(definitions.length,1,`Missing or duplicate ${entry}`);
    const body=definitions[0][1];
    const calls=[...body.matchAll(/(%[\w.]+) = (?:tail )?call ([^\n]*?)@air\.(dfd[xy])\.f32\(float(?: [a-z]+)* (%[\w.]+)\)([^\n]*)/g)];
    const expected=op==='fwidth'?['dfdx','dfdy']:[op];
    assert.equal(calls.length,n*expected.length,`${entry}: wrong scalar derivative count`);
    const extracts=new Map([...body.matchAll(/(%[\w.]+) = extractelement <4 x float> %p, i(?:32|64) ([0-3])/g)].map(m=>[m[1],Number(m[2])]));
    for(const axis of expected) {
      const axisCalls=calls.filter(m=>m[3]===axis);
      assert.deepEqual(axisCalls.map(m=>extracts.get(m[4])).sort(),Array.from({length:n},(_,i)=>i),`${entry}: missing or duplicated input lane`);
      const declaration=ir.match(new RegExp(`^declare (?:noundef )?float @air\\.${axis}\\.f32\\(float[^\\n]*\\) [^\\n]*#([0-9]+)`,'m'));
      assert(declaration && /\bconvergent\b/.test(attributes.get(declaration[1])??''),`${entry}: derivative declaration lost convergence`);
      for(const call of axisCalls) {
        const group=call[5].match(/#(\d+)/);
        assert(group && /\bconvergent\b/.test(attributes.get(group[1])??''),`${entry}: derivative call lost convergence`);
      }
    }
    assert(!/@air\.dfd[xy]\.(?!f32\b)/.test(body),`${entry}: unexpected vector/typed derivative symbol`);
    const values=evaluateLanes(body);
    const returned=body.match(/ret (?:float|<\d+ x float>) (%[\w.]+)/);
    assert(returned,`${entry}: missing return value`);
    const expectedLanes=Array.from({length:n},(_,i)=>op==='fwidth'
      ? sum(`abs(dfdx:${i})`,`abs(dfdy:${i})`) : `${op}:${i}`);
    if(probe) expectedLanes.push('0');
    assert.deepEqual(values.get(returned[1]),expectedLanes,`${entry}: wrong returned lane/derivative/magnitude dataflow`);
    if(op==='fwidth') {
      assert.match(body,/fadd (?:[a-z]+ )*(?:float|<\d+ x float>)/,`${entry}: missing magnitude sum`);
      assert(!/\bfsub\b/.test(body),`${entry}: incorrect magnitude difference`);
      if(test.math===0) assert(!/\b(?:fadd|call) (?:fast|reassoc|nnan|ninf|nsz|arcp|afn)\b/.test(body),`${entry}: unsolicited fast math`);
    }
  }
}

// A small symbolic interpreter for the optimized lane operations these wrappers
// produce. Track actual returned data, not just plausible symbols elsewhere.
const sum=(a,b)=>`sum(${[a,b].sort().join(',')})`;
function evaluateLanes(body) {
  const values=new Map([['%p',['p:0','p:1','p:2','p:3']]]);
  const get=(v,n=1)=>{
    if(/^<.*>$/.test(v)) {
      const lanes=[...v.matchAll(/float ([^,>]+)/g)].map(m=>get(m[1].trim())[0]);
      return lanes.length===n?lanes:Array(n).fill('?');
    }
    return v==='zeroinitializer'||/^0(?:\.0+)?(?:e[+-]?0+)?$/i.test(v)?Array(n).fill('0'):values.get(v)??Array(n).fill('?');
  };
  const ty='(?:float|i32|<\\d+ x (?:float|i32)>)';
  for(const line of body.split('\n')) {
    const assignment=line.match(/^  (%[\w.]+) = (.*)$/); if(!assignment) continue;
    const [,id,rhs]=assignment; let m,result;
    if((m=rhs.match(/^extractelement <(\d+) x float> (%[\w.]+), i(?:32|64) (\d+)/))) result=[get(m[2],+m[1])[+m[3]]];
    else if((m=rhs.match(/^insertelement <(\d+) x float> (<[^>]+>|[%\w.]+), float ([%\w.+-]+), i(?:32|64) (\d+)/))) {
      result=[...get(m[2],+m[1])]; result[+m[4]]=get(m[3])[0];
    } else if((m=rhs.match(/@air\.(dfd[xy])\.f32\(float(?: [a-z]+)* (%[\w.]+)\)/))) result=[`${m[1]}:${get(m[2])[0]?.replace('p:','')}`];
    else if((m=rhs.match(new RegExp(`^bitcast ${ty} (%[\\w.]+) to ${ty}$`)))) result=get(m[1]);
    else if((m=rhs.match(/^and (i32|<(\d+) x i32>) (%[\w.]+), (.*)$/))) {
      const masks=m[4]==='2147483647'?[2147483647]:[...m[4].matchAll(/i32 (\d+)/g)].map(x=>+x[1]);
      assert.equal(masks.length,+(m[2]??1),'Wrong magnitude mask width');
      assert(masks.every(x=>x===2147483647),'Wrong magnitude sign mask');
      result=get(m[3]).map(x=>`abs(${x})`);
    } else if((m=rhs.match(/^shufflevector <(\d+) x float> ([%\w.]+), <\d+ x float> ([%\w.]+), <\d+ x i32> <(.*)>$/))) {
      const lanes=[...get(m[2],+m[1]),...get(m[3],+m[1])];
      result=[...m[4].matchAll(/i32 (\d+|undef|poison)/g)].map(x=>lanes[Number(x[1])]??'?');
    } else if((m=rhs.match(new RegExp(`^fadd (?:[a-z]+ )*${ty} (%[\\w.]+), (%[\\w.]+)$`)))) result=get(m[1]).map((x,i)=>sum(x,get(m[2])[i]));
    if(result) values.set(id,result);
  }
  return values;
}
