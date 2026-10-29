#include "air_compiler.h"
#include "clang/Basic/Diagnostic.h"
#include "clang/Basic/SourceManager.h"
#include "clang/AST/Attr.h"
#include "clang/AST/RecursiveASTVisitor.h"
#include "clang/CodeGen/CodeGenAction.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/CompilerInvocation.h"
#include "clang/Frontend/MultiplexConsumer.h"
#include "clang/Lex/PPCallbacks.h"
#include "clang/Lex/Preprocessor.h"
#include "llvm/ADT/SmallString.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/Bitcode/BitcodeWriter.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Metadata.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Instructions.h"
#include "llvm/ADT/SmallPtrSet.h"
#include "llvm/IR/Verifier.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/VirtualFileSystem.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <memory>
#include <new>
#include <string>
#include <vector>

struct air_result {
  uint32_t status = AIR_OK;
  std::vector<uint8_t> data;
  std::string diagnostics;
};
namespace {
#include "compat_header.inc"
constexpr size_t SourceLimit = 4 * 1024 * 1024;
constexpr size_t OutputLimit = 64 * 1024 * 1024;
constexpr size_t DiagnosticLimit = 64 * 1024;
void appendDiagnostic(air_result &r, llvm::StringRef text) {
  const auto count = std::min(text.size(), DiagnosticLimit - r.diagnostics.size());
  r.diagnostics.append(text.data(), count);
}
class Diagnostics final : public clang::DiagnosticConsumer {
  air_result &result;
public:
  explicit Diagnostics(air_result &r) : result(r) {}
  void HandleDiagnostic(clang::DiagnosticsEngine::Level level,
                        const clang::Diagnostic &diagnostic) override {
    clang::DiagnosticConsumer::HandleDiagnostic(level, diagnostic);
    llvm::SmallString<256> message;
    diagnostic.FormatDiagnostic(message);
    appendDiagnostic(result, message);
    appendDiagnostic(result, "\n");
  }
};
/* A bounded output stream avoids allocating an unbounded result before a check.
 * Overflow does not turn partial output into a successful library.
 */
class Output final : public llvm::raw_ostream {
  std::vector<uint8_t> &bytes;
  bool exceeded = false;
  uint64_t position = 0;
  void write_impl(const char *data, size_t size) override {
    position += size;
    if (exceeded || size > OutputLimit - bytes.size()) {
      exceeded = true;
      return;
    }
    bytes.insert(bytes.end(), data, data + size);
  }
  uint64_t current_pos() const override { return position; }
public:
  explicit Output(std::vector<uint8_t> &data) : bytes(data) { SetUnbuffered(); }
  bool overflowed() const { return exceeded; }
};
class RejectAssembly final : public clang::RecursiveASTVisitor<RejectAssembly> {
#include "texture_trust.inc"
#include "depth_trust.inc"
#include "atomic_trust.inc"
  bool trustedMathDeclaration(clang::NamedDecl *decl, const clang::AsmLabelAttr *attr) {
    auto *function = llvm::dyn_cast<clang::FunctionDecl>(decl);
    if (!function || function->isVariadic() || function->hasBody()) return false;
    const auto &sm = decl->getASTContext().getSourceManager();
    auto trusted = [&](clang::SourceLocation loc) {
      if (loc.isInvalid() || loc.isMacroID()) return false;
      auto file = sm.getFileEntryRefForID(sm.getFileID(loc));
      return file && (file->getName() == "/include/metal_math" || file->getName() == "/include/metal_control" || file->getName() == "/include/metal_texture" || file->getName() == "/include/metal_depth" || file->getName() == "/include/metal_atomic" || file->getName() == "/include/metal_simd" || file->getName() == "/include/metal_integer" || file->getName() == "/include/metal_tessellation");
    };
    if (!trusted(sm.getSpellingLoc(decl->getLocation())) ||
        !trusted(sm.getExpansionLoc(decl->getLocation())) ||
        !trusted(attr->getLocation()) || decl->getLocation().isMacroID()) return false;
    const auto name = attr->getLabel();
    auto file = sm.getFileEntryRefForID(sm.getFileID(decl->getLocation()));
    if (file->getName() == "/include/metal_tessellation")
      return name == "floor.get_patch_control_point_count.i32" &&
          function->getNumParams() == 0 && function->hasAttr<clang::ConstAttr>() &&
          function->getReturnType()->isSpecificBuiltinType(clang::BuiltinType::UInt);
    if (file->getName() == "/include/metal_integer") {
      if (name=="air.abs.s.i32") return function->getNumParams()==1 && function->getReturnType()->isSpecificBuiltinType(clang::BuiltinType::Int) && function->getParamDecl(0)->getType()->isSpecificBuiltinType(clang::BuiltinType::Int);
      if (!function->getReturnType()->isSpecificBuiltinType(clang::BuiltinType::UInt) || !function->getNumParams() || !function->getParamDecl(0)->getType()->isSpecificBuiltinType(clang::BuiltinType::UInt)) return false;
      if (name=="air.popcount.i32" || name=="air.reverse_bits.i32") return function->getNumParams()==1;
      return name=="air.clz.i32" && function->getNumParams()==2 && function->getParamDecl(1)->getType()->isSpecificBuiltinType(clang::BuiltinType::Bool);
    }
    if (file->getName() == "/include/metal_simd") {
      if (!function->hasAttr<clang::ConvergentAttr>() ||
          function->hasAttr<clang::ConstAttr>() || function->hasAttr<clang::PureAttr>() ||
          function->getNumParams()!=1 ||
          !function->getParamDecl(0)->getType()->isSpecificBuiltinType(clang::BuiltinType::Bool)) return false;
      if (name=="air.simd_ballot.i64") return function->getReturnType()->isSpecificBuiltinType(clang::BuiltinType::ULong);
      return name=="air.simd_all" && function->getReturnType()->isSpecificBuiltinType(clang::BuiltinType::Bool);
    }
    if (file->getName() == "/include/metal_atomic") return trustedAtomicDeclaration(function, attr);
    if (file->getName() == "/include/metal_depth") return trustedDepthDeclaration(function, attr);
    if (file->getName() == "/include/metal_texture") return trustedTextureDeclaration(function, attr);
    if (file->getName() == "/include/metal_control") {
      auto is = [](clang::QualType type, clang::BuiltinType::Kind kind) { return type->isSpecificBuiltinType(kind); };
      if (name == "air.discard_fragment") return function->getNumParams()==0 && is(function->getReturnType(),clang::BuiltinType::Void);
      if (!function->hasAttr<clang::ConvergentAttr>() || !is(function->getReturnType(),clang::BuiltinType::Float)) return false;
      if (name == "air.dfdx.f32" || name == "air.dfdy.f32") return function->getNumParams()==1 && is(function->getParamDecl(0)->getType(),clang::BuiltinType::Float);
      if (name == "air.simd_shuffle.f32") return function->getNumParams()==2 && is(function->getParamDecl(0)->getType(),clang::BuiltinType::Float) && is(function->getParamDecl(1)->getType(),clang::BuiltinType::UShort);
      return false;
    }
    unsigned count = 0;
    for (const auto candidate : {"air.fast_sqrt.f32", "air.fast_rsqrt.f32",
          "air.fast_exp2.f32", "air.fast_log2.f32", "air.fast_sin.f32",
          "air.fast_cos.f32", "air.fast_ceil.f32", "air.fast_floor.f32",
          "air.fast_trunc.f32", "air.fast_rint.f32", "air.fast_fabs.f32"})
      if (name == candidate) count = 1;
    if (name == "air.fast_fmin.f32" || name == "air.fast_fmax.f32") count = 2;
    if (name == "air.fast_clamp.f32" || name == "air.fma.f32") count = 3;
    if (!count || function->getNumParams() != count ||
        !function->getReturnType()->isSpecificBuiltinType(clang::BuiltinType::Float)) return false;
    for (const auto *parameter : function->parameters())
      if (!parameter->getType()->isSpecificBuiltinType(clang::BuiltinType::Float)) return false;
    return true;
  }
public:
  bool rejected = false;
  bool VisitNamedDecl(clang::NamedDecl *decl) {
    if (const auto *attr = decl->getAttr<clang::AsmLabelAttr>())
      rejected |= !trustedMathDeclaration(decl, attr);
    return !rejected;
  }
  bool VisitFileScopeAsmDecl(clang::FileScopeAsmDecl *) { rejected = true; return false; }
  bool VisitGCCAsmStmt(clang::GCCAsmStmt *) { rejected = true; return false; }
  bool VisitMSAsmStmt(clang::MSAsmStmt *) { rejected = true; return false; }
};
class ValidateSource final : public clang::ASTConsumer {
  clang::DiagnosticsEngine &diagnostics;
  bool rejected = false;
  bool check(clang::Decl *decl) {
    if (rejected) return false;
    RejectAssembly assembly;
    assembly.TraverseDecl(decl);
    if (assembly.rejected) {
      rejected = true;
      diagnostics.Report(diagnostics.getCustomDiagID(
          clang::DiagnosticsEngine::Error,
          "assembly and assembly symbol labels are unsupported"));
    }
    return !rejected;
  }
public:
  explicit ValidateSource(clang::DiagnosticsEngine &d) : diagnostics(d) {}
  bool HandleTopLevelDecl(clang::DeclGroupRef group) override {
    for (auto *decl : group) if (!check(decl)) return false;
    return true;
  }
  void HandleTranslationUnit(clang::ASTContext &context) override {
    check(context.getTranslationUnitDecl());
  }
};
// Protect semantic diagnostics while preserving ordinary warning pragmas.
// The callback runs after Clang applies each diagnostic pragma. Reasserting
// these mappings also covers umbrella groups such as -Weverything.
class ProtectSemanticDiagnostics final : public clang::PPCallbacks {
  clang::DiagnosticsEngine &diagnostics;
  void protect(clang::SourceLocation location) {
    for (const char *group : {"unknown-attributes", "ignored-attributes", "unknown-pragmas"})
      diagnostics.setSeverityForGroup(clang::diag::Flavor::WarningOrError,
          group, clang::diag::Severity::Error, location);
  }
public:
  explicit ProtectSemanticDiagnostics(clang::DiagnosticsEngine &d) : diagnostics(d) {}
  void PragmaDiagnostic(clang::SourceLocation location, llvm::StringRef,
                        clang::diag::Severity, llvm::StringRef) override {
    protect(location);
  }
  void PragmaDiagnosticPop(clang::SourceLocation location, llvm::StringRef) override {
    protect(location);
  }
};
class CheckedLLVMAction final : public clang::EmitLLVMOnlyAction {
public:
  explicit CheckedLLVMAction(llvm::LLVMContext *context)
      : clang::EmitLLVMOnlyAction(context) {}
protected:
  std::unique_ptr<clang::ASTConsumer> CreateASTConsumer(
      clang::CompilerInstance &compiler, llvm::StringRef file) override {
    compiler.getPreprocessor().addPPCallbacks(
        std::make_unique<ProtectSemanticDiagnostics>(compiler.getDiagnostics()));
    auto codegen = clang::EmitLLVMOnlyAction::CreateASTConsumer(compiler, file);
    if (!codegen) return nullptr;
    std::vector<std::unique_ptr<clang::ASTConsumer>> consumers;
    consumers.push_back(std::make_unique<ValidateSource>(compiler.getDiagnostics()));
    consumers.push_back(std::move(codegen));
    return std::make_unique<clang::MultiplexConsumer>(std::move(consumers));
  }
};
bool validControlStages(const llvm::Module &module) {
  for (const auto *stage : {"air.kernel", "air.vertex", "air.fragment"}) {
    const auto *entries=module.getNamedMetadata(stage);
    if (!entries) continue;
    for (const auto *entry : entries->operands()) {
      auto *value=llvm::dyn_cast<llvm::ValueAsMetadata>(entry->getOperand(0));
      auto *function=value ? llvm::dyn_cast<llvm::Function>(value->getValue()) : nullptr;
      if (!function) return false;
      std::vector<const llvm::Function *> pending{function};
      llvm::SmallPtrSet<const llvm::Function *,16> visited;
      while (!pending.empty()) {
        const auto *current=pending.back(); pending.pop_back();
        if (!visited.insert(current).second) continue;
        for (const auto &block:*current) for (const auto &instruction:block) {
          const auto *call=llvm::dyn_cast<llvm::CallBase>(&instruction);
          if (!call) continue;
          const auto *callee=llvm::dyn_cast<llvm::Function>(call->getCalledOperand()->stripPointerCasts());
          if (!callee) return false;
          const auto name=callee->getName();
          if ((name=="air.dfdx.f32" || name=="air.dfdy.f32" || name=="air.discard_fragment") && llvm::StringRef(stage)!="air.fragment") return false;
          // Fragment and compute shuffle signatures are established by supplied references.
          if (name=="air.simd_shuffle.f32" && llvm::StringRef(stage)=="air.vertex") return false;
          auto constant=[&](unsigned index, uint64_t expected) {
            if (index>=call->arg_size()) return false;
            auto *value=llvm::dyn_cast<llvm::ConstantInt>(call->getArgOperand(index));
            return value && value->getZExtValue()==expected;
          };
          if (name=="air.clz.i32" && !constant(1,0)) return false;
          if ((name=="air.simd_ballot.i64" || name=="air.simd_all") && llvm::StringRef(stage)!="air.kernel") return false;
          if (name.startswith("air.atomic.")) {
            // Only the reference-established device uint add extends to fragments.
            const bool fragmentAdd=llvm::StringRef(stage)=="air.fragment" &&
                name=="air.atomic.global.add.u.i32";
            if ((llvm::StringRef(stage)!="air.kernel" && !fragmentAdd) || !constant(2,0) ||
                !constant(3,name.startswith("air.atomic.global.") ? 2 : 1) || !constant(4,1)) return false;
          }
          if (name=="air.wg.barrier" && (llvm::StringRef(stage)!="air.kernel" || !constant(0,2) || !constant(1,1))) return false;
          if (!callee->isDeclaration()) pending.push_back(callee);
        }
      }
    }
  }
  return true;
}
bool matchesPatchFieldType(llvm::Type *type, llvm::StringRef name) {
  if (auto *vector = llvm::dyn_cast<llvm::FixedVectorType>(type)) {
    const auto width = vector->getNumElements();
    if (width < 2 || width > 4 || !name.consume_back(std::to_string(width))) return false;
    type = vector->getElementType();
  }
  if (name == "float") return type->isFloatTy();
  if (name == "half") return type->isHalfTy();
  if (name == "double") return type->isDoubleTy();
  if (name == "bool") return type->isIntegerTy(1) || type->isIntegerTy(8);
  if (name == "char" || name == "uchar") return type->isIntegerTy(8);
  if (name == "short" || name == "ushort") return type->isIntegerTy(16);
  if (name == "int" || name == "uint") return type->isIntegerTy(32);
  if (name == "long" || name == "ulong") return type->isIntegerTy(64);
  return false;
}

// Control-point getters are externally provided by Metal's patch interface,
// not arbitrary unresolved user functions. Accept only a declaration linked
// by the same patch entry's input metadata and the exact opaque-handle ABI.
bool isPatchControlPointGetter(const llvm::Module &module,
                              const llvm::Function &function) {
  if (!function.isDeclaration() || function.isVarArg() ||
      function.getSection() != "air.externally_defined" ||
      !function.getName().endswith(".MTL_CONTROL_POINT_FN") ||
      function.arg_size() != 2 || !function.getArg(0)->getType()->isIntegerTy(32) ||
      !function.getArg(1)->getType()->isPointerTy() ||
      !function.getReturnType()->isStructTy()) return false;
  const auto *handleType = llvm::cast<llvm::PointerType>(function.getArg(1)->getType());
  const auto *opaqueType = llvm::dyn_cast<llvm::StructType>(handleType->getPointerElementType());
  if (handleType->getAddressSpace() != 0 || !opaqueType || !opaqueType->isOpaque() ||
      opaqueType->getName() != "struct._patch_control_point_t") return false;
  const auto *entries = module.getNamedMetadata("air.vertex");
  if (!entries) return false;
  for (const auto *entry : entries->operands()) {
    if (entry->getNumOperands() != 4) continue;
    const auto *entryValue = llvm::dyn_cast<llvm::ValueAsMetadata>(entry->getOperand(0));
    const auto *entryFunction = entryValue ? llvm::dyn_cast<llvm::Function>(entryValue->getValue()) : nullptr;
    const auto *inputs = llvm::dyn_cast<llvm::MDNode>(entry->getOperand(2));
    const auto *patch = llvm::dyn_cast<llvm::MDNode>(entry->getOperand(3));
    if (!entryFunction || !inputs || !patch || patch->getNumOperands() != 4) continue;
    const auto *patchKey = llvm::dyn_cast<llvm::MDString>(patch->getOperand(0));
    const auto *primitive = llvm::dyn_cast<llvm::MDString>(patch->getOperand(1));
    const auto *countKey = llvm::dyn_cast<llvm::MDString>(patch->getOperand(2));
    const auto *count = llvm::mdconst::dyn_extract<llvm::ConstantInt>(patch->getOperand(3));
    if (!patchKey || patchKey->getString() != "air.patch" || !primitive ||
        (primitive->getString() != "triangle" && primitive->getString() != "quad") ||
        !countKey || countKey->getString() != "air.patch_control_point" ||
        !count || count->getValue().ugt(32)) continue;
    for (const auto &operand : inputs->operands()) {
      const auto *input = llvm::dyn_cast<llvm::MDNode>(operand.get());
      if (!input || input->getNumOperands() < 4) continue;
      const auto *index = llvm::mdconst::dyn_extract<llvm::ConstantInt>(input->getOperand(0));
      const auto *semantic = llvm::dyn_cast<llvm::MDString>(input->getOperand(1));
      const auto *getter = llvm::dyn_cast<llvm::MDNode>(input->getOperand(2));
      if (!index || index->getValue().uge(entryFunction->arg_size()) || !semantic ||
          semantic->getString() != "air.patch_control_point_input" || !getter ||
          getter->getNumOperands() != 2 ||
          entryFunction->getArg(unsigned(index->getZExtValue()))->getType() != function.getArg(1)->getType()) continue;
      const auto *getterKey = llvm::dyn_cast<llvm::MDString>(getter->getOperand(0));
      const auto *getterValue = llvm::dyn_cast<llvm::ValueAsMetadata>(getter->getOperand(1));
      if (getterKey && getterKey->getString() == "air.patch_control_point_function" &&
          getterValue && getterValue->getValue() == &function &&
          function.getReturnType()->getStructNumElements() == input->getNumOperands() - 3) {
        bool fieldsMatch = true;
        uint32_t locations = 0;
        for (unsigned i = 3; i < input->getNumOperands(); ++i) {
          const auto *field = llvm::dyn_cast<llvm::MDNode>(input->getOperand(i));
          if (!field || field->getNumOperands() != 7) { fieldsMatch = false; break; }
          const auto *locationKey = llvm::dyn_cast<llvm::MDString>(field->getOperand(0));
          const auto *location = llvm::mdconst::dyn_extract<llvm::ConstantInt>(field->getOperand(1));
          const auto *extent = llvm::mdconst::dyn_extract<llvm::ConstantInt>(field->getOperand(2));
          const auto *typeKey = llvm::dyn_cast<llvm::MDString>(field->getOperand(3));
          const auto *typeName = llvm::dyn_cast<llvm::MDString>(field->getOperand(4));
          if (!locationKey || locationKey->getString() != "air.location_index" ||
              !location || location->getValue().uge(32) || !extent || !extent->isOne() ||
              !typeKey || typeKey->getString() != "air.arg_type_name" || !typeName ||
              !matchesPatchFieldType(function.getReturnType()->getStructElementType(i - 3), typeName->getString()) ||
              (locations & (uint32_t(1) << location->getZExtValue()))) { fieldsMatch = false; break; }
          locations |= uint32_t(1) << location->getZExtValue();
        }
        if (fieldsMatch) return true;
      }
    }
  }
  return false;
}

// MetalFinal strips implicit parameters before the last InstCombine/GVN/ADCE
// cleanups. Inspect the frontend-final module here, so an already-unused
// retained fragment input can be marked without changing its ABI. The metallib
// writer later clones/internalizes/optimizes globals; this is not a claim to
// discover every additional input that might become unused only in that writer.
bool finalizeFragmentInputLiveness(llvm::Module &module) {
  auto *entries = module.getNamedMetadata("air.fragment");
  if (!entries) return true;
  auto &context = module.getContext();
  for (unsigned entryIndex = 0; entryIndex < entries->getNumOperands(); ++entryIndex) {
    const auto *entry = entries->getOperand(entryIndex);
    if (entry->getNumOperands() < 3) return false;
    const auto *value = llvm::dyn_cast_or_null<llvm::ValueAsMetadata>(entry->getOperand(0).get());
    const auto *function = value ? llvm::dyn_cast<llvm::Function>(value->getValue()) : nullptr;
    const auto *inputs = llvm::dyn_cast_or_null<llvm::MDNode>(entry->getOperand(2).get());
    if (!function || function->isDeclaration() || !inputs) return false;
    llvm::SmallVector<llvm::Metadata *, 16> newInputs;
    bool changed = false;
    for (const auto &operand : inputs->operands()) {
      newInputs.push_back(operand.get());
      const auto *input = llvm::dyn_cast_or_null<llvm::MDNode>(operand.get());
      if (!input || input->getNumOperands() < 2) return false;
      const auto *semantic = llvm::dyn_cast_or_null<llvm::MDString>(input->getOperand(1).get());
      if (!semantic) return false;
      // Do not infer liveness metadata for resources, other builtins or stages.
      if (semantic->getString() != "air.fragment_input" &&
          semantic->getString() != "air.position") continue;
      const auto *index = llvm::mdconst::dyn_extract_or_null<llvm::ConstantInt>(input->getOperand(0).get());
      if (!index || !index->getType()->isIntegerTy(32) ||
          index->getValue().uge(function->arg_size())) return false;
      if (!function->getArg(unsigned(index->getZExtValue()))->use_empty()) continue;
      bool alreadyUnused = false;
      for (const auto &field : input->operands()) {
        const auto *key = llvm::dyn_cast_or_null<llvm::MDString>(field.get());
        alreadyUnused |= key && key->getString() == "air.arg_unused";
      }
      if (alreadyUnused) continue;
      // Clone rather than mutate potentially shared descriptors. Preserve every
      // existing operand and append the zero-operand flag in reference order.
      llvm::SmallVector<llvm::Metadata *, 16> fields;
      for (const auto &field : input->operands()) fields.push_back(field.get());
      fields.push_back(llvm::MDString::get(context, "air.arg_unused"));
      newInputs.back() = llvm::MDNode::get(context, fields);
      changed = true;
    }
    if (!changed) continue;
    llvm::SmallVector<llvm::Metadata *, 4> entryFields;
    for (const auto &field : entry->operands()) entryFields.push_back(field.get());
    entryFields[2] = llvm::MDNode::get(context, newInputs);
    entries->setOperand(entryIndex, llvm::MDNode::get(context, entryFields));
  }
  return true;
}

bool hasEntry(const llvm::Module &module) {
  for (const auto *name : {"air.kernel", "air.vertex", "air.fragment"})
    if (const auto *node = module.getNamedMetadata(name))
      if (node->getNumOperands()) return true;
  return false;
}
}

static air_result *compile(const uint8_t *source, size_t source_size,
                                     uint32_t ios_major, uint32_t output_kind, uint32_t math_profile) {
  auto result = std::unique_ptr<air_result>(new (std::nothrow) air_result());
  if (!result) return nullptr;
  if (!source || !source_size || source_size > SourceLimit) {
    result->status = AIR_BAD_INPUT;
    appendDiagnostic(*result, "Source must contain between 1 and 4194304 bytes.\n");
    return result.release();
  }
  if ((ios_major != 18 && ios_major != 26) || output_kind > AIR_LLVM_TEXT || math_profile > 1) {
    result->status = AIR_BAD_OPTIONS;
    appendDiagnostic(*result, "Unsupported target or output kind.\n");
    return result.release();
  }
  Diagnostics diagnostic(*result);
  clang::CompilerInstance compiler;
  compiler.createDiagnostics(&diagnostic, false);
  auto invocation = std::make_shared<clang::CompilerInvocation>();
  const char *triple = ios_major == 18 ? "air64-apple-ios18.0.0" : "air64-apple-ios26.0.0";
  std::vector<const char *> args = {
    "-triple", triple, "-x", "metal", "-std=metal3.2", "-O2",
    "-flegacy-pass-manager", "-emit-llvm", "-nostdsysteminc", "-nobuiltininc",
    "-I/include", "-include", "metal_stdlib",
    "-Werror=unknown-attributes", "-Werror=ignored-attributes",
    "-Werror=unknown-pragmas", "-ferror-limit", "20", "/input/shader.metal"
  };
  if (math_profile == 1) {
    for (const char *flag : {"-DAIR_FAST_MATH=1", "-cl-single-precision-constant", "-ffast-math", "-ffp-contract=fast",
        "-fno-signed-zeros", "-menable-no-infs", "-menable-no-nans"}) args.insert(args.end() - 1, flag);
  }
  if (!clang::CompilerInvocation::CreateFromArgs(*invocation, args,
                                                compiler.getDiagnostics())) {
    result->status = AIR_BAD_OPTIONS;
    return result.release();
  }
  // The pinned fork ignores -fconvergent-functions and forces this off.
  // Set the actual frontend option before code generation, so unannotated
  // helpers cannot hide lane-dependent operations from early optimizations.
  invocation->getLangOpts()->ConvergentFunctions = true;
  compiler.setInvocation(std::move(invocation));
  clang::ProcessWarningOptions(compiler.getDiagnostics(), compiler.getDiagnosticOpts());
  auto filesystem = llvm::makeIntrusiveRefCnt<llvm::vfs::InMemoryFileSystem>();
  filesystem->setCurrentWorkingDirectory("/");
  filesystem->addFile("/input/shader.metal", 0,
      llvm::MemoryBuffer::getMemBufferCopy(
          llvm::StringRef(reinterpret_cast<const char *>(source), source_size),
          "/input/shader.metal"));
  for (const auto &header : CompatibilityHeaders)
    filesystem->addFile(header.path, 0, llvm::MemoryBuffer::getMemBufferCopy(header.content, header.path));
  compiler.createFileManager(filesystem);
  compiler.createSourceManager(compiler.getFileManager());
  llvm::LLVMContext context;
  CheckedLLVMAction action(&context);
  if (!compiler.ExecuteAction(action) || compiler.getDiagnostics().hasErrorOccurred()) {
    result->status = AIR_FRONTEND_FAILED;
    return result.release();
  }
  auto module = action.takeModule();
  if (!module) {
    result->status = AIR_INVALID_IR;
    appendDiagnostic(*result, "Frontend did not produce an LLVM module.\n");
    return result.release();
  }
  // Both text and metallib serialization consume this same finalized module.
  // Keep the existing verifier and all subsequent integrity checks in place.
  if (!finalizeFragmentInputLiveness(*module)) {
    result->status = AIR_INVALID_IR;
    appendDiagnostic(*result, "Invalid AIR fragment input metadata.\n");
    return result.release();
  }
  std::string verification;
  llvm::raw_string_ostream errors(verification);
  if (llvm::verifyModule(*module, &errors)) {
    errors.flush();
    result->status = AIR_INVALID_IR;
    appendDiagnostic(*result, verification);
    return result.release();
  }
  if (!hasEntry(*module)) {
    result->status = AIR_NO_ENTRY;
    appendDiagnostic(*result, "No AIR entry point was generated.\n");
    return result.release();
  }
  if (!validControlStages(*module)) {
    result->status = AIR_INVALID_IR;
    appendDiagnostic(*result, "Unsupported shader stage for a control intrinsic, or unresolved indirect call.\n");
    return result.release();
  }
  for (const auto &function : *module) {
    if (function.isDeclaration() && !function.isIntrinsic() &&
        !function.getName().startswith("air.") &&
        !isPatchControlPointGetter(*module, function)) {
      result->status = AIR_UNRESOLVED_SYMBOL;
      appendDiagnostic(*result, "Unresolved external function: ");
      appendDiagnostic(*result, function.getName());
      appendDiagnostic(*result, "\n");
      return result.release();
    }
  }
  for (const auto &global : module->globals()) {
    if (global.isDeclaration()) {
      result->status = AIR_UNRESOLVED_SYMBOL;
      appendDiagnostic(*result, "Unresolved external global: ");
      appendDiagnostic(*result, global.getName());
      appendDiagnostic(*result, "\n");
      return result.release();
    }
  }
  Output output(result->data);
  bool writerSucceeded = true;
  if (output_kind == AIR_LLVM_TEXT)
    module->print(output, nullptr);
  else
    writerSucceeded = llvm::WriteMetalLibToFile(*module, output);
  output.flush();
  if (output.overflowed()) {
    result->data.clear();
    result->status = AIR_OUTPUT_LIMIT;
    appendDiagnostic(*result, "Compiled output exceeded 67108864 bytes.\n");
  } else if (!writerSucceeded) {
    result->data.clear();
    result->status = AIR_INVALID_IR;
    appendDiagnostic(*result, "Metal library serialization failed.\n");
  }
  return result.release();
}
extern "C" uint32_t air_result_status(const air_result *r) {
  return r ? r->status : AIR_BAD_INPUT;
}
extern "C" const uint8_t *air_result_data(const air_result *r) {
  return r && !r->data.empty() ? r->data.data() : nullptr;
}
extern "C" size_t air_result_size(const air_result *r) { return r ? r->data.size() : 0; }
extern "C" const char *air_result_diagnostics(const air_result *r) {
  return r ? r->diagnostics.c_str() : "No compilation result.";
}
extern "C" size_t air_result_diagnostics_size(const air_result *r) {
  return r ? r->diagnostics.size() : sizeof("No compilation result.") - 1;
}
extern "C" void air_result_free(air_result *r) { delete r; }

extern "C" const char *air_compiler_header_sha256(void) { return CompatibilityHeaderSHA256; }

extern "C" air_result *air_compile_v1(const uint8_t *source, size_t size, uint32_t ios, uint32_t output) {
  return compile(source, size, ios, output, 0);
}
extern "C" air_result *air_compile_v2(const uint8_t *source, size_t size, uint32_t ios, uint32_t output, uint32_t math_profile) {
  return compile(source, size, ios, output, math_profile);
}
extern "C" uint32_t air_compiler_header_bundle_version(void) { return 2; }
