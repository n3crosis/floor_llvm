// Exact authored texture prelude ABI allow-list; included inside RejectAssembly.
  enum class TextureABIType { Int, Void, Float, UInt, ULong, Bool, Sampler, Image2D, Image3D, Image2DArray, ImageCube, ImageBuffer, Float1, Float2, Float3, Float4, Int1, Int2, Int3, Int4 };
  static bool textureABITypeMatches(clang::QualType type, TextureABIType expected) {
    using B = clang::BuiltinType;
    using T = TextureABIType;
    switch (expected) {
    case T::Int: return type->isSpecificBuiltinType(B::Int);
    case T::Void: return type->isSpecificBuiltinType(B::Void);
    case T::Float: return type->isSpecificBuiltinType(B::Float);
    case T::UInt: return type->isSpecificBuiltinType(B::UInt);
    case T::ULong: return type->isSpecificBuiltinType(B::ULong);
    case T::Bool: return type->isSpecificBuiltinType(B::Bool);
    case T::Sampler: return type->isSpecificBuiltinType(B::OCLSampler);
    case T::Image2D: return type->isSpecificBuiltinType(B::OCLImage2d);
    case T::Image3D: return type->isSpecificBuiltinType(B::OCLImage3d);
    case T::Image2DArray: return type->isSpecificBuiltinType(B::OCLImage2dArray);
    case T::ImageCube: return type->isSpecificBuiltinType(B::OCLImageCube);
    case T::ImageBuffer: return type->isSpecificBuiltinType(B::OCLImage1dBuffer);
    default: break;
    }
    const auto *vector = type->getAs<clang::VectorType>();
    if (!vector) return false;
    switch (expected) {
    case T::Float1: return vector->getNumElements() == 1 && vector->getElementType()->isSpecificBuiltinType(B::Float);
    case T::Float2: return vector->getNumElements() == 2 && vector->getElementType()->isSpecificBuiltinType(B::Float);
    case T::Float3: return vector->getNumElements() == 3 && vector->getElementType()->isSpecificBuiltinType(B::Float);
    case T::Float4: return vector->getNumElements() == 4 && vector->getElementType()->isSpecificBuiltinType(B::Float);
    case T::Int1: return vector->getNumElements() == 1 && vector->getElementType()->isSpecificBuiltinType(B::Int);
    case T::Int2: return vector->getNumElements() == 2 && vector->getElementType()->isSpecificBuiltinType(B::Int);
    case T::Int3: return vector->getNumElements() == 3 && vector->getElementType()->isSpecificBuiltinType(B::Int);
    case T::Int4: return vector->getNumElements() == 4 && vector->getElementType()->isSpecificBuiltinType(B::Int);
    default: return false;
    }
  }
  bool trustedTextureDeclaration(clang::FunctionDecl *function, const clang::AsmLabelAttr *attr) {
    if (!function || function->isVariadic() || function->hasBody()) return false;
    const auto &sm = function->getASTContext().getSourceManager();
    const auto entry = sm.getFileManager().getFile("/include/metal_texture");
    if (!entry) return false;
    const auto trustedID = sm.translateFile(*entry);
    if (trustedID.isInvalid()) return false;
    const auto physical = [&](clang::SourceLocation location) {
      return location.isValid() && !location.isMacroID() &&
             sm.getFileID(location) == trustedID;
    };
    if (!physical(function->getLocation()) || !physical(attr->getLocation()) ||
        !physical(sm.getSpellingLoc(function->getLocation())) ||
        !physical(sm.getExpansionLoc(function->getLocation()))) return false;
    struct Signature { const char *declaration; const char *symbol; TextureABIType result;
                       unsigned count; TextureABIType parameters[18]; };
    using T = TextureABIType;
    static const Signature signatures[] = {
      {"metal::__texture_detail::__sample_texture2d","floor.opaque.read_image.texture2d.float.f2",T::Float4,18,{T::Image2D,T::Sampler,T::ULong,T::Float2,T::UInt,T::UInt,T::Int2,T::Int,T::Float,T::Bool,T::Bool,T::Bool,T::Float2,T::Float2,T::Bool,T::UInt,T::Float,T::Bool}},
      {"metal::__texture_detail::__read_texture2d","floor.opaque.read_image.texture2d.float.i2",T::Float4,18,{T::Image2D,T::UInt,T::ULong,T::Int2,T::UInt,T::UInt,T::Int2,T::Int,T::Float,T::Bool,T::Bool,T::Bool,T::Float2,T::Float2,T::Bool,T::UInt,T::Float,T::Bool}},
      {"metal::__texture_detail::__gather_texture2d","floor.opaque.gather_image.texture2d.float",T::Float4,7,{T::Image2D,T::Sampler,T::ULong,T::Float2,T::UInt,T::Int2,T::UInt}},
      {"metal::__texture_detail::__width_texture2d","air.get_width_texture_2d",T::UInt,2,{T::Image2D,T::UInt}},
      {"metal::__texture_detail::__height_texture2d","air.get_height_texture_2d",T::UInt,2,{T::Image2D,T::UInt}},
      {"metal::__texture_detail::__num_mip_levels_texture2d","air.get_num_mip_levels_texture_2d",T::UInt,1,{T::Image2D}},
      {"metal::__texture_detail::__write_texture2d","floor.opaque.write_image.texture2d.float.i2",T::Void,7,{T::Image2D,T::ULong,T::Int2,T::UInt,T::UInt,T::Bool,T::Float4}},
      {"metal::__texture_detail::__sample_texture3d","floor.opaque.read_image.texture3d.float.f3",T::Float4,18,{T::Image3D,T::Sampler,T::ULong,T::Float3,T::UInt,T::UInt,T::Int3,T::Int,T::Float,T::Bool,T::Bool,T::Bool,T::Float3,T::Float3,T::Bool,T::UInt,T::Float,T::Bool}},
      {"metal::__texture_detail::__read_texture3d","floor.opaque.read_image.texture3d.float.i3",T::Float4,18,{T::Image3D,T::UInt,T::ULong,T::Int3,T::UInt,T::UInt,T::Int3,T::Int,T::Float,T::Bool,T::Bool,T::Bool,T::Float3,T::Float3,T::Bool,T::UInt,T::Float,T::Bool}},
      {"metal::__texture_detail::__width_texture3d","air.get_width_texture_3d",T::UInt,2,{T::Image3D,T::UInt}},
      {"metal::__texture_detail::__height_texture3d","air.get_height_texture_3d",T::UInt,2,{T::Image3D,T::UInt}},
      {"metal::__texture_detail::__num_mip_levels_texture3d","air.get_num_mip_levels_texture_3d",T::UInt,1,{T::Image3D}},
      {"metal::__texture_detail::__depth_texture3d","air.get_depth_texture_3d",T::UInt,2,{T::Image3D,T::UInt}},
      {"metal::__texture_detail::__write_texture3d","floor.opaque.write_image.texture3d.float.i3",T::Void,7,{T::Image3D,T::ULong,T::Int3,T::UInt,T::UInt,T::Bool,T::Float4}},
      {"metal::__texture_detail::__sample_texture2d_array","floor.opaque.read_image.texture2d_array.float.f2",T::Float4,18,{T::Image2DArray,T::Sampler,T::ULong,T::Float2,T::UInt,T::UInt,T::Int2,T::Int,T::Float,T::Bool,T::Bool,T::Bool,T::Float2,T::Float2,T::Bool,T::UInt,T::Float,T::Bool}},
      {"metal::__texture_detail::__read_texture2d_array","floor.opaque.read_image.texture2d_array.float.i2",T::Float4,18,{T::Image2DArray,T::UInt,T::ULong,T::Int2,T::UInt,T::UInt,T::Int2,T::Int,T::Float,T::Bool,T::Bool,T::Bool,T::Float2,T::Float2,T::Bool,T::UInt,T::Float,T::Bool}},
      {"metal::__texture_detail::__gather_texture2d_array","floor.opaque.gather_image.texture2d_array.float",T::Float4,7,{T::Image2DArray,T::Sampler,T::ULong,T::Float2,T::UInt,T::Int2,T::UInt}},
      {"metal::__texture_detail::__width_texture2d_array","air.get_width_texture_2d_array",T::UInt,2,{T::Image2DArray,T::UInt}},
      {"metal::__texture_detail::__height_texture2d_array","air.get_height_texture_2d_array",T::UInt,2,{T::Image2DArray,T::UInt}},
      {"metal::__texture_detail::__num_mip_levels_texture2d_array","air.get_num_mip_levels_texture_2d_array",T::UInt,1,{T::Image2DArray}},
      {"metal::__texture_detail::__array_size_texture2d_array","air.get_array_size_texture_2d_array",T::UInt,1,{T::Image2DArray}},
      {"metal::__texture_detail::__sample_texturecube","floor.opaque.read_image.texturecube.float.f3",T::Float4,18,{T::ImageCube,T::Sampler,T::ULong,T::Float3,T::UInt,T::UInt,T::Int3,T::Int,T::Float,T::Bool,T::Bool,T::Bool,T::Float3,T::Float3,T::Bool,T::UInt,T::Float,T::Bool}},
      {"metal::__texture_detail::__read_texturecube","floor.opaque.read_image.texturecube.float.i3",T::Float4,18,{T::ImageCube,T::UInt,T::ULong,T::Int3,T::UInt,T::UInt,T::Int3,T::Int,T::Float,T::Bool,T::Bool,T::Bool,T::Float3,T::Float3,T::Bool,T::UInt,T::Float,T::Bool}},
      {"metal::__texture_detail::__gather_texturecube","floor.opaque.gather_image.texturecube.float",T::Float4,7,{T::ImageCube,T::Sampler,T::ULong,T::Float3,T::UInt,T::Int2,T::UInt}},
      {"metal::__texture_detail::__width_texturecube","air.get_width_texture_cube",T::UInt,2,{T::ImageCube,T::UInt}},
      {"metal::__texture_detail::__height_texturecube","air.get_height_texture_cube",T::UInt,2,{T::ImageCube,T::UInt}},
      {"metal::__texture_detail::__num_mip_levels_texturecube","air.get_num_mip_levels_texture_cube",T::UInt,1,{T::ImageCube}},
      {"metal::__texture_detail::__read_buffer","floor.opaque.read_image.buffer.float.i1",T::Float4,18,{T::ImageBuffer,T::UInt,T::ULong,T::Int1,T::UInt,T::UInt,T::Int1,T::Int,T::Float,T::Bool,T::Bool,T::Bool,T::Float1,T::Float1,T::Bool,T::UInt,T::Float,T::Bool}},
    };
    const auto declaration = function->getQualifiedNameAsString();
    for (const auto &signature : signatures) {
      if (declaration != signature.declaration || attr->getLabel() != signature.symbol ||
          function->getNumParams() != signature.count ||
          !textureABITypeMatches(function->getReturnType(), signature.result)) continue;
      bool matches = true;
      for (unsigned i=0; i<signature.count; ++i)
        matches &= textureABITypeMatches(function->getParamDecl(i)->getType(), signature.parameters[i]);
      if (matches) return true;
    }
    return false;
  }
