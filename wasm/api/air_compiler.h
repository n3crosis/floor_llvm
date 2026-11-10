#ifndef FLOOR_AIR_COMPILER_H
#define FLOOR_AIR_COMPILER_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Experimental a2flo Metal 3.2 frontend; full Apple MSL compatibility is not proven.
 * No caller-provided compiler flags, paths, includes, or subprocesses.
 * Use one dedicated worker per compilation until upstream global caches are fixed.
 */
typedef struct air_result air_result;
enum air_status {
  AIR_OK = 0, AIR_BAD_INPUT = 1, AIR_BAD_OPTIONS = 2,
  AIR_FRONTEND_FAILED = 3, AIR_INVALID_IR = 4,
  AIR_UNRESOLVED_SYMBOL = 5, AIR_NO_ENTRY = 6, AIR_OUTPUT_LIMIT = 7
};
enum air_output { AIR_METALLIB = 0, AIR_LLVM_TEXT = 1 };
/* ios_major is currently exactly 18 or 26; returns NULL on allocation failure.
 * source is borrowed only for the duration of this synchronous call.
 * The result owns all output and diagnostic bytes, which remain valid until free.
 * Compiler fatal errors/OOM may terminate the worker, not yield an air_result.
 */
air_result *air_compile_v1(const uint8_t *source, size_t source_size,
                           uint32_t ios_major, uint32_t output_kind);
uint32_t air_result_status(const air_result *result);
const uint8_t *air_result_data(const air_result *result);
size_t air_result_size(const air_result *result);
const char *air_result_diagnostics(const air_result *result);
size_t air_result_diagnostics_size(const air_result *result);
void air_result_free(air_result *result);
const char *air_compiler_header_sha256(void);
/* math_profile: 0 = conservative subset, 1 = explicitly selected fast-f32 profile. */
air_result *air_compile_v2(const uint8_t *, size_t, uint32_t, uint32_t, uint32_t);
uint32_t air_compiler_header_bundle_version(void);
#ifdef __cplusplus
}
#endif
#endif
