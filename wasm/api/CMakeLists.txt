cmake_minimum_required(VERSION 3.20)
project(floor_air_api LANGUAGES C CXX)
# Configure with -DLLVM_DIR=<fork-build>/lib/cmake/llvm
#                -DClang_DIR=<fork-build>/lib/cmake/clang.
find_package(LLVM 14 CONFIG REQUIRED)
find_package(Clang CONFIG REQUIRED)
set(AIR_HEADER_PATHS metal_stdlib metal_math metal_control metal_texture metal_depth metal_simd metal_integer metal_atomic metal_tessellation simd/simd.h)
list(SORT AIR_HEADER_PATHS)
set(AIR_HEADER_FINGERPRINT "floor-air-header-bundle-v2\n")
set(AIR_COMPAT_BUNDLE_INITIALIZERS "")
foreach(AIR_HEADER_PATH IN LISTS AIR_HEADER_PATHS)
  set(AIR_HEADER_FILE "${CMAKE_CURRENT_SOURCE_DIR}/include/${AIR_HEADER_PATH}")
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${AIR_HEADER_FILE}")
  file(READ "${AIR_HEADER_FILE}" AIR_HEADER_CONTENT)
  file(SHA256 "${AIR_HEADER_FILE}" AIR_HEADER_SHA)
  string(FIND "${AIR_HEADER_CONTENT}" ")AIR_HEADER\"" AIR_DELIMITER_POSITION)
  if(NOT AIR_DELIMITER_POSITION EQUAL -1)
    message(FATAL_ERROR "Reserved header embed delimiter")
  endif()
  string(APPEND AIR_HEADER_FINGERPRINT "${AIR_HEADER_PATH}:${AIR_HEADER_SHA}\n")
  string(APPEND AIR_COMPAT_BUNDLE_INITIALIZERS "{\"/include/${AIR_HEADER_PATH}\", R\"AIR_HEADER(${AIR_HEADER_CONTENT})AIR_HEADER\"},\n")
endforeach()
string(SHA256 AIR_COMPAT_SHA256 "${AIR_HEADER_FINGERPRINT}")
configure_file(compat_header.inc.in compat_header.inc @ONLY)
add_library(air_api STATIC air_compiler.cpp)
# a2flo LLVM headers use C++20 concepts; the wrapper must match the compiler core.
# a2flo LLVM 头文件使用 C++20 concepts；封装层必须与编译器核心一致。
target_compile_features(air_api PRIVATE cxx_std_20)
# Match the LLVM build's ABI: its default static libraries omit RTTI.
if(NOT LLVM_ENABLE_RTTI)
  if(MSVC)
    target_compile_options(air_api PRIVATE /GR-)
  else()
    target_compile_options(air_api PRIVATE -fno-rtti)
  endif()
endif()
target_include_directories(air_api PRIVATE ${LLVM_INCLUDE_DIRS} ${CLANG_INCLUDE_DIRS} ${CMAKE_CURRENT_BINARY_DIR})
target_compile_definitions(air_api PRIVATE ${LLVM_DEFINITIONS})
target_include_directories(air_api PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(air_api PRIVATE clangCodeGen clangFrontend LLVMMetalLib LLVMBitWriter140)
if(EMSCRIPTEN)
  add_executable(air_wasm wasm_entry.cpp)
  target_link_libraries(air_wasm PRIVATE air_api)
  set_target_properties(air_wasm PROPERTIES SUFFIX ".mjs")
  target_link_options(air_wasm PRIVATE
    "--no-entry"
    "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sENVIRONMENT=worker"
    "-sALLOW_MEMORY_GROWTH=1" "-sINITIAL_MEMORY=67108864"
    "-sMAXIMUM_MEMORY=2147483648" "-sSTACK_SIZE=8388608"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPU8']"
    "-sFILESYSTEM=0" "-sERROR_ON_UNDEFINED_SYMBOLS=1"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_air_compile_v1','_air_result_status','_air_result_data','_air_result_size','_air_result_diagnostics','_air_result_diagnostics_size','_air_result_free','_air_compiler_header_sha256','_air_compile_v2','_air_compiler_header_bundle_version']"
  )
endif()

