// No main(): the browser worker calls only the exported, in-process C API.
// This TU gives CMake an executable input; exported symbols pull the API archive.
