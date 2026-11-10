// Real depth-view declarations remain bound to the installed immutable header.
  bool trustedDepthDeclaration(clang::FunctionDecl *function, const clang::AsmLabelAttr *attr) {
    if (!function || function->isVariadic() || function->hasBody()) return false;
    const auto &sm = function->getASTContext().getSourceManager();
    const auto entry = sm.getFileManager().getFile("/include/metal_depth");
    if (!entry) return false;
    const auto trustedID = sm.translateFile(*entry);
    if (trustedID.isInvalid()) return false;
    const auto physical = [&](clang::SourceLocation location) {
      return location.isValid() && !location.isMacroID() && sm.getFileID(location)==trustedID;
    };
    if (!physical(function->getLocation()) || !physical(attr->getLocation()) ||
        !physical(sm.getSpellingLoc(function->getLocation())) ||
        !physical(sm.getExpansionLoc(function->getLocation()))) return false;
    using T = TextureABIType;
    using B = clang::BuiltinType;
    const auto name = function->getQualifiedNameAsString();
    if (function->getNumParams()!=18 || !textureABITypeMatches(function->getReturnType(),T::Float4)) return false;
    if (name=="metal::__texture_detail::__compare_depth2d_array" && attr->getLabel()=="floor.opaque.read_image.depth2d_array.float.f2") {
      if (!function->getParamDecl(0)->getType()->isSpecificBuiltinType(B::OCLImage2dArrayDepth)) return false;
      const T parameters[]={T::Sampler,T::ULong,T::Float2,T::UInt,T::UInt,T::Int2,T::Int,T::Float,T::Bool,T::Bool,T::Bool,T::Float2,T::Float2,T::Bool,T::UInt,T::Float,T::Bool};
      for (unsigned i=0;i<17;++i)
        if (!textureABITypeMatches(function->getParamDecl(i+1)->getType(),parameters[i])) return false;
      return true;
    }
    if (name=="metal::__texture_detail::__compare_depthcube" && attr->getLabel()=="floor.opaque.read_image.depthcube.float.f3") {
      if (!function->getParamDecl(0)->getType()->isSpecificBuiltinType(B::OCLImageCubeDepth)) return false;
      const T parameters[]={T::Sampler,T::ULong,T::Float3,T::UInt,T::UInt,T::Int3,T::Int,T::Float,T::Bool,T::Bool,T::Bool,T::Float3,T::Float3,T::Bool,T::UInt,T::Float,T::Bool};
      for (unsigned i=0;i<17;++i)
        if (!textureABITypeMatches(function->getParamDecl(i+1)->getType(),parameters[i])) return false;
      return true;
    }
    return false;
  }
