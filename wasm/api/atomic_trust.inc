// Exact reference-derived atomic ABI; included inside RejectAssembly.
  bool trustedAtomicDeclaration(clang::FunctionDecl *function, const clang::AsmLabelAttr *attr) {
    const auto &sm=function->getASTContext().getSourceManager();
    auto file=sm.getFileManager().getFile("/include/metal_atomic");
    if (!file) return false;
    auto id=sm.translateFile(*file);
    auto physical=[&](clang::SourceLocation loc) { return loc.isValid() && !loc.isMacroID() && sm.getFileID(loc)==id; };
    if (id.isInvalid() || !physical(function->getLocation()) || !physical(attr->getLocation()) ||
        !physical(sm.getSpellingLoc(function->getLocation())) || !physical(sm.getExpansionLoc(function->getLocation()))) return false;
    auto is=[](clang::QualType type, clang::BuiltinType::Kind kind) { return type->isSpecificBuiltinType(kind); };
    const auto name=attr->getLabel();
    using B=clang::BuiltinType;
    if (name=="air.wg.barrier" || name=="air.simdgroup.barrier") {
      // The real language selection, not a user-redefined feature macro,
      // controls trust in the versioned ABI embedded in the physical header.
      const bool metal41=function->getASTContext().getLangOpts().MetalVersion==410;
      if ((!metal41 && name!="air.wg.barrier") ||
          !function->hasAttr<clang::ConvergentAttr>() || !is(function->getReturnType(),B::Void) ||
          function->getNumParams()!=(metal41 ? 3u : 2u)) return false;
      for (unsigned i=0;i<function->getNumParams();++i)
        if (!is(function->getParamDecl(i)->getType(),B::UInt)) return false;
      return true;
    }
    const bool global=name=="air.atomic.global.add.u.i32" || name=="air.atomic.global.min.u.i32";
    const bool local=name=="air.atomic.local.add.u.i32" || name=="air.atomic.local.min.u.i32" || name=="air.atomic.local.max.u.i32";
    const bool metal41=function->getASTContext().getLangOpts().MetalVersion==410;
    const unsigned count=metal41 ? 6u : 5u;
    if ((!global && !local) || function->getNumParams()!=count ||
        !is(function->getReturnType(),B::UInt) ||
        function->hasAttr<clang::ConstAttr>() || function->hasAttr<clang::PureAttr>()) return false;
    auto pointer=function->getParamDecl(0)->getType();
    if (!pointer->isPointerType()) return false;
    auto pointee=pointer->getPointeeType();
    if (!is(pointee,B::UInt) || pointee.getCVRQualifiers()!=0 ||
        pointee.getAddressSpace()!=(global ? clang::LangAS::opencl_global : clang::LangAS::opencl_local)) return false;
    for (unsigned i=1;i<count-1;++i) if (!is(function->getParamDecl(i)->getType(),B::UInt)) return false;
    return is(function->getParamDecl(count-1)->getType(),B::Bool);
  }
