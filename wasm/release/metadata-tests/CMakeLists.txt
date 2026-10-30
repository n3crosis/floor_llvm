cmake_minimum_required(VERSION 3.20)
project(air_metadata_regressions LANGUAGES C CXX)
find_package(LLVM 14 CONFIG REQUIRED)
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "This focused CI target must use the existing WASM build")
endif()
add_executable(metadata-regressions metadata-regressions.cpp)
target_compile_features(metadata-regressions PRIVATE cxx_std_20)
target_compile_options(metadata-regressions PRIVATE -fno-rtti)
target_include_directories(metadata-regressions PRIVATE ${LLVM_INCLUDE_DIRS})
target_compile_definitions(metadata-regressions PRIVATE ${LLVM_DEFINITIONS})
target_link_libraries(metadata-regressions PRIVATE LLVMAsmParser LLVMMetalLib LLVMBitWriter140)
set_target_properties(metadata-regressions PROPERTIES SUFFIX ".mjs")
target_link_options(metadata-regressions PRIVATE
  "-sENVIRONMENT=node" "-sEXPORT_ES6=1" "-sEXIT_RUNTIME=1"
  "-sALLOW_MEMORY_GROWTH=1" "-sINITIAL_MEMORY=67108864"
  "-sMAXIMUM_MEMORY=536870912" "-sSTACK_SIZE=8388608"
  "-sFILESYSTEM=0" "-sERROR_ON_UNDEFINED_SYMBOLS=1")
