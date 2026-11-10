import assert from 'node:assert/strict';
import test from 'node:test';
import { assertConditionalColorIR } from './conditional-color.mjs';

// Return metadata deliberately says uint4: it must never mask a wrong input.
const ir=`@enabled.MTL_FC_INIT_207_b = internal addrspace(2) constant i8 undef, section "air.fc_initializer", align 1
@__metal_implicit_fc_pred = internal addrspace(2) global i8 0, align 1
@llvm.global_ctors = appending global [1 x { i32, void ()*, i8* }] [{ i32, void ()*, i8* } { i32 65535, void ()* @__metal_fc_pred_init, i8* null }]
define internal void @__metal_fc_pred_init() #2 section "air.static_init" {
entry:
  %0 = load i8, i8 addrspace(2)* @enabled.MTL_FC_INIT_207_b, align 1
  %1 = tail call i8 @air.normalize_function_constant_predicate.i8(i8 %0)
  store i8 %1, i8 addrspace(2)* @__metal_implicit_fc_pred, align 1
  ret void
}
define { <4 x i32> } @example(<4 x i32> noundef %current) local_unnamed_addr #1 {
}
!air.fragment = !{!10}
!air.function_constants = !{!15}
!10 = !{{ <4 x i32> } (<4 x i32>)* @example, !11, !12}
!11 = !{!16}
!16 = !{!"air.render_target", i32 7, i32 0, !"air.arg_type_name", !"uint4", !"air.arg_name", !"value"}
!12 = !{!13}
!13 = !{i32 0, !"air.function_constant", !14, !"air.render_target", i32 7, !"air.arg_type_name", !"uint4", !"air.arg_name", !"current"}
!14 = !{i8 addrspace(2)* @__metal_implicit_fc_pred, !"bool", !"enabled"}
!15 = !{i8 addrspace(2)* @enabled.MTL_FC_INIT_207_b, !"bool", !"enabled", i32 207, i1 true}
`;
const specs=[{entry:'example',parameters:[{name:'current',index:0,type:'uint4',slot:7,constant:'enabled',constantIndex:207}]}];
const check=value=>assertConditionalColorIR(value,specs);
test('valid parameter-bound unsigned metadata',()=>check(ir));
for(const [name,from,to] of [
  ['wrong input type despite uint output','!"uint4", !"air.arg_name", !"current"','!"float4", !"air.arg_name", !"current"'],
  ['wrong parameter index','!13 = !{i32 0','!13 = !{i32 1'],
  ['wrong slot','!"air.render_target", i32 7, !"air.arg_type_name"','!"air.render_target", i32 0, !"air.arg_type_name"'],
  ['wrong input list','@example, !11, !12','@example, !11, !11'],
  ['wrong fragment','* @example,','* @decoy,'],
  ['wrong signature','(<4 x i32> noundef %current)','(<4 x float> noundef %current)'],
  ['wrong predicate name','!"bool", !"enabled"}\n','!"bool", !"other"}\n'],
  ['wrong constant index','i32 207, i1 true','i32 200, i1 true'],
  ['wrong initializer','@enabled.MTL_FC_INIT_207_b','@other.MTL_FC_INIT_207_b'],
  ['optional constant','i32 207, i1 true','i32 207, i1 false'],
  ['unreferenced constant','!air.function_constants = !{!15}','!air.function_constants = !{}'],
  ['wrong predicate global','* @__metal_implicit_fc_pred, !"bool"','* @__metal_implicit_fc_pred.3, !"bool"'],
  ['wrong predicate load','load i8, i8 addrspace(2)* @enabled.MTL_FC_INIT_207_b','load i8, i8 addrspace(2)* @other.MTL_FC_INIT_207_b'],
  ['wrong normalization source','predicate.i8(i8 %0)','predicate.i8(i8 %8)'],
  ['wrong normalized store','store i8 %1,','store i8 %0,'],
  ['unregistered constructor','void ()* @__metal_fc_pred_init,','void ()* @decoy,'],
  ['duplicate input','!12 = !{!13}','!12 = !{!13, !13}'],
  ['duplicate property','!"air.arg_type_name", !"uint4", !"air.arg_name", !"current"','!"air.arg_type_name", !"uint4", !"air.arg_type_name", !"uint4", !"air.arg_name", !"current"'],
]) test('reject '+name,()=>{ assert(ir.includes(from)); assert.throws(()=>check(ir.replace(from,to))); });
