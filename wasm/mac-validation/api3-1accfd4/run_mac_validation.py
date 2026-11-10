#!/usr/bin/env python3
"""Pinned, no-install Mac validation. Python 3.9+, standard library only.

Never changes an existing repository or global settings. Output must be new.
Run --help; see README.md for artifact selection and evidence limitations.
"""
from __future__ import annotations

import argparse
import collections
import glob
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import zipfile

REPOSITORY = "n3crosis/floor_llvm"
COMMIT = "1accfd44d88898b2885390cafd527e48b4f00479"
TREE = "e0a6df98d895c4b268d475a9bf0a82adfe51bfff"
HEADER = "c37e3f178be981e4176c9145ef651ac8c29b527d9b179ef642e135ec871193e4"
RUN_ID = "42801805934"
RUN_URL = f"https://github.com/{REPOSITORY}/actions/runs/{RUN_ID}"
ARTIFACT_NAME = f"air-wasm-dev-{COMMIT[:12]}-{COMMIT}"
ARTIFACT_ID = "13758518162"
ARTIFACT_ZIP_BYTES = 186307629
ARTIFACT_ZIP_SHA256 = "d12ee8cff0597baae8f684048ead6efe0a458619e40aa90933ce95140189e063"
MIB = 1024 * 1024
# Generated from the exact authored source snapshot; no downloaded code runs
# until Git, source-lock, artifact, receipt, headers and these hashes agree.
HARNESS_PINS = {'wasm/release/apple-reference.mjs': '5ca6a80f492f4153cda7181d1aede41eac8ac6616141f77c0ad2acb287587140',
 'wasm/release/common-functions-ir.mjs': '74307f0b124caf5bebc5831208cc16c9c1291355aca3a58f8304372d2ad99b23',
 'wasm/release/common-functions.mjs': '71f218680ebaeb1b751a7421657f14fef20cbc5f2adc362431605f8cc3772561',
 'wasm/release/conditional-color.mjs': 'd7071fac560b6a72b4dcb868cdbcf029101646621201ceaf3d780bfdb3afc17e',
 'wasm/release/derivative-vector.mjs': 'c1e9390e61c897078413d8bf571c6b60290ec9a63fca49e90124b7787eaa344f',
 'wasm/release/github_release.py': '5cc25f941377625bbd6f3b21c954553b4e480e3bb726cff229cf7cbcc5843aa3',
 'wasm/release/integer-vector.mjs': 'b7e99ae0568f7842b32161fe42919882e20c01e71a49370288a6ef768be20bbc',
 'wasm/release/metal-language.mjs': 'b02d868d73c1631aa7a77cd15edbdaeeac1e683e78da834d9d26f62b749ca847',
 'wasm/release/metal-numerical.swift': 'b98591d7bbffb26e933b6e639a8473bfad00bde4a7c0dec26a52b9a22482fa5d',
 'wasm/release/metallib-metadata.mjs': 'ffa343fa81b0a50a18faa1a6ed10fe5119906a13d523ae25a0530b4171448aa1',
 'wasm/release/msl41-bit-interleave-abi.mjs': '08c3ac623c1092bbe241ace6df6c62706cf7a49f04dd9c3014d6b31213a786bf',
 'wasm/release/msl41-bit-interleave-ir.mjs': 'bf2042b3986991affe87e98daf6ad8a7f11593b01f6ba321890f0a7c53718a8f',
 'wasm/release/msl41-bit-interleave.mjs': 'ba9df2ac42700817c9570d78cf8791afbb299c56c7d17afabc37d9e51f734cf1',
 'wasm/release/probe.mjs': 'be1225b7908f6b4136ffb90e19de5158e4a8ffb48170e58de9e0779afca120b5',
 'wasm/release/release-config.json': '0eaacaaaefd3980cfe682bb613158105411700b5fca6c587fbb9070d6811deaa',
 'wasm/release/release-request.json': '8ef92e80a14a9fc239e5b3db0ecfcfcdcd51bc76d9fe8d4f03b32a75a09ad306',
 'wasm/release/release.py': '29b9a34aecc04f5f473ce7b59e980e5a62772eb3028081707dde2c8c6055c254',
 'wasm/release/verify-apple-runtime.py': '5364d3a7b1bdb60b897cf43755bb8238461c2361d9cd3dd79f266d03d6d84809',
 'wasm/source-lock.json': 'c7737355888b0da26def1dad2fb6b7b5cbd90608524ddfcdd62db08e35412aae'}
CAPABILITIES = {'apiVersion': 3,
 'supportedApiVersions': [1, 2, 3],
 'sourceLanguage': 'floor-metal-4.1-subset',
 'legacyLanguageVersion': 320,
 'explicitLanguageTargets': [{'ios': 18, 'metalVersion': 320},
                             {'ios': 26, 'metalVersion': 400},
                             {'ios': 27, 'metalVersion': 410}]}
RECEIPT_CASE_NAMES = ['kernel-metallib',
 'invalid-source',
 'bad-options',
 'void-vertex-write-ios18-math0-kind0',
 'void-vertex-write-ios18-math0-kind1',
 'void-vertex-empty-ios18-math0-kind0',
 'void-vertex-empty-ios18-math0-kind1',
 'position-vertex-no-arguments-ios18-math0-kind0',
 'position-vertex-input-ios18-math0-kind0',
 'compute-write-ios18-math0-kind0',
 'fragment-color-ios18-math0-kind0',
 'void-vertex-write-ios18-math1-kind0',
 'void-vertex-write-ios18-math1-kind1',
 'void-vertex-empty-ios18-math1-kind0',
 'void-vertex-empty-ios18-math1-kind1',
 'position-vertex-no-arguments-ios18-math1-kind0',
 'position-vertex-input-ios18-math1-kind0',
 'compute-write-ios18-math1-kind0',
 'fragment-color-ios18-math1-kind0',
 'void-vertex-write-ios26-math0-kind0',
 'void-vertex-write-ios26-math0-kind1',
 'void-vertex-empty-ios26-math0-kind0',
 'void-vertex-empty-ios26-math0-kind1',
 'position-vertex-no-arguments-ios26-math0-kind0',
 'position-vertex-input-ios26-math0-kind0',
 'compute-write-ios26-math0-kind0',
 'fragment-color-ios26-math0-kind0',
 'void-vertex-write-ios26-math1-kind0',
 'void-vertex-write-ios26-math1-kind1',
 'void-vertex-empty-ios26-math1-kind0',
 'void-vertex-empty-ios26-math1-kind1',
 'position-vertex-no-arguments-ios26-math1-kind0',
 'position-vertex-input-ios26-math1-kind0',
 'compute-write-ios26-math1-kind0',
 'fragment-color-ios26-math1-kind0',
 'color-side-ios18-math0',
 'math-helpers-ios18-math0',
 'reject-integer-saturate-ios18-math0',
 'color-side-ios18-math1',
 'math-helpers-ios18-math1',
 'reject-integer-saturate-ios18-math1',
 'color-side-ios26-math0',
 'math-helpers-ios26-math0',
 'reject-integer-saturate-ios26-math0',
 'color-side-ios26-math1',
 'math-helpers-ios26-math1',
 'reject-integer-saturate-ios26-math1',
 'exact-math-ir',
 'unary-math-ios18-math0',
 'precise-math-ios18-math0',
 'uint-color-ios18-math0',
 'unary-math-ios18-math1',
 'precise-math-ios18-math1',
 'uint-color-ios18-math1',
 'unary-math-ios26-math0',
 'precise-math-ios26-math0',
 'uint-color-ios26-math0',
 'unary-math-ios26-math1',
 'precise-math-ios26-math1',
 'uint-color-ios26-math1',
 'conservative-unary-ir',
 'exact-trunc-ir',
 'precise-ir-math0',
 'precise-ir-math1',
 'uint-color-ir',
 'reject-unary-int',
 'reject-unary-half',
 'reject-user-precise-asm',
 'reject-conditional-uint3',
 'packed-ios18-math0',
 'unpack-ios18-math0',
 'select-ios18-math0',
 'reject-user-unpack-asm-ios18-math0',
 'reject-line-spoof-unpack-asm-ios18-math0',
 'packed-ios18-math1',
 'unpack-ios18-math1',
 'select-ios18-math1',
 'reject-user-unpack-asm-ios18-math1',
 'reject-line-spoof-unpack-asm-ios18-math1',
 'packed-ios26-math0',
 'unpack-ios26-math0',
 'select-ios26-math0',
 'reject-user-unpack-asm-ios26-math0',
 'reject-line-spoof-unpack-asm-ios26-math0',
 'packed-ios26-math1',
 'unpack-ios26-math1',
 'select-ios26-math1',
 'reject-user-unpack-asm-ios26-math1',
 'reject-line-spoof-unpack-asm-ios26-math1',
 'packed-ir',
 'unpack-ir',
 'select-ir',
 'multiply-add-ios18-math0-kind0',
 'authored-render-ios18-math0-kind0',
 'multiply-add-ios18-math0-kind1',
 'authored-render-ios18-math0-kind1',
 'multiply-add-ios18-math1-kind0',
 'authored-render-ios18-math1-kind0',
 'multiply-add-ios18-math1-kind1',
 'authored-render-ios18-math1-kind1',
 'multiply-add-ios26-math0-kind0',
 'authored-render-ios26-math0-kind0',
 'multiply-add-ios26-math0-kind1',
 'authored-render-ios26-math0-kind1',
 'multiply-add-ios26-math1-kind0',
 'authored-render-ios26-math1-kind0',
 'multiply-add-ios26-math1-kind1',
 'authored-render-ios26-math1-kind1',
 'multiply-add-contract-off-ios18',
 'multiply-add-contract-off-ios26',
 'conditional-color-ios18-math0-kind0',
 'conditional-color-ios18-math0-kind1',
 'conditional-color-ios18-math1-kind0',
 'conditional-color-ios18-math1-kind1',
 'conditional-color-ios26-math0-kind0',
 'conditional-color-ios26-math0-kind1',
 'conditional-color-ios26-math1-kind0',
 'conditional-color-ios26-math1-kind1',
 'integer-vector-dynamic-ios18-math0-kind0',
 'integer-vector-constants-ios18-math0-kind0',
 'integer-vector-dynamic-ios18-math0-kind1',
 'integer-vector-constants-ios18-math0-kind1',
 'integer-vector-dynamic-ios18-math1-kind0',
 'integer-vector-constants-ios18-math1-kind0',
 'integer-vector-dynamic-ios18-math1-kind1',
 'integer-vector-constants-ios18-math1-kind1',
 'integer-vector-dynamic-ios26-math0-kind0',
 'integer-vector-constants-ios26-math0-kind0',
 'integer-vector-dynamic-ios26-math0-kind1',
 'integer-vector-constants-ios26-math0-kind1',
 'integer-vector-dynamic-ios26-math1-kind0',
 'integer-vector-constants-ios26-math1-kind0',
 'integer-vector-dynamic-ios26-math1-kind1',
 'integer-vector-constants-ios26-math1-kind1',
 'reject-integer-clz-short',
 'reject-integer-ctz-short',
 'reject-integer-popcount-short',
 'reject-integer-reverse_bits-short',
 'reject-integer-extract_bits-short',
 'reject-integer-insert_bits-short',
 'reject-integer-clz-long',
 'reject-integer-ctz-long',
 'reject-integer-popcount-long',
 'reject-integer-reverse_bits-long',
 'reject-integer-extract_bits-long',
 'reject-integer-insert_bits-long',
 'reject-integer-clz-float',
 'reject-integer-ctz-float',
 'reject-integer-popcount-float',
 'reject-integer-reverse_bits-float',
 'reject-integer-extract_bits-float',
 'reject-integer-insert_bits-float',
 'reject-integer-clz-half',
 'reject-integer-ctz-half',
 'reject-integer-popcount-half',
 'reject-integer-reverse_bits-half',
 'reject-integer-extract_bits-half',
 'reject-integer-insert_bits-half',
 'reject-integer-clz-bool',
 'reject-integer-ctz-bool',
 'reject-integer-popcount-bool',
 'reject-integer-reverse_bits-bool',
 'reject-integer-extract_bits-bool',
 'reject-integer-insert_bits-bool',
 'reject-integer-clz-float2',
 'reject-integer-ctz-float2',
 'reject-integer-popcount-float2',
 'reject-integer-reverse_bits-float2',
 'reject-integer-extract_bits-float2',
 'reject-integer-insert_bits-float2',
 'reject-integer-insert-mixed-sign',
 'derivative-vector-ios18-math0-kind0',
 'derivative-vector-ios18-math0-kind1',
 'reject-vertex-dfdx-ios18-math0',
 'reject-kernel-dfdx-ios18-math0',
 'reject-vertex-dfdy-ios18-math0',
 'reject-kernel-dfdy-ios18-math0',
 'reject-vertex-fwidth-ios18-math0',
 'reject-kernel-fwidth-ios18-math0',
 'derivative-vector-ios18-math1-kind0',
 'derivative-vector-ios18-math1-kind1',
 'reject-vertex-dfdx-ios18-math1',
 'reject-kernel-dfdx-ios18-math1',
 'reject-vertex-dfdy-ios18-math1',
 'reject-kernel-dfdy-ios18-math1',
 'reject-vertex-fwidth-ios18-math1',
 'reject-kernel-fwidth-ios18-math1',
 'derivative-vector-ios26-math0-kind0',
 'derivative-vector-ios26-math0-kind1',
 'reject-vertex-dfdx-ios26-math0',
 'reject-kernel-dfdx-ios26-math0',
 'reject-vertex-dfdy-ios26-math0',
 'reject-kernel-dfdy-ios26-math0',
 'reject-vertex-fwidth-ios26-math0',
 'reject-kernel-fwidth-ios26-math0',
 'derivative-vector-ios26-math1-kind0',
 'derivative-vector-ios26-math1-kind1',
 'reject-vertex-dfdx-ios26-math1',
 'reject-kernel-dfdx-ios26-math1',
 'reject-vertex-dfdy-ios26-math1',
 'reject-kernel-dfdy-ios26-math1',
 'reject-vertex-fwidth-ios26-math1',
 'reject-kernel-fwidth-ios26-math1',
 'reject-dfdx-half2',
 'reject-dfdx-int3',
 'reject-dfdy-half2',
 'reject-dfdy-int3',
 'reject-fwidth-half2',
 'reject-fwidth-int3',
 'common-dynamic-ios18-math0-kind0',
 'common-constants1-ios18-math0-kind0',
 'common-constants2-ios18-math0-kind0',
 'common-constants3-ios18-math0-kind0',
 'common-constants4-ios18-math0-kind0',
 'common-step-special-ios18-kind0',
 'common-dynamic-ios18-math0-kind1',
 'common-constants1-ios18-math0-kind1',
 'common-constants2-ios18-math0-kind1',
 'common-constants3-ios18-math0-kind1',
 'common-constants4-ios18-math0-kind1',
 'common-step-special-ios18-kind1',
 'common-dynamic-ios18-math1-kind0',
 'common-constants1-ios18-math1-kind0',
 'common-constants2-ios18-math1-kind0',
 'common-constants3-ios18-math1-kind0',
 'common-constants4-ios18-math1-kind0',
 'common-dynamic-ios18-math1-kind1',
 'common-constants1-ios18-math1-kind1',
 'common-constants2-ios18-math1-kind1',
 'common-constants3-ios18-math1-kind1',
 'common-constants4-ios18-math1-kind1',
 'common-dynamic-ios26-math0-kind0',
 'common-constants1-ios26-math0-kind0',
 'common-constants2-ios26-math0-kind0',
 'common-constants3-ios26-math0-kind0',
 'common-constants4-ios26-math0-kind0',
 'common-step-special-ios26-kind0',
 'common-dynamic-ios26-math0-kind1',
 'common-constants1-ios26-math0-kind1',
 'common-constants2-ios26-math0-kind1',
 'common-constants3-ios26-math0-kind1',
 'common-constants4-ios26-math0-kind1',
 'common-step-special-ios26-kind1',
 'common-dynamic-ios26-math1-kind0',
 'common-constants1-ios26-math1-kind0',
 'common-constants2-ios26-math1-kind0',
 'common-constants3-ios26-math1-kind0',
 'common-constants4-ios26-math1-kind0',
 'common-dynamic-ios26-math1-kind1',
 'common-constants1-ios26-math1-kind1',
 'common-constants2-ios26-math1-kind1',
 'common-constants3-ios26-math1-kind1',
 'common-constants4-ios26-math1-kind1',
 'reject-common-mix-int',
 'reject-common-mix-uint',
 'reject-common-mix-half',
 'reject-common-mix-half2',
 'reject-common-mix-int3',
 'reject-common-step-int',
 'reject-common-step-uint',
 'reject-common-step-half',
 'reject-common-step-half2',
 'reject-common-step-int3',
 'reject-common-smoothstep-int',
 'reject-common-smoothstep-uint',
 'reject-common-smoothstep-half',
 'reject-common-smoothstep-half2',
 'reject-common-smoothstep-int3',
 'reject-common-sign-int',
 'reject-common-sign-uint',
 'reject-common-sign-half',
 'reject-common-sign-half2',
 'reject-common-sign-int3',
 'reject-common-mix-mixed',
 'reject-common-step-mixed',
 'reject-common-smoothstep-mixed',
 'reject-common-mix-scalar-vector',
 'reject-common-mix-vector-width',
 'reject-common-mix-scalar-half',
 'reject-common-step-scalar-vector',
 'reject-common-step-vector-width',
 'reject-common-step-scalar-half',
 'reject-common-smoothstep-scalar-vector',
 'reject-common-smoothstep-vector-width',
 'reject-common-smoothstep-scalar-half',
 'metal-mode-320-ios18-math0-kind0',
 'metal-mode-320-ios18-math0-kind1',
 'metal-mode-320-ios18-math1-kind0',
 'metal-mode-320-ios18-math1-kind1',
 'metal-mode-400-ios26-math0-kind0',
 'metal-mode-400-ios26-math0-kind1',
 'metal-mode-400-ios26-math1-kind0',
 'metal-mode-400-ios26-math1-kind1',
 'metal-mode-410-ios27-math0-kind0',
 'metal-mode-410-ios27-math0-kind1',
 'metal-mode-410-ios27-math1-kind0',
 'metal-mode-410-ios27-math1-kind1',
 'legacy-v1-ios18-language320',
 'legacy-v1-ios26-language320',
 'legacy-v2-ios18-language320',
 'legacy-v2-ios26-language320',
 'bad-metal-tuple-18-400',
 'bad-metal-tuple-18-410',
 'bad-metal-tuple-26-320',
 'bad-metal-tuple-26-410',
 'bad-metal-tuple-27-320',
 'bad-metal-tuple-27-400',
 'bad-metal-tuple-27-0',
 'bad-metal-tuple-27-411',
 'bad-metal-tuple-28-410',
 'bad-metal-tuple-0-410',
 'legacy-v1-reject-ios27',
 'legacy-v2-reject-ios27',
 'metal41-bad-kind',
 'metal41-bad-math',
 'metal41-reject-cxx20-concept',
 'metal41-reject-cxx20-designator',
 'metal41-reject-cxx20-warning-bypass',
 'metal41-reject-cxx20-extension-bypass',
 'metal41-reject-cxx20-extension-macro-bypass',
 'metal41-reject-cxx20-extension-expression-bypass',
 'metal41-reject-cxx20-system-marker-bypass',
 'metal41-reject-cxx20-template-lambda',
 'metal41-reject-goto',
 'metal41-reject-noexcept-operator',
 'metal41-reject-noexcept-specifier',
 'metal41-reject-noexcept-conditional-specifier',
 'metal41-reject-noexcept-macro-specifier',
 'metal41-reject-noexcept-function-type',
 'metal41-reject-noexcept-lambda-specifier',
 'metal41-reject-dynamic-new',
 'metal41-reject-delete',
 'metal41-reject-derived-class',
 'metal41-reject-virtual-function',
 'metal41-reject-thread-local',
 'metal41-reject-register',
 'metal41-reject-exception',
 'metal41-reject-placement-new-unimplemented',
 'metal41-cxx17-if-constexpr',
 'metal41-cxx17-nested-namespace',
 'msl41-bit-scalar-dynamic-8-math0-kind0',
 'msl41-bit-scalar-dynamic-8-math0-kind1',
 'msl41-bit-scalar-dynamic-8-math1-kind0',
 'msl41-bit-scalar-dynamic-8-math1-kind1',
 'msl41-bit-scalar-constants-8-math0-kind0',
 'msl41-bit-scalar-constants-8-math0-kind1',
 'msl41-bit-scalar-constants-8-math1-kind0',
 'msl41-bit-scalar-constants-8-math1-kind1',
 'msl41-bit-vector-dynamic-8-math0-kind0',
 'msl41-bit-vector-dynamic-8-math0-kind1',
 'msl41-bit-vector-dynamic-8-math1-kind0',
 'msl41-bit-vector-dynamic-8-math1-kind1',
 'msl41-bit-vector-constants-8-math0-kind0',
 'msl41-bit-vector-constants-8-math0-kind1',
 'msl41-bit-vector-constants-8-math1-kind0',
 'msl41-bit-vector-constants-8-math1-kind1',
 'msl41-bit-deinterleave-dynamic-8-math0-kind0',
 'msl41-bit-deinterleave-dynamic-8-math0-kind1',
 'msl41-bit-deinterleave-dynamic-8-math1-kind0',
 'msl41-bit-deinterleave-dynamic-8-math1-kind1',
 'msl41-bit-deinterleave-constants-8-math0-kind0',
 'msl41-bit-deinterleave-constants-8-math0-kind1',
 'msl41-bit-deinterleave-constants-8-math1-kind0',
 'msl41-bit-deinterleave-constants-8-math1-kind1',
 'msl41-bit-scalar-dynamic-16-math0-kind0',
 'msl41-bit-scalar-dynamic-16-math0-kind1',
 'msl41-bit-scalar-dynamic-16-math1-kind0',
 'msl41-bit-scalar-dynamic-16-math1-kind1',
 'msl41-bit-scalar-constants-16-math0-kind0',
 'msl41-bit-scalar-constants-16-math0-kind1',
 'msl41-bit-scalar-constants-16-math1-kind0',
 'msl41-bit-scalar-constants-16-math1-kind1',
 'msl41-bit-vector-dynamic-16-math0-kind0',
 'msl41-bit-vector-dynamic-16-math0-kind1',
 'msl41-bit-vector-dynamic-16-math1-kind0',
 'msl41-bit-vector-dynamic-16-math1-kind1',
 'msl41-bit-vector-constants-16-math0-kind0',
 'msl41-bit-vector-constants-16-math0-kind1',
 'msl41-bit-vector-constants-16-math1-kind0',
 'msl41-bit-vector-constants-16-math1-kind1',
 'msl41-bit-deinterleave-dynamic-16-math0-kind0',
 'msl41-bit-deinterleave-dynamic-16-math0-kind1',
 'msl41-bit-deinterleave-dynamic-16-math1-kind0',
 'msl41-bit-deinterleave-dynamic-16-math1-kind1',
 'msl41-bit-deinterleave-constants-16-math0-kind0',
 'msl41-bit-deinterleave-constants-16-math0-kind1',
 'msl41-bit-deinterleave-constants-16-math1-kind0',
 'msl41-bit-deinterleave-constants-16-math1-kind1',
 'msl41-bit-scalar-dynamic-32-math0-kind0',
 'msl41-bit-scalar-dynamic-32-math0-kind1',
 'msl41-bit-scalar-dynamic-32-math1-kind0',
 'msl41-bit-scalar-dynamic-32-math1-kind1',
 'msl41-bit-scalar-constants-32-math0-kind0',
 'msl41-bit-scalar-constants-32-math0-kind1',
 'msl41-bit-scalar-constants-32-math1-kind0',
 'msl41-bit-scalar-constants-32-math1-kind1',
 'msl41-bit-vector-dynamic-32-math0-kind0',
 'msl41-bit-vector-dynamic-32-math0-kind1',
 'msl41-bit-vector-dynamic-32-math1-kind0',
 'msl41-bit-vector-dynamic-32-math1-kind1',
 'msl41-bit-vector-constants-32-math0-kind0',
 'msl41-bit-vector-constants-32-math0-kind1',
 'msl41-bit-vector-constants-32-math1-kind0',
 'msl41-bit-vector-constants-32-math1-kind1',
 'msl41-bit-deinterleave-dynamic-32-math0-kind0',
 'msl41-bit-deinterleave-dynamic-32-math0-kind1',
 'msl41-bit-deinterleave-dynamic-32-math1-kind0',
 'msl41-bit-deinterleave-dynamic-32-math1-kind1',
 'msl41-bit-deinterleave-constants-32-math0-kind0',
 'msl41-bit-deinterleave-constants-32-math0-kind1',
 'msl41-bit-deinterleave-constants-32-math1-kind0',
 'msl41-bit-deinterleave-constants-32-math1-kind1',
 'reject-msl41-bit-pair-char',
 'reject-msl41-bit-pair-short',
 'reject-msl41-bit-pair-int',
 'reject-msl41-bit-pair-long',
 'reject-msl41-bit-pair-ulong',
 'reject-msl41-bit-pair-half',
 'reject-msl41-bit-pair-float',
 'reject-msl41-bit-pair-bool',
 'reject-msl41-bit-vector-char2',
 'reject-msl41-bit-vector-short2',
 'reject-msl41-bit-vector-int2',
 'reject-msl41-bit-vector-long2',
 'reject-msl41-bit-vector-ulong2',
 'reject-msl41-bit-vector-half2',
 'reject-msl41-bit-vector-float2',
 'reject-msl41-bit-vector-uchar3',
 'reject-msl41-bit-vector-uchar4',
 'reject-msl41-bit-vector-ushort3',
 'reject-msl41-bit-vector-ushort4',
 'reject-msl41-bit-vector-uint3',
 'reject-msl41-bit-vector-uint4',
 'reject-msl41-bit-deinterleave-uchar',
 'reject-msl41-bit-deinterleave-char',
 'reject-msl41-bit-deinterleave-short',
 'reject-msl41-bit-deinterleave-int',
 'reject-msl41-bit-deinterleave-long',
 'reject-msl41-bit-deinterleave-half',
 'reject-msl41-bit-deinterleave-float',
 'reject-msl41-bit-deinterleave-bool',
 'reject-msl41-bit-deinterleave-ushort2',
 'reject-msl41-bit-deinterleave-uint2',
 'reject-msl41-bit-deinterleave-ulong2',
 'reject-msl41-bit-deinterleave-ushort3',
 'reject-msl41-bit-deinterleave-uint3',
 'reject-msl41-bit-deinterleave-ulong4',
 'reject-msl41-bit-mixed-uchar-ushort',
 'reject-msl41-bit-mixed-ushort-uchar',
 'reject-msl41-bit-mixed-ushort-uint',
 'reject-msl41-bit-mixed-uint-ushort',
 'reject-msl41-bit-mixed-uchar-char',
 'reject-msl41-bit-mixed-uint-int',
 'reject-msl41-bit-mixed-uchar2-uchar2',
 'reject-msl41-bit-mixed-ushort2-ushort2',
 'reject-msl41-bit-mixed-uint2-uint2',
 'reject-msl41-bit-single-uchar',
 'reject-msl41-bit-single-ushort',
 'reject-msl41-bit-single-uint',
 'reject-msl41-bit-three-arguments',
 'reject-msl41-bit-deinterleave-two-arguments',
 'reject-msl41-bit-gate-api3-metal320-scalar-8',
 'reject-msl41-bit-gate-api3-metal320-vector-8',
 'reject-msl41-bit-gate-api3-metal320-deinterleave-8',
 'reject-msl41-bit-gate-api3-metal320-scalar-16',
 'reject-msl41-bit-gate-api3-metal320-vector-16',
 'reject-msl41-bit-gate-api3-metal320-deinterleave-16',
 'reject-msl41-bit-gate-api3-metal320-scalar-32',
 'reject-msl41-bit-gate-api3-metal320-vector-32',
 'reject-msl41-bit-gate-api3-metal320-deinterleave-32',
 'reject-msl41-bit-gate-api3-metal400-scalar-8',
 'reject-msl41-bit-gate-api3-metal400-vector-8',
 'reject-msl41-bit-gate-api3-metal400-deinterleave-8',
 'reject-msl41-bit-gate-api3-metal400-scalar-16',
 'reject-msl41-bit-gate-api3-metal400-vector-16',
 'reject-msl41-bit-gate-api3-metal400-deinterleave-16',
 'reject-msl41-bit-gate-api3-metal400-scalar-32',
 'reject-msl41-bit-gate-api3-metal400-vector-32',
 'reject-msl41-bit-gate-api3-metal400-deinterleave-32',
 'reject-msl41-bit-gate-api1-metal320-scalar-8',
 'reject-msl41-bit-gate-api1-metal320-vector-8',
 'reject-msl41-bit-gate-api1-metal320-deinterleave-8',
 'reject-msl41-bit-gate-api1-metal320-scalar-16',
 'reject-msl41-bit-gate-api1-metal320-vector-16',
 'reject-msl41-bit-gate-api1-metal320-deinterleave-16',
 'reject-msl41-bit-gate-api1-metal320-scalar-32',
 'reject-msl41-bit-gate-api1-metal320-vector-32',
 'reject-msl41-bit-gate-api1-metal320-deinterleave-32',
 'reject-msl41-bit-gate-api2-metal320-scalar-8',
 'reject-msl41-bit-gate-api2-metal320-vector-8',
 'reject-msl41-bit-gate-api2-metal320-deinterleave-8',
 'reject-msl41-bit-gate-api2-metal320-scalar-16',
 'reject-msl41-bit-gate-api2-metal320-vector-16',
 'reject-msl41-bit-gate-api2-metal320-deinterleave-16',
 'reject-msl41-bit-gate-api2-metal320-scalar-32',
 'reject-msl41-bit-gate-api2-metal320-vector-32',
 'reject-msl41-bit-gate-api2-metal320-deinterleave-32']
CASES = [{'name': 'case-0',
  'ios': 18,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'integer',
  'gpuEligible': True,
  'sourceSha256': '741fcc6e734fbabe68ccbc0dc16d14cf41e902e64fb202b2859bebcc4699091e',
  'aliases': ['integer-vector-dynamic-ios18-math0-kind0',
              'integer-vector-dynamic-ios18-math0-kind1']},
 {'name': 'case-1',
  'ios': 18,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'integer',
  'gpuEligible': True,
  'sourceSha256': '5489f3069c4cc95dc740be390461de9ea25a7f41b96e144e5c8843dc00500053',
  'aliases': ['integer-vector-constants-ios18-math0-kind0',
              'integer-vector-constants-ios18-math0-kind1']},
 {'name': 'case-2',
  'ios': 18,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'integer',
  'gpuEligible': True,
  'sourceSha256': '741fcc6e734fbabe68ccbc0dc16d14cf41e902e64fb202b2859bebcc4699091e',
  'aliases': ['integer-vector-dynamic-ios18-math1-kind0',
              'integer-vector-dynamic-ios18-math1-kind1']},
 {'name': 'case-3',
  'ios': 18,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'integer',
  'gpuEligible': True,
  'sourceSha256': '5489f3069c4cc95dc740be390461de9ea25a7f41b96e144e5c8843dc00500053',
  'aliases': ['integer-vector-constants-ios18-math1-kind0',
              'integer-vector-constants-ios18-math1-kind1']},
 {'name': 'case-4',
  'ios': 26,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'integer',
  'gpuEligible': True,
  'sourceSha256': '741fcc6e734fbabe68ccbc0dc16d14cf41e902e64fb202b2859bebcc4699091e',
  'aliases': ['integer-vector-dynamic-ios26-math0-kind0',
              'integer-vector-dynamic-ios26-math0-kind1']},
 {'name': 'case-5',
  'ios': 26,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'integer',
  'gpuEligible': True,
  'sourceSha256': '5489f3069c4cc95dc740be390461de9ea25a7f41b96e144e5c8843dc00500053',
  'aliases': ['integer-vector-constants-ios26-math0-kind0',
              'integer-vector-constants-ios26-math0-kind1']},
 {'name': 'case-6',
  'ios': 26,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'integer',
  'gpuEligible': True,
  'sourceSha256': '741fcc6e734fbabe68ccbc0dc16d14cf41e902e64fb202b2859bebcc4699091e',
  'aliases': ['integer-vector-dynamic-ios26-math1-kind0',
              'integer-vector-dynamic-ios26-math1-kind1']},
 {'name': 'case-7',
  'ios': 26,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'integer',
  'gpuEligible': True,
  'sourceSha256': '5489f3069c4cc95dc740be390461de9ea25a7f41b96e144e5c8843dc00500053',
  'aliases': ['integer-vector-constants-ios26-math1-kind0',
              'integer-vector-constants-ios26-math1-kind1']},
 {'name': 'case-8',
  'ios': 18,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'derivative',
  'gpuEligible': True,
  'sourceSha256': '47b5d0ff4378c90707a4ccf5b50e9b9999a4854a61328b0fede692967ae9b96a',
  'aliases': ['derivative-vector-ios18-math0-kind0',
              'derivative-vector-ios18-math0-kind1']},
 {'name': 'case-9',
  'ios': 18,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'derivative',
  'gpuEligible': True,
  'sourceSha256': '47b5d0ff4378c90707a4ccf5b50e9b9999a4854a61328b0fede692967ae9b96a',
  'aliases': ['derivative-vector-ios18-math1-kind0',
              'derivative-vector-ios18-math1-kind1']},
 {'name': 'case-10',
  'ios': 26,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'derivative',
  'gpuEligible': True,
  'sourceSha256': '47b5d0ff4378c90707a4ccf5b50e9b9999a4854a61328b0fede692967ae9b96a',
  'aliases': ['derivative-vector-ios26-math0-kind0',
              'derivative-vector-ios26-math0-kind1']},
 {'name': 'case-11',
  'ios': 26,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'derivative',
  'gpuEligible': True,
  'sourceSha256': '47b5d0ff4378c90707a4ccf5b50e9b9999a4854a61328b0fede692967ae9b96a',
  'aliases': ['derivative-vector-ios26-math1-kind0',
              'derivative-vector-ios26-math1-kind1']},
 {'name': 'case-12',
  'ios': 18,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': 'a6241c55c22de735cfe119b1bb829e8145a1febfe8d7e6371b99c72f64ac828d',
  'aliases': ['common-dynamic-ios18-math0-kind0',
              'common-dynamic-ios18-math0-kind1']},
 {'name': 'case-13',
  'ios': 18,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '9e632cc559753e9e64ab6ef6bbaebf6f0f5010d83e16782b2828a17ad8f509cd',
  'aliases': ['common-constants1-ios18-math0-kind0',
              'common-constants1-ios18-math0-kind1']},
 {'name': 'case-14',
  'ios': 18,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': 'be3e468641ea145856b1cace64638d236f4bb944c5d6fcfae04d9a17bafa0f0c',
  'aliases': ['common-constants2-ios18-math0-kind0',
              'common-constants2-ios18-math0-kind1']},
 {'name': 'case-15',
  'ios': 18,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '78e5be4e1a3f097a003cd7f513a596098abe96584fe621b582b4f0e604fc858c',
  'aliases': ['common-constants3-ios18-math0-kind0',
              'common-constants3-ios18-math0-kind1']},
 {'name': 'case-16',
  'ios': 18,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '9940ab7253995d567cd5c542234f68f3e22a68941269153b4149163ff0287f6c',
  'aliases': ['common-constants4-ios18-math0-kind0',
              'common-constants4-ios18-math0-kind1']},
 {'name': 'case-17',
  'ios': 18,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '99bb1dfdb92747ddf0738d54071b76468817ac01c14d4ec8f615a3a1eab5d1e4',
  'aliases': ['common-step-special-ios18-kind0',
              'common-step-special-ios18-kind1']},
 {'name': 'case-18',
  'ios': 18,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': 'a6241c55c22de735cfe119b1bb829e8145a1febfe8d7e6371b99c72f64ac828d',
  'aliases': ['common-dynamic-ios18-math1-kind0',
              'common-dynamic-ios18-math1-kind1']},
 {'name': 'case-19',
  'ios': 18,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '9e632cc559753e9e64ab6ef6bbaebf6f0f5010d83e16782b2828a17ad8f509cd',
  'aliases': ['common-constants1-ios18-math1-kind0',
              'common-constants1-ios18-math1-kind1']},
 {'name': 'case-20',
  'ios': 18,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': 'be3e468641ea145856b1cace64638d236f4bb944c5d6fcfae04d9a17bafa0f0c',
  'aliases': ['common-constants2-ios18-math1-kind0',
              'common-constants2-ios18-math1-kind1']},
 {'name': 'case-21',
  'ios': 18,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '78e5be4e1a3f097a003cd7f513a596098abe96584fe621b582b4f0e604fc858c',
  'aliases': ['common-constants3-ios18-math1-kind0',
              'common-constants3-ios18-math1-kind1']},
 {'name': 'case-22',
  'ios': 18,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '9940ab7253995d567cd5c542234f68f3e22a68941269153b4149163ff0287f6c',
  'aliases': ['common-constants4-ios18-math1-kind0',
              'common-constants4-ios18-math1-kind1']},
 {'name': 'case-23',
  'ios': 26,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': 'a6241c55c22de735cfe119b1bb829e8145a1febfe8d7e6371b99c72f64ac828d',
  'aliases': ['common-dynamic-ios26-math0-kind0',
              'common-dynamic-ios26-math0-kind1']},
 {'name': 'case-24',
  'ios': 26,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '9e632cc559753e9e64ab6ef6bbaebf6f0f5010d83e16782b2828a17ad8f509cd',
  'aliases': ['common-constants1-ios26-math0-kind0',
              'common-constants1-ios26-math0-kind1']},
 {'name': 'case-25',
  'ios': 26,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': 'be3e468641ea145856b1cace64638d236f4bb944c5d6fcfae04d9a17bafa0f0c',
  'aliases': ['common-constants2-ios26-math0-kind0',
              'common-constants2-ios26-math0-kind1']},
 {'name': 'case-26',
  'ios': 26,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '78e5be4e1a3f097a003cd7f513a596098abe96584fe621b582b4f0e604fc858c',
  'aliases': ['common-constants3-ios26-math0-kind0',
              'common-constants3-ios26-math0-kind1']},
 {'name': 'case-27',
  'ios': 26,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '9940ab7253995d567cd5c542234f68f3e22a68941269153b4149163ff0287f6c',
  'aliases': ['common-constants4-ios26-math0-kind0',
              'common-constants4-ios26-math0-kind1']},
 {'name': 'case-28',
  'ios': 26,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '99bb1dfdb92747ddf0738d54071b76468817ac01c14d4ec8f615a3a1eab5d1e4',
  'aliases': ['common-step-special-ios26-kind0',
              'common-step-special-ios26-kind1']},
 {'name': 'case-29',
  'ios': 26,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': 'a6241c55c22de735cfe119b1bb829e8145a1febfe8d7e6371b99c72f64ac828d',
  'aliases': ['common-dynamic-ios26-math1-kind0',
              'common-dynamic-ios26-math1-kind1']},
 {'name': 'case-30',
  'ios': 26,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '9e632cc559753e9e64ab6ef6bbaebf6f0f5010d83e16782b2828a17ad8f509cd',
  'aliases': ['common-constants1-ios26-math1-kind0',
              'common-constants1-ios26-math1-kind1']},
 {'name': 'case-31',
  'ios': 26,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': 'be3e468641ea145856b1cace64638d236f4bb944c5d6fcfae04d9a17bafa0f0c',
  'aliases': ['common-constants2-ios26-math1-kind0',
              'common-constants2-ios26-math1-kind1']},
 {'name': 'case-32',
  'ios': 26,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '78e5be4e1a3f097a003cd7f513a596098abe96584fe621b582b4f0e604fc858c',
  'aliases': ['common-constants3-ios26-math1-kind0',
              'common-constants3-ios26-math1-kind1']},
 {'name': 'case-33',
  'ios': 26,
  'math': 1,
  'api': 2,
  'appleMetalVersion': 400,
  'floorMetalVersion': 320,
  'languageMatched': False,
  'kind': 'common',
  'gpuEligible': False,
  'sourceSha256': '9940ab7253995d567cd5c542234f68f3e22a68941269153b4149163ff0287f6c',
  'aliases': ['common-constants4-ios26-math1-kind0',
              'common-constants4-ios26-math1-kind1']},
 {'name': 'case-34',
  'ios': 18,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'compileOnly',
  'gpuEligible': False,
  'sourceSha256': '0b9157bf638caa206c4e217a5e19267fc06e785a8b686df603506cc61da437f1',
  'aliases': ['metal-mode-320-ios18-math0-kind0',
              'metal-mode-320-ios18-math0-kind1']},
 {'name': 'case-35',
  'ios': 18,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'compileOnly',
  'gpuEligible': False,
  'sourceSha256': '0b9157bf638caa206c4e217a5e19267fc06e785a8b686df603506cc61da437f1',
  'aliases': ['metal-mode-320-ios18-math1-kind0',
              'metal-mode-320-ios18-math1-kind1']},
 {'name': 'case-36',
  'ios': 26,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 400,
  'floorMetalVersion': 400,
  'languageMatched': True,
  'kind': 'compileOnly',
  'gpuEligible': False,
  'sourceSha256': '0c1f25a2e2e9c350b979041e25b79f1a3d7b1cf9be9c2c6f96197f4c4ed3997c',
  'aliases': ['metal-mode-400-ios26-math0-kind0',
              'metal-mode-400-ios26-math0-kind1']},
 {'name': 'case-37',
  'ios': 26,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 400,
  'floorMetalVersion': 400,
  'languageMatched': True,
  'kind': 'compileOnly',
  'gpuEligible': False,
  'sourceSha256': '0c1f25a2e2e9c350b979041e25b79f1a3d7b1cf9be9c2c6f96197f4c4ed3997c',
  'aliases': ['metal-mode-400-ios26-math1-kind0',
              'metal-mode-400-ios26-math1-kind1']},
 {'name': 'case-38',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'compileOnly',
  'gpuEligible': False,
  'sourceSha256': '1311c099a4a973924f84839e4045ccaa8755ff49fc069d74b97b910e2db01e7f',
  'aliases': ['metal-mode-410-ios27-math0-kind0',
              'metal-mode-410-ios27-math0-kind1']},
 {'name': 'case-39',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'compileOnly',
  'gpuEligible': False,
  'sourceSha256': '1311c099a4a973924f84839e4045ccaa8755ff49fc069d74b97b910e2db01e7f',
  'aliases': ['metal-mode-410-ios27-math1-kind0',
              'metal-mode-410-ios27-math1-kind1']},
 {'name': 'case-40',
  'ios': 18,
  'math': 0,
  'api': 1,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'compileOnly',
  'gpuEligible': False,
  'sourceSha256': '0b9157bf638caa206c4e217a5e19267fc06e785a8b686df603506cc61da437f1',
  'aliases': ['legacy-v1-ios18-language320']},
 {'name': 'case-41',
  'ios': 26,
  'math': 0,
  'api': 1,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'compileOnly',
  'gpuEligible': False,
  'sourceSha256': '0b9157bf638caa206c4e217a5e19267fc06e785a8b686df603506cc61da437f1',
  'aliases': ['legacy-v1-ios26-language320']},
 {'name': 'case-42',
  'ios': 18,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'compileOnly',
  'gpuEligible': False,
  'sourceSha256': '0b9157bf638caa206c4e217a5e19267fc06e785a8b686df603506cc61da437f1',
  'aliases': ['legacy-v2-ios18-language320']},
 {'name': 'case-43',
  'ios': 26,
  'math': 0,
  'api': 2,
  'appleMetalVersion': 320,
  'floorMetalVersion': 320,
  'languageMatched': True,
  'kind': 'compileOnly',
  'gpuEligible': False,
  'sourceSha256': '0b9157bf638caa206c4e217a5e19267fc06e785a8b686df603506cc61da437f1',
  'aliases': ['legacy-v2-ios26-language320']},
 {'name': 'case-44',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'compileOnly',
  'gpuEligible': False,
  'sourceSha256': 'b14d546a045ddee45215ff726980e2415a1ceffe5b019b505bff2d27aa150b95',
  'aliases': ['metal41-cxx17-if-constexpr']},
 {'name': 'case-45',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'compileOnly',
  'gpuEligible': False,
  'sourceSha256': '333cfac87a9fb6931ea4edbc9627dd1d1bbdbe04e0374cd0fc9e451eed03dde1',
  'aliases': ['metal41-cxx17-nested-namespace']},
 {'name': 'case-46',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '8e97e4a85fad7b7a8e74771c3f16483ba5178fe08d5414febe84ffd55dfe451f',
  'aliases': ['msl41-bit-scalar-dynamic-8-math0-kind0',
              'msl41-bit-scalar-dynamic-8-math0-kind1'],
  'bits': 8,
  'form': 'scalar',
  'mode': 'dynamic'},
 {'name': 'case-47',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '8e97e4a85fad7b7a8e74771c3f16483ba5178fe08d5414febe84ffd55dfe451f',
  'aliases': ['msl41-bit-scalar-dynamic-8-math1-kind0',
              'msl41-bit-scalar-dynamic-8-math1-kind1'],
  'bits': 8,
  'form': 'scalar',
  'mode': 'dynamic'},
 {'name': 'case-48',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '6e1b8da211dc970f389798d6bd0a0171bacc727dc5dce4d27231ebc8eabad60d',
  'aliases': ['msl41-bit-scalar-constants-8-math0-kind0',
              'msl41-bit-scalar-constants-8-math0-kind1'],
  'bits': 8,
  'form': 'scalar',
  'mode': 'constants'},
 {'name': 'case-49',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '6e1b8da211dc970f389798d6bd0a0171bacc727dc5dce4d27231ebc8eabad60d',
  'aliases': ['msl41-bit-scalar-constants-8-math1-kind0',
              'msl41-bit-scalar-constants-8-math1-kind1'],
  'bits': 8,
  'form': 'scalar',
  'mode': 'constants'},
 {'name': 'case-50',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '11d4f38dcee265b65e3eb653c3641f58d642dcb620ac582a31afe38bf62a5a98',
  'aliases': ['msl41-bit-vector-dynamic-8-math0-kind0',
              'msl41-bit-vector-dynamic-8-math0-kind1'],
  'bits': 8,
  'form': 'vector',
  'mode': 'dynamic'},
 {'name': 'case-51',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '11d4f38dcee265b65e3eb653c3641f58d642dcb620ac582a31afe38bf62a5a98',
  'aliases': ['msl41-bit-vector-dynamic-8-math1-kind0',
              'msl41-bit-vector-dynamic-8-math1-kind1'],
  'bits': 8,
  'form': 'vector',
  'mode': 'dynamic'},
 {'name': 'case-52',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '2cc154a5c084aa1ec1a24cf6df6669249362354095c4c9acac4d1f229be9ffa6',
  'aliases': ['msl41-bit-vector-constants-8-math0-kind0',
              'msl41-bit-vector-constants-8-math0-kind1'],
  'bits': 8,
  'form': 'vector',
  'mode': 'constants'},
 {'name': 'case-53',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '2cc154a5c084aa1ec1a24cf6df6669249362354095c4c9acac4d1f229be9ffa6',
  'aliases': ['msl41-bit-vector-constants-8-math1-kind0',
              'msl41-bit-vector-constants-8-math1-kind1'],
  'bits': 8,
  'form': 'vector',
  'mode': 'constants'},
 {'name': 'case-54',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '65efc695d1e01185c5fc1a306d1631ec279518ee375a6184794798fa20b35c39',
  'aliases': ['msl41-bit-deinterleave-dynamic-8-math0-kind0',
              'msl41-bit-deinterleave-dynamic-8-math0-kind1'],
  'bits': 8,
  'form': 'deinterleave',
  'mode': 'dynamic'},
 {'name': 'case-55',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '65efc695d1e01185c5fc1a306d1631ec279518ee375a6184794798fa20b35c39',
  'aliases': ['msl41-bit-deinterleave-dynamic-8-math1-kind0',
              'msl41-bit-deinterleave-dynamic-8-math1-kind1'],
  'bits': 8,
  'form': 'deinterleave',
  'mode': 'dynamic'},
 {'name': 'case-56',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '021cb282cf128c7bccf3f285811f6208edf2887585e097a2079f1d294eb595cd',
  'aliases': ['msl41-bit-deinterleave-constants-8-math0-kind0',
              'msl41-bit-deinterleave-constants-8-math0-kind1'],
  'bits': 8,
  'form': 'deinterleave',
  'mode': 'constants'},
 {'name': 'case-57',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '021cb282cf128c7bccf3f285811f6208edf2887585e097a2079f1d294eb595cd',
  'aliases': ['msl41-bit-deinterleave-constants-8-math1-kind0',
              'msl41-bit-deinterleave-constants-8-math1-kind1'],
  'bits': 8,
  'form': 'deinterleave',
  'mode': 'constants'},
 {'name': 'case-58',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': 'fa495e4af8686df69ccfedd26c943cd942721f4090ccc6b06176d1c4883af59e',
  'aliases': ['msl41-bit-scalar-dynamic-16-math0-kind0',
              'msl41-bit-scalar-dynamic-16-math0-kind1'],
  'bits': 16,
  'form': 'scalar',
  'mode': 'dynamic'},
 {'name': 'case-59',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': 'fa495e4af8686df69ccfedd26c943cd942721f4090ccc6b06176d1c4883af59e',
  'aliases': ['msl41-bit-scalar-dynamic-16-math1-kind0',
              'msl41-bit-scalar-dynamic-16-math1-kind1'],
  'bits': 16,
  'form': 'scalar',
  'mode': 'dynamic'},
 {'name': 'case-60',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '5e8d67bc87ea02b62226a9e00132a92a31be3fb61d31759eccde9429702b24ca',
  'aliases': ['msl41-bit-scalar-constants-16-math0-kind0',
              'msl41-bit-scalar-constants-16-math0-kind1'],
  'bits': 16,
  'form': 'scalar',
  'mode': 'constants'},
 {'name': 'case-61',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '5e8d67bc87ea02b62226a9e00132a92a31be3fb61d31759eccde9429702b24ca',
  'aliases': ['msl41-bit-scalar-constants-16-math1-kind0',
              'msl41-bit-scalar-constants-16-math1-kind1'],
  'bits': 16,
  'form': 'scalar',
  'mode': 'constants'},
 {'name': 'case-62',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '152da1ebfe3d7bb38d8ec5c0b15a5018ca85232ae586ba94855b6a42c539c7d5',
  'aliases': ['msl41-bit-vector-dynamic-16-math0-kind0',
              'msl41-bit-vector-dynamic-16-math0-kind1'],
  'bits': 16,
  'form': 'vector',
  'mode': 'dynamic'},
 {'name': 'case-63',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '152da1ebfe3d7bb38d8ec5c0b15a5018ca85232ae586ba94855b6a42c539c7d5',
  'aliases': ['msl41-bit-vector-dynamic-16-math1-kind0',
              'msl41-bit-vector-dynamic-16-math1-kind1'],
  'bits': 16,
  'form': 'vector',
  'mode': 'dynamic'},
 {'name': 'case-64',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '360c29e5a8d0e6b1b56e8733c7a370f991750e5d3eadbaff6c80c6d38bcce9b4',
  'aliases': ['msl41-bit-vector-constants-16-math0-kind0',
              'msl41-bit-vector-constants-16-math0-kind1'],
  'bits': 16,
  'form': 'vector',
  'mode': 'constants'},
 {'name': 'case-65',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '360c29e5a8d0e6b1b56e8733c7a370f991750e5d3eadbaff6c80c6d38bcce9b4',
  'aliases': ['msl41-bit-vector-constants-16-math1-kind0',
              'msl41-bit-vector-constants-16-math1-kind1'],
  'bits': 16,
  'form': 'vector',
  'mode': 'constants'},
 {'name': 'case-66',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': 'b16442c4b94938a9e51efcf21d90f1833399c32e6e755c36fb265491d54a8ac9',
  'aliases': ['msl41-bit-deinterleave-dynamic-16-math0-kind0',
              'msl41-bit-deinterleave-dynamic-16-math0-kind1'],
  'bits': 16,
  'form': 'deinterleave',
  'mode': 'dynamic'},
 {'name': 'case-67',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': 'b16442c4b94938a9e51efcf21d90f1833399c32e6e755c36fb265491d54a8ac9',
  'aliases': ['msl41-bit-deinterleave-dynamic-16-math1-kind0',
              'msl41-bit-deinterleave-dynamic-16-math1-kind1'],
  'bits': 16,
  'form': 'deinterleave',
  'mode': 'dynamic'},
 {'name': 'case-68',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '8024dd0751ed0ac9f990fcf941b901177b66b54904af9446d1416fa4cc6866be',
  'aliases': ['msl41-bit-deinterleave-constants-16-math0-kind0',
              'msl41-bit-deinterleave-constants-16-math0-kind1'],
  'bits': 16,
  'form': 'deinterleave',
  'mode': 'constants'},
 {'name': 'case-69',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '8024dd0751ed0ac9f990fcf941b901177b66b54904af9446d1416fa4cc6866be',
  'aliases': ['msl41-bit-deinterleave-constants-16-math1-kind0',
              'msl41-bit-deinterleave-constants-16-math1-kind1'],
  'bits': 16,
  'form': 'deinterleave',
  'mode': 'constants'},
 {'name': 'case-70',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': 'd87d61283f51bc711a3e22e56c446b5cf1f180c39e95fec8bc0e62a952322d5b',
  'aliases': ['msl41-bit-scalar-dynamic-32-math0-kind0',
              'msl41-bit-scalar-dynamic-32-math0-kind1'],
  'bits': 32,
  'form': 'scalar',
  'mode': 'dynamic'},
 {'name': 'case-71',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': 'd87d61283f51bc711a3e22e56c446b5cf1f180c39e95fec8bc0e62a952322d5b',
  'aliases': ['msl41-bit-scalar-dynamic-32-math1-kind0',
              'msl41-bit-scalar-dynamic-32-math1-kind1'],
  'bits': 32,
  'form': 'scalar',
  'mode': 'dynamic'},
 {'name': 'case-72',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': 'ba84a8829e643db1e7df09237203512263982baab81a631c2a95ffb534c29abc',
  'aliases': ['msl41-bit-scalar-constants-32-math0-kind0',
              'msl41-bit-scalar-constants-32-math0-kind1'],
  'bits': 32,
  'form': 'scalar',
  'mode': 'constants'},
 {'name': 'case-73',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': 'ba84a8829e643db1e7df09237203512263982baab81a631c2a95ffb534c29abc',
  'aliases': ['msl41-bit-scalar-constants-32-math1-kind0',
              'msl41-bit-scalar-constants-32-math1-kind1'],
  'bits': 32,
  'form': 'scalar',
  'mode': 'constants'},
 {'name': 'case-74',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '169b8ad9b36fdfa7f79d51b58d1242a06318f3dbe00664a6124086d08afa5b91',
  'aliases': ['msl41-bit-vector-dynamic-32-math0-kind0',
              'msl41-bit-vector-dynamic-32-math0-kind1'],
  'bits': 32,
  'form': 'vector',
  'mode': 'dynamic'},
 {'name': 'case-75',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '169b8ad9b36fdfa7f79d51b58d1242a06318f3dbe00664a6124086d08afa5b91',
  'aliases': ['msl41-bit-vector-dynamic-32-math1-kind0',
              'msl41-bit-vector-dynamic-32-math1-kind1'],
  'bits': 32,
  'form': 'vector',
  'mode': 'dynamic'},
 {'name': 'case-76',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '4cf0618a71dc093c3d10ff657c8444f592714b4a22b704a84370e2858955c8c2',
  'aliases': ['msl41-bit-vector-constants-32-math0-kind0',
              'msl41-bit-vector-constants-32-math0-kind1'],
  'bits': 32,
  'form': 'vector',
  'mode': 'constants'},
 {'name': 'case-77',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '4cf0618a71dc093c3d10ff657c8444f592714b4a22b704a84370e2858955c8c2',
  'aliases': ['msl41-bit-vector-constants-32-math1-kind0',
              'msl41-bit-vector-constants-32-math1-kind1'],
  'bits': 32,
  'form': 'vector',
  'mode': 'constants'},
 {'name': 'case-78',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '04f6500c86d35493104d921d4179970d1c5eb3428ecee44560273cf30649ac5c',
  'aliases': ['msl41-bit-deinterleave-dynamic-32-math0-kind0',
              'msl41-bit-deinterleave-dynamic-32-math0-kind1'],
  'bits': 32,
  'form': 'deinterleave',
  'mode': 'dynamic'},
 {'name': 'case-79',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '04f6500c86d35493104d921d4179970d1c5eb3428ecee44560273cf30649ac5c',
  'aliases': ['msl41-bit-deinterleave-dynamic-32-math1-kind0',
              'msl41-bit-deinterleave-dynamic-32-math1-kind1'],
  'bits': 32,
  'form': 'deinterleave',
  'mode': 'dynamic'},
 {'name': 'case-80',
  'ios': 27,
  'math': 0,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '4aa149593c01081e80be36ef6e33f11b5bf79ba3a6996f882e95c1aa0485832f',
  'aliases': ['msl41-bit-deinterleave-constants-32-math0-kind0',
              'msl41-bit-deinterleave-constants-32-math0-kind1'],
  'bits': 32,
  'form': 'deinterleave',
  'mode': 'constants'},
 {'name': 'case-81',
  'ios': 27,
  'math': 1,
  'api': 3,
  'appleMetalVersion': 410,
  'floorMetalVersion': 410,
  'languageMatched': True,
  'kind': 'interleave',
  'gpuEligible': True,
  'sourceSha256': '4aa149593c01081e80be36ef6e33f11b5bf79ba3a6996f882e95c1aa0485832f',
  'aliases': ['msl41-bit-deinterleave-constants-32-math1-kind0',
              'msl41-bit-deinterleave-constants-32-math1-kind1'],
  'bits': 32,
  'form': 'deinterleave',
  'mode': 'constants'}]


class Stop(Exception):
    def __init__(self, message, code=1):
        super().__init__(message)
        self.code = code


def require(ok, message, code=1):
    if not ok:
        raise Stop(message, code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(MIB), b""):
            h.update(block)
    return h.hexdigest()


def safe_name(name, basename=False):
    require(isinstance(name, str) and name and "\\" not in name and "\x00" not in name,
            "Invalid archive path")
    p = PurePosixPath(name)
    require(not p.is_absolute() and ".." not in p.parts and ":" not in name,
            "Unsafe archive path")
    require(not basename or p.name == name, "Asset name must be a basename")
    return name


def read_json(path, limit=MIB):
    require(Path(path).stat().st_size <= limit, "JSON exceeds size limit")
    return json.loads(Path(path).read_text())


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def manifest_identity(m):
    expected = {"schemaVersion": 1, "status": "final", "kind": "fork-built-compiler",
                "repository": REPOSITORY, "commit": COMMIT, "tree": TREE,
                "binaryBuiltFromNewFork": True, **CAPABILITIES,
                "headerBundleVersion": 2, "headerSha256": HEADER}
    for key, value in expected.items():
        require(m.get(key) == value, f"Wrong artifact: {key} does not match this pinned runner")
    require(set(m["assets"]) == {"runtime", "correspondingSource", "buildInputs"},
            "Missing or unexpected artifact assets")
    names = set()
    for kind, limit in (("runtime", 128*MIB), ("correspondingSource", 256*MIB), ("buildInputs", MIB)):
        pin = m["assets"][kind]
        safe_name(pin["name"], basename=True)
        require(pin["name"] not in names, "Duplicate artifact asset")
        names.add(pin["name"])
        require(type(pin["bytes"]) is int and 0 < pin["bytes"] <= limit, "Invalid asset size")
        require(re.fullmatch("[0-9a-f]{64}", pin["sha256"]), "Invalid asset hash")


def validate_receipt(receipt):
    verification = receipt.get("verification", {})
    for key, expected in CAPABILITIES.items():
        require(receipt.get(key) == expected, "Receipt capability mismatch: " + key)
    require(verification.get("exportsVerified") is True and verification.get("headerVerified") is True and
            verification.get("abiVersion") == 3 and verification.get("supportedApiVersions") == [1, 2, 3] and
            verification.get("headerBundleVersion") == 2 and verification.get("headerSha256") == HEADER,
            "Receipt ABI/header verification is incomplete")
    smoke = verification.get("smoke", {})
    cases = smoke.get("cases", [])
    require(smoke.get("passed") is True and len(cases) == 497 and
            [c.get("name") for c in cases] == RECEIPT_CASE_NAMES and
            all(c.get("passed") is True for c in cases), "Expected the passing exact 497-case compiler build receipt")


def pinned_zip_manifest(path):
    """Authenticate the original GitHub artifact ZIP before parsing its manifest."""
    require(isinstance(ARTIFACT_ID, str) and ARTIFACT_ID.isdigit() and
            type(ARTIFACT_ZIP_BYTES) is int and ARTIFACT_ZIP_BYTES > 0 and
            isinstance(ARTIFACT_ZIP_SHA256, str) and re.fullmatch('[0-9a-f]{64}', ARTIFACT_ZIP_SHA256),
            "Artifact identity is pending. This development runner cannot accept an artifact until authenticated CI ZIP pins are finalized.", 2)
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "Original compiler artifact ZIP missing or symlink input rejected", 2)
    with path.open("rb") as stream:
        require(os.fstat(stream.fileno()).st_size == ARTIFACT_ZIP_BYTES, "Artifact ZIP size differs from the immutable GitHub artifact")
        h = hashlib.sha256()
        for block in iter(lambda: stream.read(MIB), b""):
            h.update(block)
        require(h.hexdigest() == ARTIFACT_ZIP_SHA256, "Artifact ZIP SHA-256 differs from the immutable GitHub artifact")
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            matches = [i for i in archive.infolist() if i.filename.endswith("-manifest.json") and not i.is_dir()]
            require(len(matches) == 1 and matches[0].file_size <= MIB, "Pinned ZIP has an invalid manifest inventory")
            return archive.read(matches[0])


def stage_artifact(source, destination, original_zip=None):
    """Bind every accepted input to the immutable downloaded GitHub ZIP digest."""
    source = Path(source)
    require(source.exists(), "Artifact not found. Download the pinned CI artifact; do not use an older build.", 2)
    if source.is_dir():
        require(original_zip is not None,
                "Extracted-folder input also requires --original-zip with the original, unchanged GitHub download.", 2)
        trusted_manifest = pinned_zip_manifest(original_zip)
    else:
        require(original_zip is None, "Use --original-zip only with an extracted artifact folder", 2)
        trusted_manifest = pinned_zip_manifest(source)
    return _stage_artifact_files(source, destination, trusted_manifest)


def _stage_artifact_files(source, destination, trusted_manifest=None):
    """Copy only the four declared files, checking hashes without executing them."""
    source = Path(source)
    require(source.exists(), "Artifact not found. Wait for the pinned CI build artifact; do not use an older build.", 2)
    require(not source.is_symlink(), "Artifact input may not be a symbolic link")
    destination.mkdir()
    archive = None
    try:
        if source.is_dir():
            # Accept a direct extracted artifact or one wrapper directory, not an
            # arbitrary recursive walk through user files.
            manifests = list(source.glob("*-manifest.json")) + list(source.glob("*/*-manifest.json"))
            require(len(manifests) == 1, "Expected exactly one compiler manifest in artifact folder")
            manifest = manifests[0]
            require(not manifest.is_symlink() and not manifest.parent.is_symlink(), "Symlink artifact rejected")
            require(manifest.stat().st_size <= MIB, "Manifest too large")
            raw = manifest.read_bytes()
            def open_asset(name):
                p = manifest.parent / name
                require(p.is_file() and not p.is_symlink(), "Missing or symlink artifact asset: " + name)
                return p.open("rb")
        else:
            require(zipfile.is_zipfile(source), "Provide the workflow artifact ZIP or its extracted folder", 2)
            archive = zipfile.ZipFile(source)
            infos = archive.infolist()
            require(len(infos) <= 100, "Too many entries in artifact ZIP")
            seen = set()
            for item in infos:
                safe_name(item.filename)
                require(item.filename not in seen, "Duplicate ZIP path")
                seen.add(item.filename)
                kind = stat.S_IFMT(item.external_attr >> 16)
                require(kind in (0, stat.S_IFREG, stat.S_IFDIR), "Non-regular ZIP member rejected")
                require(not item.flag_bits & 1, "Encrypted ZIP rejected")
                require(item.file_size <= 300*MIB, "Oversized ZIP member")
            candidates = [i for i in infos if i.filename.endswith("-manifest.json") and not i.is_dir()]
            require(len(candidates) == 1, "Expected exactly one compiler manifest; Apple evidence is not a compiler artifact")
            item = candidates[0]
            require(item.file_size <= MIB, "Manifest too large")
            raw = archive.read(item)
            manifest = PurePosixPath(item.filename)
            prefix = str(manifest.parent)
            def open_asset(name):
                key = name if prefix == "." else prefix + "/" + name
                require(key in seen, "Missing artifact asset: " + name)
                return archive.open(key)
        require(trusted_manifest is None or raw == trusted_manifest, "Artifact manifest differs from the pinned original ZIP")
        m = json.loads(raw)
        manifest_identity(m)
        (destination / Path(str(manifest)).name).write_bytes(raw)
        for pin in m["assets"].values():
            total, h = 0, hashlib.sha256()
            with open_asset(pin["name"]) as src, (destination/pin["name"]).open("xb") as dst:
                while True:
                    block = src.read(MIB)
                    if not block:
                        break
                    total += len(block)
                    require(total <= pin["bytes"], "Asset longer than declared: " + pin["name"])
                    h.update(block)
                    dst.write(block)
            require(total == pin["bytes"] and h.hexdigest() == pin["sha256"], "Artifact hash mismatch: " + pin["name"])
        return m
    finally:
        if archive is not None:
            archive.close()


def sanitize(text, replacements):
    for old, new in sorted(replacements, key=lambda p: len(p[0]), reverse=True):
        if old:
            text = text.replace(old, new)
    # Additional common host-path and bearer-token forms. No environment dump,
    # username, hostname, serial, credentials or account identifiers are collected.
    text = re.sub(r"/(?:Users|home)/[^/\s\"']+", "<HOME>", text)
    text = re.sub(r"(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+", "<REDACTED_TOKEN>", text)
    text = re.sub(r"(?i)(authorization\s*[:=]\s*(?:bearer|token)\s+)\S+", r"\1<REDACTED>", text)
    return text


class Runner:
    OUTPUT_LIMIT = 2*MIB  # Per stream, per command; never capture unlimited logs.

    def __init__(self, output, artifact, developer_dir=None, capability_only=False, original_zip=None):
        self.output = Path(output)
        self.artifact = Path(artifact).expanduser().resolve() if artifact else None
        self.capability_only = capability_only
        self.original_zip = Path(original_zip).expanduser().resolve() if original_zip else None
        self.work, self.share = self.output/"work", self.output/"share"
        self.work.mkdir()
        self.share.mkdir()
        self.replacements = [(str(self.output), "<RUN>"), (str(Path.home()), "<HOME>")]
        if self.artifact:
            self.replacements.append((str(self.artifact), "<ARTIFACT>"))
        if self.original_zip:
            self.replacements.append((str(self.original_zip), "<ORIGINAL_ARTIFACT_ZIP>"))
        self.developer_dir = developer_dir
        self.stage = "artifact"
        self.result = {"schemaVersion": 1, "repository": REPOSITORY, "commit": COMMIT, "tree": TREE,
                       "expectedWorkflowRun": RUN_URL, "expectedArtifactName": ARTIFACT_NAME,
                       "workflowOrigin": "not_checked",
                       "expectedArtifactZip": {"artifactID": ARTIFACT_ID, "bytes": ARTIFACT_ZIP_BYTES, "sha256": ARTIFACT_ZIP_SHA256},
                       "runnerSha256": file_hash(__file__), "status": "not_run", "stages": {},
                       "mode": "apple_metal41_capability_only" if capability_only else "pinned_api3_checkpoint_plus_apple_metal41_capability",
                       "limitations": ["Bounded authored cases, not full Metal or application compatibility.",
                           "API3 selects exact iOS18/MSL3.2, iOS26/MSL4.0 or iOS27/MSL4.1 tuples; legacy APIs retain MSL3.2.",
                           "Metal 4.1 coverage is a bounded compiler subset, not full language conformance.",
                           "No iPhone or iPad device execution; this run uses the Mac's actual MTLDevice.",
                           "No common-function GPU cases, negative/mixed-slope derivatives, edge pixels or divergent flow.",
                           "An unavailable original iOS library is never a GPU or numerical pass."]}
        # Minimal subprocess environment. Do not pass tokens, Node injection flags,
        # dyld overrides, Python startup hooks or personal Git configuration.
        self.env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
                    "HOME": str(self.work/"home"), "TMPDIR": str(self.work/"tmp"),
                    "LANG": "en_US.UTF-8", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null",
                    "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "/usr/bin/false", "SSH_ASKPASS": "/usr/bin/false"}
        for key in ("HOME", "TMPDIR"):
            Path(self.env[key]).mkdir()
        self.commands = []

    def run(self, args, timeout=120, check=True, input_text=None):
        args = [str(a) for a in args]
        require(input_text is None or len(input_text.encode()) <= 16384, "Command input exceeds bounded pipe budget")
        # A new process group lets interruption/timeout stop every descendant,
        # including compiler and GPU worker processes, rather than orphaning them.
        child = subprocess.Popen(args, cwd=self.work, env=self.env, stdin=subprocess.PIPE if input_text is not None else subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace", start_new_session=True)
        captured = [[], []]
        overflow = threading.Event()
        def read_bounded(stream, slot):
            remaining = self.OUTPUT_LIMIT
            while True:
                chunk = stream.read(16384)
                if not chunk:
                    return
                if remaining > 0:
                    captured[slot].append(chunk[:remaining])
                remaining -= len(chunk)
                if remaining < 0:
                    overflow.set()
        readers = [threading.Thread(target=read_bounded, args=(stream, slot), daemon=True)
                   for slot, stream in enumerate((child.stdout, child.stderr))]
        for thread in readers:
            thread.start()
        error = None
        try:
            if input_text is not None:
                try:
                    child.stdin.write(input_text)
                    child.stdin.close()
                except BrokenPipeError:
                    pass
            deadline = time.monotonic() + timeout
            while child.poll() is None:
                if overflow.is_set():
                    raise Stop("Command exceeded the 2 MiB per-stream output budget; partial diagnostics retained")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(args, timeout)
                try:
                    child.wait(timeout=min(0.1, remaining))
                except subprocess.TimeoutExpired:
                    pass
        except (subprocess.TimeoutExpired, KeyboardInterrupt, Stop) as caught:
            error = caught
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        finally:
            for thread in readers:
                thread.join(timeout=5)
            # Descendants may retain a pipe after their parent exits. Do not
            # wait forever or leave such a process group running.
            if any(t.is_alive() for t in readers):
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                for thread in readers:
                    thread.join(timeout=5)
                error = error or Stop("Command left descendant output pipes open; process group stopped")
            stdout, stderr = ("".join(parts) for parts in captured)
            self.commands.append({"args": args, "returncode": child.returncode, "stdout": stdout, "stderr": stderr,
                                  "interruptedOrTimedOut": isinstance(error, (subprocess.TimeoutExpired, KeyboardInterrupt)),
                                  "outputTruncated": overflow.is_set()})
            child.stdout.close()
            child.stderr.close()
        if error:
            raise error
        require(not overflow.is_set(), "Command exceeded the 2 MiB per-stream output budget; partial diagnostics retained")
        if check:
            require(child.returncode == 0, f"Command failed ({child.returncode}): {Path(args[0]).name}; see commands.log")
        return child.returncode, stdout, stderr

    def prerequisites(self, compiler_only=False):
        require(sys.platform == "darwin", "Mac validation requires macOS; Apple/Swift/GPU tests were not run.", 2)
        for tool in (("xcodebuild", "xcrun") if compiler_only else ("git", "node", "xcodebuild", "xcrun")):
            require(shutil.which(tool, path=self.env["PATH"]), f"Missing {tool}; install prerequisites yourself, then rerun.", 2)
        node = git_version = "not required for capability-only mode"
        if not compiler_only:
            _, node, _ = self.run(["node", "--version"])
            require(re.fullmatch(r"v24\.\d+\.\d+\s*", node), "Node 24.x is required; no alternate-major fallback.", 2)
            _, git_version, _ = self.run(["git", "--version"])
            m = re.search(r"git version (\d+)\.(\d+)", git_version)
            require(m and tuple(map(int, m.groups())) >= (2, 25), "Git 2.25+ is required for sparse checkout.", 2)
        candidates = []
        paths = [self.developer_dir] if self.developer_dir else glob.glob("/Applications/Xcode*.app/Contents/Developer")
        if not self.developer_dir:
            if os.environ.get("DEVELOPER_DIR"):
                paths.append(os.environ["DEVELOPER_DIR"])
            rc, selected, _ = self.run(["/usr/bin/xcode-select", "-p"], check=False)
            if rc == 0:
                paths.append(selected.strip())
        for path in sorted(set(p for p in paths if p)):
            self.env["DEVELOPER_DIR"] = str(Path(path).expanduser().resolve())
            rc, version, _ = self.run(["xcodebuild", "-version"], check=False)
            match = re.search(r"^Xcode (\d+(?:\.\d+)*)", version)
            if rc == 0 and match and int(match[1].split(".")[0]) >= 26:
                candidates.append((tuple(map(int, match[1].split("."))), self.env["DEVELOPER_DIR"], version.strip()))
        require(candidates, "Xcode 26+ is unavailable. No install, license acceptance or xcode-select change was attempted.", 2)
        _, selected, version = max(candidates)
        self.env["DEVELOPER_DIR"] = selected
        self.replacements.append((selected, "<XCODE>"))
        sdk_rc, sdk, _ = self.run(["xcrun", "-sdk", "iphoneos", "--show-sdk-version"], check=False)
        require(sdk_rc == 0 and re.fullmatch(r"\d+(?:\.\d+)*\s*", sdk) and int(sdk.split(".")[0]) >= 26,
                "iPhoneOS SDK 26+ is required for the unchanged target matrix.", 2)
        metal_rc, metal, _ = self.run(["xcrun", "-sdk", "iphoneos", "metal", "--version"], check=False)
        require(metal_rc == 0, "Apple Metal command-line tool unavailable; no component download or installation attempted.", 2)
        swift = "not required for capability-only mode"
        if not compiler_only:
            swift_rc, swift, _ = self.run(["xcrun", "-sdk", "macosx", "swiftc", "--version"], check=False)
            require(swift_rc == 0, "Swift compiler unavailable; no installation attempted.", 2)
        self.result["host"] = {"macOS": platform.mac_ver()[0], "architecture": platform.machine(),
                               "xcode": version, "iPhoneOSSDK": sdk.strip(), "metal": metal.strip(),
                               "swift": swift.strip(), "node": node.strip(), "python": platform.python_version(),
                               "git": git_version.strip()}

    def metal41_probe(self):
        self.stage = "appleMetal41Capability"
        print("Checking minimal Apple Metal 4.1 source acceptance (separate from FLOOR)...", flush=True)
        folder = self.work/"apple-metal41-capability"
        folder.mkdir()
        source = folder/"minimal.metal"
        source.write_text("#include <metal_stdlib>\nusing namespace metal;\n"
                          "static_assert(__METAL_VERSION__ == 410, \"4.1 required\");\n"
                          "kernel void metal41_capability(device uint* output [[buffer(0)]], "
                          "uint index [[thread_position_in_grid]]) { output[index] = index + 1u; }\n")
        air, library = folder/"minimal.air", folder/"minimal.metallib"
        args = ["xcrun", "-sdk", "iphoneos", "metal", "-target", "air64-apple-ios27.0", "-std=metal4.1", "-fno-fast-math", "-c", source, "-o", air]
        result = {"schemaVersion": 1, "scope": "Minimal Apple source compile/link capability only, not Metal 4.1 feature conformance or FLOOR 4.1 support.",
                  "sourceSha256": file_hash(source), "sdk": self.result["host"]["iPhoneOSSDK"],
                  "compiler": self.result["host"]["metal"], "target": "air64-apple-ios27.0", "language": "metal4.1",
                  "targetNote": "MSL 4.1's iOS 27 deployment profile is probed explicitly. An older selected SDK may reject this request.",
                  "sdkAtLeast27": int(self.result["host"]["iPhoneOSSDK"].split(".")[0]) >= 27,
                  "sdkLimitation": "An SDK below 27 remains a validation limitation even if this minimal compiler flag is accepted.",
                  "compile": "not_run", "link": "not_run", "libraryLoading": "not_run", "gpuExecution": "not_run", "numericalComparison": "not_run"}
        rc, stdout, stderr = self.run(args, check=False)
        result.update(compileExitCode=rc, compileStdout=stdout, compileStderr=stderr, compileCommand=[str(a) for a in args])
        if rc != 0:
            diagnostics = (stdout + "\n" + stderr).lower()
            unsupported = ("metal4.1" in diagnostics and any(word in diagnostics for word in ("invalid", "unsupported", "not supported", "unrecognized", "unknown")))
            result.update(compile="unsupported" if unsupported else "rejected", status="unsupported" if unsupported else "rejected")
        else:
            require(air.is_file() and air.stat().st_size > 0, "Apple capability compiler accepted but produced no AIR")
            result.update(compile="accepted", airSha256=file_hash(air))
            link_args = ["xcrun", "-sdk", "iphoneos", "metallib", air, "-o", library]
            link_rc, stdout, stderr = self.run(link_args, check=False)
            result.update(linkExitCode=link_rc, linkStdout=stdout, linkStderr=stderr, linkCommand=[str(a) for a in link_args])
            if link_rc == 0 and library.is_file() and library.read_bytes()[:4] == b"MTLB":
                result.update(link="accepted", status="minimal_compile_link_accepted", metallibSha256=file_hash(library))
            else:
                result.update(link="failed", status="link_failed")
        write_json(folder/"report.json", result)
        self.result["appleMetal41Capability"] = result
        self.result["stages"][self.stage] = result["status"]

    def checkout(self):
        checkout = self.work/"checkout"
        checkout.mkdir()
        git = ["git", "-c", "core.hooksPath=/dev/null", "-C", checkout]
        self.run(git + ["init", "--template="])
        self.run(git + ["remote", "add", "origin", f"https://github.com/{REPOSITORY}.git"])
        self.run(git + ["config", "remote.origin.promisor", "true"])
        self.run(git + ["config", "remote.origin.partialclonefilter", "blob:none"])
        # --filter fetches commit/tree metadata; sparse checkout materializes wasm
        # and locked source inputs only, never a full LLVM working tree.
        self.run(git + ["fetch", "--no-tags", "--depth=1", "--filter=blob:none", "origin", COMMIT], timeout=900)
        self.run(git + ["sparse-checkout", "init", "--no-cone"])
        self.run(git + ["sparse-checkout", "set", "--no-cone", "--stdin"], input_text="/wasm/\n/.github/workflows/release-air-wasm.yml\n")
        self.run(git + ["checkout", "--detach", "FETCH_HEAD"], timeout=300)
        _, head, _ = self.run(git + ["rev-parse", "HEAD"])
        _, tree, _ = self.run(git + ["rev-parse", "HEAD^{tree}"])
        require(head.strip() == COMMIT and tree.strip() == TREE, "Fetched Git identity differs from the pinned commit/tree")
        lock = read_json(checkout/"wasm/source-lock.json")
        inputs = dict(lock["compilerFiles"])
        inputs.update({"wasm/" + name: value for name, value in lock["sdkFiles"].items()})
        for name in inputs:
            safe_name(name)
            require(re.fullmatch(r"[A-Za-z0-9_.+/-]+", name), "Invalid source-lock path")
        paths = ["/wasm/", "/.github/workflows/release-air-wasm.yml"] + ["/" + name for name in inputs if not name.startswith("wasm/")]
        self.run(git + ["sparse-checkout", "set", "--no-cone", "--stdin"], timeout=300, input_text="\n".join(paths) + "\n")
        for name, expected in {**inputs, **HARNESS_PINS}.items():
            p = checkout/name
            require(p.is_file() and not p.is_symlink() and file_hash(p) == expected, "Pinned source mismatch: " + name)
        _, dirty, _ = self.run(git + ["status", "--porcelain", "--untracked-files=all"])
        require(not dirty, "Fresh checkout unexpectedly changed")
        return checkout, inputs

    def provenance(self, m, checkout, inputs):
        artifact = self.work/"artifact"
        lock_sha = file_hash(checkout/"wasm/source-lock.json")
        fingerprint = sha(("floor-air-wasm-source-v1\n" + REPOSITORY + "\n" + COMMIT + "\n" + TREE + "\n" + lock_sha + "\n" +
                           "".join(p + "\0" + inputs[p] + "\n" for p in sorted(inputs))).encode())
        require(m["sourceLockSha256"] == lock_sha and m["sourceFingerprintSha256"] == fingerprint, "Source identity mismatch")
        build = read_json(artifact/m["assets"]["buildInputs"]["name"])
        for key in ("repository", "commit", "tree", "sourceLockSha256", "sourceFingerprintSha256"):
            require(build[key] == m[key], "Build-input identity mismatch: " + key)
        require(build["sourceInputs"] == inputs, "Build-input source inventory mismatch")
        for name, expected in HARNESS_PINS.items():
            if name.startswith("wasm/release/") and not name.endswith(".test.mjs"):
                require(build["tooling"].get(name) == expected, "Build did not disclose this exact harness: " + name)
        # Verify every locked compiler/wrapper input and executed harness in the
        # corresponding-source archive without extracting a full LLVM checkout.
        wanted = {**inputs, **HARNESS_PINS}
        prefix = build["sourceArchivePrefix"]
        require(prefix == f"air-wasm-{m['version']}-source/", "Unexpected source archive prefix")
        seen, byte_budget, entry_count = set(), 0, 0
        with tarfile.open(artifact/m["assets"]["correspondingSource"]["name"], "r|gz") as archive:
            for member in archive:
                entry_count += 1
                safe_name(member.name)
                byte_budget += member.size
                require(entry_count <= 400000 and byte_budget <= 8*1024*MIB and member.size <= 256*MIB,
                        "Corresponding-source archive exceeds inspection budget")
                if not member.name.startswith(prefix):
                    continue
                name = member.name[len(prefix):]
                if name not in wanted:
                    continue
                require(name not in seen and member.isfile(), "Invalid source archive member: " + name)
                stream = archive.extractfile(member)
                h = hashlib.sha256()
                for block in iter(lambda: stream.read(MIB), b""):
                    h.update(block)
                require(h.hexdigest() == wanted[name], "Corresponding-source mismatch: " + name)
                seen.add(name)
        require(seen == set(wanted), "Corresponding-source archive omits locked source or harness files")
        runtime = self.work/"runtime"
        self.run([sys.executable, "-I", checkout/"wasm/release/verify-apple-runtime.py", artifact, checkout, runtime, COMMIT])
        receipt = read_json(runtime/"build-report.json")
        require(receipt["sourceInputs"] == inputs and receipt["sourceFingerprintSha256"] == fingerprint,
                "Runtime receipt source inputs differ")
        validate_receipt(receipt)
        self.result["artifact"] = {"manifestSha256": file_hash(next(artifact.glob("*-manifest.json"))),
                                   "assets": m["assets"], "headerSha256": HEADER, "sourceLockSha256": lock_sha,
                                   "sourceFingerprintSha256": fingerprint, "lockedSourceFilesChecked": len(inputs),
                                   "correspondingSourceScope": "Archive digest plus every locked input and pinned harness; no full source rebuild.",
                                   "compilerBuildReceipt": {"status": "reported_passed", "cases": 497,
                                                            "rerunByThisRunner": False}}
        return runtime

    def execute(self):
        if self.capability_only:
            self.stage = "prerequisites"
            self.prerequisites(compiler_only=True)
            self.result["stages"][self.stage] = "passed"
            self.metal41_probe()
            return
        for stage, action in [("artifact", lambda: stage_artifact(self.artifact, self.work/"artifact", self.original_zip)),
                              ("prerequisites", self.prerequisites), ("checkout", self.checkout)]:
            self.stage = stage
            print("Checking " + stage + "...", flush=True)
            value = action()
            self.result["stages"][stage] = "passed"
            if stage == "artifact":
                manifest = value
                self.result["workflowOrigin"] = "Original GitHub ZIP digest and size match the pinned immutable artifact; extracted manifest/assets are bound to that ZIP."
            elif stage == "checkout":
                checkout, inputs = value
        self.metal41_probe()
        self.stage = "provenance"
        print("Verifying source and runtime provenance...", flush=True)
        runtime = self.provenance(manifest, checkout, inputs)
        self.result["stages"][self.stage] = "passed"
        self.stage = "swiftBuild"
        print("Compiling the unchanged Swift Metal probe...", flush=True)
        probe = self.work/"metal-numerical"
        rc, _, _ = self.run(["xcrun", "-sdk", "macosx", "swiftc", checkout/"wasm/release/metal-numerical.swift",
                             "-framework", "Metal", "-framework", "Foundation", "-o", probe], timeout=300, check=False)
        self.result["stages"][self.stage] = "passed" if rc == 0 else "failed"
        self.stage = "appleReference"
        print("Running 82 same-source compile/link comparisons" + (" and up to 48 GPU pairs..." if rc == 0 else " (Swift build failed; GPU checks will not run)..."), flush=True)
        args = ["node", checkout/"wasm/release/apple-reference.mjs", runtime, self.work/"apple-reference"]
        if rc == 0:
            args += ["--gpu-probe", probe]
        reference_rc, _, _ = self.run(args, timeout=2400, check=False)
        self.result["stages"][self.stage] = "completed" if reference_rc == 0 else "unavailable" if reference_rc == 77 else "failed"
        require(rc == 0 and reference_rc in (0, 77), "Swift build or Apple reference gate failed; layer-specific partial evidence was retained")

    def finish(self, code):
        try:
            matrix = build_matrix(self.work/"apple-reference")
        except Exception as error:
            # Malformed/contradictory reports are themselves failures, but still
            # package the raw evidence and logs so the user can report the bug.
            code = 1
            self.result["error"] = "Invalid layer evidence: " + str(error)
            matrix = build_matrix(self.work/"no-report-fallback")
        if code == 0 and self.capability_only:
            status = self.result.get("appleMetal41Capability", {}).get("status")
            if status == "minimal_compile_link_accepted":
                self.result["status"] = "apple_metal41_minimal_accepted"
            elif status == "unsupported":
                self.result["status"] = "apple_metal41_unsupported"
                code = 77
            else:
                self.result["error"] = "Minimal Metal 4.1 probe rejected or failed; inspect the recorded diagnostics"
                code = 1
        elif code == 0:
            rows = matrix["cases"]
            compile_ok = all(row[key] == "passed" for row in rows for key in ("appleCompile", "appleLink", "floorCompile"))
            eligible = [r for r in rows if r["gpuEligible"]]
            gpu_ok = all(r["numericalComparison"] == "passed" and r["gpuStatus"] == "passed" for r in eligible)
            unavailable_ok = all(r["floorCompile"] == "passed" and not r["errors"] and
                                 r["appleCompile"] in ("passed", "unavailable") and
                                 r["appleLink"] in ("passed", "unavailable") for r in rows)
            unavailable_ok = unavailable_ok and all(r["gpuStatus"] in ("passed", "unavailable") or
                (r["gpuStatus"] == "blocked" and r["appleCompile"] == "unavailable") for r in eligible)
            if compile_ok and gpu_ok and all(not r["errors"] for r in rows):
                self.result["status"] = "passed_bounded_scope"
            elif unavailable_ok:
                code = 77
                self.result["status"] = "validation_unavailable"
            else:
                code = 1
                self.result["error"] = "Incomplete, failed or inconsistent layer evidence; no pass claimed"
        if code not in (0, 77):
            self.result["status"] = "blocked" if code == 2 else "interrupted" if code == 130 else "failed"
        self.result["exitCode"] = code
        self.result["layers"] = matrix["totals"]
        self.result["privacy"] = "Share contains sanitized selected test outputs only. Review before sharing; no automatic upload. Raw local evidence stays under work/."
        # Save only allowlisted generated evidence, never .git, HOME, environment,
        # downloaded compiler/source bundles or compiled host executable.
        inventory = []
        budget = 128*MIB
        for reference in (self.work/"apple-reference", self.work/"apple-metal41-capability"):
            if not reference.exists():
                continue
            for path in sorted(reference.rglob("*")):
                if not path.is_file() or path.is_symlink() or path.suffix not in (".json", ".metal", ".air", ".metallib", ".f32le"):
                    continue
                rel = Path("evidence")/reference.name/path.relative_to(reference)
                if path.suffix in (".air", ".metallib"):
                    inventory.append({"file": str(rel), "originalSha256": file_hash(path),
                                      "omitted": "Binary may embed host paths; unchanged original retained locally"})
                    continue
                size = path.stat().st_size
                if size > budget:
                    inventory.append({"file": str(rel), "omitted": "share archive size budget; retained locally"})
                    continue
                data = path.read_bytes()
                original = sha(data)
                if path.suffix in (".json", ".metal"):
                    data = sanitize(data.decode("utf-8", errors="replace"), self.replacements).encode()
                target = self.share/rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                budget -= size
                inventory.append({"file": str(rel), "originalSha256": original, "sharedSha256": sha(data),
                                  "sharedBytes": len(data), "redacted": original != sha(data)})
        summary = ["FLOOR Mac validation: " + self.result["status"], "Mode: " + self.result["mode"], "Checkpoint commit: " + COMMIT,
                   "Expected artifact run: " + RUN_URL, "", "Observed layers:"]
        for key, counts in matrix["totals"].items():
            summary.append("- " + key + ": " + ", ".join(f"{status}={n}" for status, n in sorted(counts.items())))
        if "error" in self.result:
            summary += ["", "Stopped: " + self.result["error"]]
        capability = self.result.get("appleMetal41Capability")
        if capability:
            summary += ["", "Separate Apple Metal 4.1 capability: " + capability["status"],
                        "This tests one minimal source at iOS 27 / MSL 4.1, not feature conformance or FLOOR 4.1 support."]
        if self.capability_only:
            summary += ["Checkpoint FLOOR compiler/GPU comparisons were not run in capability-only mode."]
        summary += ["", "Checkpoint planned scope: 82 compiler comparisons; 48 GPU-eligible pairs including 36 interleave pairs.",
                    "API3: iOS18/MSL3.2, iOS26/MSL4.0, iOS27/MSL4.1. Legacy APIs retain FLOOR MSL3.2.",
                    "The matrix labels both compilers separately. Original libraries are never retargeted.",
                    "Compile/link success is not library, pipeline, GPU or numerical proof.",
                    "Unavailable is not passed. Common functions have no GPU numerical coverage.",
                    "Artifact mode checks a 497-case CI receipt; that entire corpus is not rerun locally.",
                    "", "Send back summary.txt and evidence.zip after reviewing them for private information."]
        (self.share/"summary.txt").write_text(sanitize("\n".join(summary) + "\n", self.replacements))
        for name, value in (("result.json", self.result), ("validation-matrix.json", matrix), ("evidence-inventory.json", inventory)):
            (self.share/name).write_text(sanitize(json.dumps(value, indent=2, sort_keys=True) + "\n", self.replacements))
        logs = []
        for index, command in enumerate(self.commands, 1):
            logs.append(f"[{index}] " + json.dumps(command, indent=2))
        (self.share/"commands.log").write_text(sanitize("\n".join(logs) + "\n", self.replacements))
        (self.share/"PRIVACY.txt").write_text("This is a selected, sanitized evidence bundle, not a byte-for-byte copy of the local reports.\n"
            "Original and shared hashes are listed separately in evidence-inventory.json.\n"
            "Nested report hashes refer to original local files. Use sharedSha256 to validate the attached copy.\n"
            "No credentials, environment dump, host serial, username, hostname, .git directory, compiler executable or source archive is intentionally included.\n"
            "AIR and metallib binaries can embed private paths, so only their hashes are shared; unchanged binaries remain local.\n"
            "macOS, architecture, Xcode/SDK/tool versions and the generic GPU model can appear.\n"
            "Known home/output/SDK paths and common GitHub-token forms are redacted. Review before sharing; redaction is best effort.\n")
        archive_path = self.output/"evidence.zip"
        with zipfile.ZipFile(archive_path, "x", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(self.share.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(self.share).as_posix())
        print((self.share/"summary.txt").read_text())
        print("Summary:", self.share/"summary.txt")
        print("Review and return:", archive_path)
        return code


def build_matrix(reference):
    report = read_json(reference/"report.json", 16*MIB) if (reference/"report.json").exists() else {}
    observed = {c["name"]: c for c in report.get("cases", [])}
    require(len(observed) == len(report.get("cases", [])), "Duplicate case reports")
    require(set(observed) <= {c["name"] for c in CASES}, "Unexpected case report")
    rows = []
    for expected in CASES:
        item = observed.get(expected["name"], {})
        for key in ("sourceSha256", "ios", "math", "api", "appleMetalVersion", "floorMetalVersion", "languageMatched"):
            if item:
                require(item.get(key) == expected[key], "Case identity mismatch: " + expected["name"])
        eligible = expected["gpuEligible"]
        row = dict(expected, gpuEligible=eligible, appleDialect={320:"metal3.2",400:"metal4.0",410:"metal4.1"}[expected["appleMetalVersion"]],
                   floorDialect={320:"metal3.2",400:"metal4.0",410:"metal4.1"}[expected["floorMetalVersion"]], mathProfile="fast" if expected["math"] else "conservative")
        for key in ("appleCompile", "appleLink", "floorCompile"):
            value = item.get(key, "not_run")
            row[key] = "not_run" if value == "pending" else value
        detail_path = reference/(expected["name"] + "-gpu")/"report.json"
        details = read_json(detail_path, 16*MIB) if detail_path.exists() else {}
        default = "not_run" if eligible else "not_in_scope"
        row["gpuStatus"] = details.get("status", item.get("gpu", {}).get("status", default))
        row["errors"] = item.get("errors", [])
        row["target"] = "air64-apple-ios" + str(expected["ios"]) + ".0"
        for hash_key in ("airSha256", "appleMetallibSha256", "floorMetallibSha256"):
            if hash_key in item:
                require(isinstance(item[hash_key], str) and re.fullmatch("[0-9a-f]{64}", item[hash_key]),
                        "Invalid original output hash: " + hash_key)
                row[hash_key] = item[hash_key]
        for label in ("apple", "floor"):
            row[label + "LibraryLoad"] = details.get("libraryLoading", {}).get(label, {}).get("status", default)
        for field, key in (("pipelineCreation", "pipelineCreation"), ("gpuExecution", "execution"), ("numericalComparison", "numericalComparison")):
            value = details.get(key, default)
            row[field] = "passed" if value == "completed" else value
        row["checkedValues"] = details.get("checkedValues", 0)
        if details.get("error"):
            row["gpuDiagnostic"] = details["error"]
        if details:
            hashes = [a.get("sha256") for a in details.get("artifacts", [])]
            require(hashes == [item.get("appleMetallibSha256"), item.get("floorMetallibSha256")], "GPU artifact hashes differ")
            if row["appleLibraryLoad"] == "loaded" and row["floorLibraryLoad"] == "rejected":
                row["gpuStatus"] = "failed"
            if row["gpuStatus"] == "passed":
                require(row["appleLibraryLoad"] == row["floorLibraryLoad"] == "loaded" and
                        all(row[k] == "passed" for k in ("pipelineCreation", "gpuExecution", "numericalComparison")) and
                        type(row["checkedValues"]) is int and row["checkedValues"] > 0,
                        "GPU pass lacks required layer evidence")
        rows.append(row)
    keys = ("appleCompile", "appleLink", "floorCompile", "appleLibraryLoad", "floorLibraryLoad",
            "pipelineCreation", "gpuExecution", "numericalComparison", "gpuStatus")
    return {"schemaVersion": 1, "commit": COMMIT, "cases": rows,
            "totals": {k: dict(collections.Counter(row[k] for row in rows)) for k in keys},
            "scope": {"floorCICorpus": 497, "successfulMetallibCICases": 145, "sameSourcePairs": 82, "gpuEligiblePairs": 48, "interleaveGPUPairs": 36,
                "features": {"interleave": "API3 iOS27/MSL4.1 unsigned 8/16/32-bit scalar/vector interleave and deinterleave; dynamic/constants, both math modes",
                             "integer": "int2/3/4 and uint2/3/4 clz, ctz, popcount, reverse_bits, extract_bits, insert_bits",
                             "derivative": "float/float2/3/4 dfdx, dfdy, fwidth; position-only interior-pixel numerical cases",
                             "common": "same-width float/float2/3/4 mix, step, smoothstep, sign; compile/link only on Mac"},
                "unsupported": ["Half and integer common-function operands", "Mixed/scalar-vector common-function overloads", "Half/integer derivative operands"],
                "untested": ["Full MSL 4.1 language conformance", "iPhone/iPad execution", "Common-function GPU numerics", "Negative/mixed-slope derivatives", "Divergent control flow", "Full applications"]}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--artifact", help="Downloaded exact-run compiler artifact ZIP or extracted folder")
    mode.add_argument("--capability-only", action="store_true", help="Probe installed Apple Metal 4.1 compile/link capability, no artifact or Git/Node needed")
    parser.add_argument("--original-zip", help="Original unchanged pinned ZIP, required when --artifact is an extracted folder")
    parser.add_argument("--output", help="New output directory; must not exist (default: unique directory in current folder)")
    parser.add_argument("--developer-dir", help="Use this installed Xcode Developer directory, still requiring Xcode 26+")
    args = parser.parse_args(argv)
    require(not (args.capability_only and args.original_zip), "--original-zip applies only to --artifact folder input", 2)
    if args.output:
        output = Path(args.output).expanduser().absolute()
        require(not output.exists() and not output.is_symlink(), "Output already exists; choose a NEW directory", 2)
        require(output.parent.is_dir(), "Output parent must already exist", 2)
        output.mkdir(mode=0o700)
    else:
        output = Path(tempfile.mkdtemp(prefix="floor-mac-validation-", dir=Path.cwd())).resolve()
    runner = Runner(output, args.artifact, args.developer_dir, args.capability_only, args.original_zip)
    code = 0
    try:
        runner.execute()
    except KeyboardInterrupt:
        code = 130
        runner.result["error"] = "Interrupted by user; completed evidence retained"
    except Exception as error:
        code = error.code if isinstance(error, Stop) else 1
        runner.result["error"] = str(error)
        runner.result["stages"][runner.stage] = "blocked" if code == 2 else "failed"
    try:
        return runner.finish(code)
    except Exception as error:
        # Even malformed or incomplete harness JSON must not destroy failure logs.
        runner.result["status"] = "failed"
        runner.result["error"] = "Evidence finalization failed: " + str(error)
        (runner.share/"result.json").write_text(sanitize(json.dumps(runner.result, indent=2), runner.replacements))
        (runner.share/"commands.log").write_text(sanitize(json.dumps(runner.commands, indent=2), runner.replacements))
        print("Evidence finalization failed; local work retained at", output, file=sys.stderr)
        print(sanitize(str(error), runner.replacements), file=sys.stderr)
        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Stop as error:
        print(str(error), file=sys.stderr)
        sys.exit(error.code)
