// Focused CI-only test of the real writer; no production test ABI or substitute.
#include "llvm/AsmParser/Parser.h"
#include "llvm/Bitcode/BitcodeWriter.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Metadata.h"
#include "llvm/IR/Module.h"
#include "llvm/Support/SourceMgr.h"
#include "llvm/Support/raw_ostream.h"
#include <string>
#include <vector>
#include "no-arguments-ir.inc"

int main() {
  unsigned passed = 0;
  for (unsigned test = 0; test != 11; ++test) {
    llvm::LLVMContext context;
    llvm::SMDiagnostic error;
    auto module = llvm::parseAssemblyString(NoArgumentsIR, error, context);
    if (!module) { error.print("metadata-regressions", llvm::errs()); return 1; }
    if (test != 0) {
      auto string = [&](const char *value) -> llvm::Metadata * {
        return llvm::MDString::get(context, value);
      };
      auto integer = [&](unsigned value) -> llvm::Metadata * {
        return llvm::ConstantAsMetadata::get(llvm::ConstantInt::get(
          llvm::Type::getInt32Ty(context), value));
      };
      std::vector<llvm::Metadata *> patch{string("air.patch"), string("triangle"),
        string("air.patch_control_point_count"), integer(3)};
      if (test <= 3) patch.resize(test); // recognized but truncated
      if (test == 4) patch[1] = integer(3); // wrong primitive type
      if (test == 5) patch[3] = string("3"); // wrong count metadata kind
      if (test == 6) patch[3] = llvm::ConstantAsMetadata::get(
        llvm::ConstantFP::get(llvm::Type::getFloatTy(context), 3.0));
      if (test == 7) patch[1] = string("unsupported-primitive");
      if (test == 8) patch[3] = llvm::ConstantAsMetadata::get(
        llvm::ConstantInt::get(context, llvm::APInt::getOneBitSet(128, 100)));
      if (test == 9) patch[3] = integer(0);
      if (test == 10) patch[3] = integer(64);
      auto *named = module->getNamedMetadata("air.vertex");
      auto *entry = named->getOperand(0);
      std::vector<llvm::Metadata *> operands;
      for (const auto &operand : entry->operands()) operands.push_back(operand.get());
      operands.push_back(llvm::MDNode::get(context, patch));
      named->setOperand(0, llvm::MDNode::get(context, operands));
    }
    std::string bytes;
    llvm::raw_string_ostream output(bytes);
    const bool result = llvm::WriteMetalLibToFile(*module, output);
    output.flush();
    if (result != (test == 0)) {
      llvm::errs() << "metadata regression " << test << " returned " << result << "\n";
      return 1;
    }
    if (test != 0 && !bytes.empty()) {
      llvm::errs() << "malformed metadata produced output\n"; return 1;
    }
    if (test == 0 && (bytes.size() <= 4 || bytes.compare(0, 4, "MTLB") != 0)) {
      llvm::errs() << "missing real metallib output\n"; return 1;
    }
    ++passed;
  }
  llvm::outs() << "{\"schemaVersion\":1,\"realWriterCasesPassed\":" << passed
               << ",\"deviceQualified\":false}\n";
  return 0;
}
