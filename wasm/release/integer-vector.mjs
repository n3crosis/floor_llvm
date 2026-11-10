// Authored MSL 32-bit integer regression probes. See MSL 4.1 section 6.4,
// Table 6.2, printed pp. 202-204. No Apple SDK source or new AIR declarations.
import assert from 'node:assert/strict';
const header = '#include <metal_stdlib>\nusing namespace metal;\n';
const unary = ['clz','ctz','popcount','reverse_bits'];
const sources = {dynamic:header,constants:header};
for (const type of ['int','uint']) for (const width of [2,3,4]) {
  const v=`${type}${width}`;
  const calls=[...unary.map(fn=>`${fn}(x)`),'extract_bits(x,o,n)','insert_bits(x,y,o,n)'];
  sources.dynamic+=`kernel void integer_dynamic_${v}(device const ${v}* a [[buffer(0)]],device ${v}* b [[buffer(1)]],constant uint* p [[buffer(2)]]){${v} x=a[0],y=a[1];uint o=p[0],n=p[1];${calls.map((c,i)=>`static_assert(__is_same(decltype(${c}),${v}),"type");b[${i}]=${c};`).join('')}}\n`;
  const values=type==='uint'?['0u','0x80000000u','0xffffffffu','0xfffffff8u']:['0','(-2147483647-1)','-1','-8'];
  sources.constants+=`kernel void integer_constants_${v}(device volatile ${v}* b [[buffer(0)]]){${v} x=${v}(${values.slice(0,width)});${unary.map((f,i)=>`b[${i}]=${f}(x);`).join('')}b[4]=extract_bits(x,32u,0u);b[5]=extract_bits(x,0u,32u);b[6]=extract_bits(x,28u,4u);b[7]=insert_bits(x,${v}(7),32u,0u);b[8]=insert_bits(${v}(7),x,0u,32u);b[9]=insert_bits(${v}(0),x,4u,4u);}\n`;
}
export const integerVectorCases=[];
for(const ios of [18,26])for(const math of [0,1])for(const kind of [0,1])for(const [mode,source] of Object.entries(sources)){
  integerVectorCases.push({name:`integer-vector-${mode}-ios${ios}-math${math}-kind${kind}`,source,ios,math,kind,status:0,integerVector:true,integerMode:mode});
}
// Each family/type is independently rejected; do not hide a missing guard
// behind an earlier diagnostic in a multi-error shader. Target/profile pairs
// alternate here; successful cases above cover the complete matrix.
for(const [i,type] of ['short','long','float','half','bool'].entries())for(const fn of [...unary,'extract_bits','insert_bits']){
  const args=fn==='extract_bits'?`${type}(1),0u,1u`:fn==='insert_bits'?`${type}(1),${type}(1),0u,1u`:`${type}(1)`;
  integerVectorCases.push({name:`reject-integer-${fn}-${type}`,source:header+`kernel void bad(device int* b [[buffer(0)]]){b[0]=${fn}(${args});}`,ios:i%2?26:18,math:i%2,kind:1,status:3,integerVector:true});
}

for(const fn of [...unary,'extract_bits','insert_bits']){
  const args=fn==='extract_bits'?'float2(1),0u,1u':fn==='insert_bits'?'float2(1),float2(1),0u,1u':'float2(1)';
  integerVectorCases.push({name:`reject-integer-${fn}-float2`,source:header+`kernel void bad(device float2* b [[buffer(0)]]){b[0]=${fn}(${args});}`,ios:26,math:0,kind:1,status:3,integerVector:true});
}

integerVectorCases.push({name:'reject-integer-insert-mixed-sign',source:header+'kernel void bad(device int2* b [[buffer(0)]]){b[0]=insert_bits(int2(1),uint2(1),0u,1u);}',ios:26,math:1,kind:1,status:3,integerVector:true});

export function assertIntegerVectorIR(ir,test) {
  assert.equal(test.integerVector,true,'Not an integer vector case');
  assert.equal(test.status,0,'Expected a successful integer vector case');
  assert.equal(test.kind,1,'Expected AIR text');
  assert(['dynamic','constants'].includes(test.integerMode),'Unknown integer mode');
  assert(typeof ir === 'string' && ir.length > 0 && ir.length < 2*1024*1024,'Invalid integer IR size');
  assert(ir.includes('!air.kernel'),'Missing kernel metadata');
  assert(!/\b(?:undef|poison)\b/.test(ir.replace(/(?:shufflevector|insertelement)[^\n]*/g,'')),'Undefined integer result');
  assert(!/\b(?:sito|uito)fp\b|\bfpto(?:si|ui)\b/.test(ir),'Integer operation converted through float');
  assert(!/call[^\n]*@(?:_Z|llvm\.)/.test(ir),'Unresolved integer helper or LLVM intrinsic');
  for(const type of ['int','uint']) for(const width of [2,3,4]) {
    const name=`integer_${test.integerMode}_${type}${width}`;
    const body=ir.match(new RegExp(`define void @${name}\\([^]*?\\n}`))?.[0];
    assert(body,`Missing kernel ${name}`);
    for (const symbol of ['clz','popcount','reverse_bits']) {
      assert(new RegExp(`call[^\\n]*@air\\.${symbol}\\.i32\\(`).test(body),`${name}: missing scalar AIR ${symbol}`);
    }
    assert(body.includes(`<${width} x i32>`),'Missing integer vector width');
    if(test.integerMode==='dynamic'){
      const lanes=new Map([...body.matchAll(/(%[\w.]+) = extractelement <\d+ x i32> (%[\w.]+), i32 (\d+)/g)].map(m=>[m[1],{input:m[2],lane:Number(m[3])}]));
      const definitions=new Map([...body.matchAll(/^\s*(%[\w.]+) = (.*)$/gm)].map(m=>[m[1],m[2]]));
      const stores=[...body.matchAll(new RegExp(`store <${width} x i32> (%[\\w.]+), <${width} x i32> addrspace\\(1\\)\\* (%[\\w.]+)`, 'g'))];
      assert.equal(stores.length,6,`${name}: missing dynamic output store`);
      const outputs=[];
      for(const store of stores){
        const pointer=store[2];
        const index=pointer==='%b'?0:Number(definitions.get(pointer)?.match(/getelementptr inbounds <\d+ x i32>, <\d+ x i32> addrspace\(1\)\* %b, i32 (\d+)$/)?.[1]);
        assert(Number.isInteger(index)&&index>=0&&index<6&&!outputs[index],`${name}: wrong output destination`);
        const result=Array(width),seen=new Set();let value=store[1];
        while(value!=='undef'&&value!=='poison'){
          assert(!seen.has(value), 'Cyclic vector construction');seen.add(value);
          const insert=definitions.get(value)?.match(/^insertelement <\d+ x i32> ([^,]+), i32 ([^,]+), i32 (\d+)$/);
          assert(insert,`${name}: output is not a constructed vector`);
          const lane=Number(insert[3]);assert(lane<width,'Invalid output lane');
          if(result[lane]===undefined)result[lane]=insert[2];value=insert[1];
        }
        assert.equal(result.filter(v=>v!==undefined).length,width,`${name}: undefined stored lane`);
        outputs[index]=result;
      }
      const binary=(value,op)=>definitions.get(value)?.match(new RegExp(`^${op} i32 ([^,]+), (.+)$`))?.slice(1);
      const hasFormula=(value,input)=>{
        const decrement=binary(value,'add');if(!decrement||decrement[1]!=='-1')return false;
        const mask=binary(decrement[0],'and');if(!mask||mask[0]!==input)return false;
        const neg=binary(mask[1],'sub');return neg?.[0]==='0'&&neg[1]===input;
      };
      let inputVector;
      for(const symbol of ['clz','popcount','reverse_bits']){
        const calls=[...body.matchAll(new RegExp(`(%[\\w.]+) = [^\\n]*call[^\\n]*@air\\.${symbol}\\.i32\\(i32 (?:noundef )?(%[\\w.]+)`, 'g'))];
        assert.equal(calls.length,width*(symbol==='popcount'?2:1),`${name}: wrong ${symbol} call count`);
        const direct=calls.filter(m=>lanes.has(m[2]));
        assert.equal(direct.length,width,`${name}: missing ${symbol} input lanes`);
        assert.equal(new Set(direct.map(m=>lanes.get(m[2]).lane)).size,width,`${name}: duplicated ${symbol} lane`);
        for(const m of direct){
          const {input,lane}=lanes.get(m[2]);
          inputVector??=input;
          assert.equal(input,inputVector,`${name}: wrong input vector`);
          assert(lane>=0&&lane<width,'Invalid input lane');
          const inserts=[...body.matchAll(/insertelement <\d+ x i32> [^,]+, i32 (%[\w.]+), i32 (\d+)/g)];
          assert(inserts.some(i=>i[1]===m[1]&&Number(i[2])===lane),`${name}: ${symbol} result in wrong lane`);
          const output={clz:0,popcount:2,reverse_bits:3}[symbol];
          assert.equal(outputs[output][lane],m[1],`${name}: ${symbol} result not stored`);
          if(symbol==='popcount'){
            const ctz=calls.filter(c=>hasFormula(c[2],m[2]));
            assert.equal(ctz.length,1,`${name}: wrong ctz lane formula`);
            assert.equal(outputs[1][lane],ctz[0][1],`${name}: ctz result not stored`);
          }
        }
      }

      // Trace the interior result, rather than accepting unrelated shifts
      // elsewhere in the kernel. This is a bounded SSA dependency check,
      // not a general LLVM interpreter; endpoint values are checked separately.
      const trace=value=>{
        const seen=new Set(),pending=[value];let operations='';
        while(pending.length){const v=pending.pop();if(seen.has(v))continue;seen.add(v);
          const definition=definitions.get(v);if(!definition)continue;
          operations+=definition+'\n';
          for(const ref of definition.match(/%[\w.]+/g)??[])pending.push(ref);
        }return {seen,operations};
      };
      for(let lane=0;lane<width;lane++){
        const x=[...lanes].find(([,v])=>v.input===inputVector&&v.lane===lane)?.[0];
        const phiValues=value=>[...(definitions.get(value)??'').matchAll(/\[ ([^,]+), %[^\]]+ \]/g)].map(m=>m[1]);
        const extracted=phiValues(outputs[4][lane]);
        assert.equal(extracted.length,3,`${name}: extraction is not endpoint guarded`);
        assert(extracted.includes(x)&&extracted.includes('0'),`${name}: extraction uses wrong lane/endpoints`);
        const interior=trace(extracted.find(v=>v!==x&&v!=='0'));
        assert(interior.seen.has(x)&&/\blshr\b/.test(interior.operations),`${name}: extraction interior disconnected`);
        if(type==='int')assert(/\bashr\b/.test(interior.operations),`${name}: signed extraction interior lost`);
        const inserted=phiValues(outputs[5][lane]);
        assert.equal(inserted.length,3,`${name}: insertion is not endpoint guarded`);
        assert(inserted.includes(x),`${name}: insertion uses wrong base lane`);
        const y=inserted.find(v=>{const value=lanes.get(v);return value&&(value.input===inputVector?value.lane===width+lane:value.lane===lane);});
        assert(y,`${name}: insertion uses wrong value lane`);
        const insertion=trace(inserted.find(v=>v!==x&&v!==y));
        assert(insertion.seen.has(x)&&insertion.seen.has(y)&&/\bshl\b/.test(insertion.operations)&&/\band\b/.test(insertion.operations)&&/\bor\b/.test(insertion.operations),`${name}: insertion interior disconnected`);
      }
      assert(/\blshr\b/.test(body),'Missing logical extraction');
      if(type==='int') assert(/\bashr\b/.test(body),'Missing signed extraction');
      assert(/\bshl\b/.test(body) && /\band\b/.test(body),'Missing insertion bit operations');
    }else{
      const x=[0,-2147483648,-1,-8].slice(0,width);
      const extract=(type==='int'?[0,-8,-1,-1]:[0,8,15,15]).slice(0,width);
      const inserted=[0,0,240,128].slice(0,width);
      const vector=a=>a.every(n=>n===0)?'zeroinitializer':`<${a.map(n=>`i32 ${n}`).join(', ')}>`;
      const stores=[...body.matchAll(new RegExp(`store volatile <${width} x i32> (.*?), <${width} x i32>`, 'g'))].map(m=>m[1]);
      assert.equal(stores.length,10,`${name}: missing output stores`);
      for(const [index,value] of [[4,Array(width).fill(0)],[5,x],[6,extract],[7,x],[8,x],[9,inserted]])
        assert.equal(stores[index],vector(value),`${name}: constant output ${index}`);
    }
  }
}
