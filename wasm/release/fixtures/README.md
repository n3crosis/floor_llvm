# Focused serializer regression fixtures

These are synthetic/public regression inputs, not game data. They establish compilation/serialization only, not GPU, numerical-policy, device or application qualification.

- `vertex-no-arguments.metal`: unchanged generated Cross MSL20000 constant-position vertex, 419 bytes, SHA256 c0b27f3243f13964685327f4ec1050801152021217fa8179c092cf539b151a09. The v0.2.0 compiler accepts LLVM output but its writer aborts while indexing an empty ordinary argument metadata node.
- `vertex-live-argument.metal`: unchanged generated Cross MSL20000 vertex-mov-reg, 447 bytes, SHA256 6fd6d049bd16401426f034a5e53ae0d1054f62660887d7cb1c01441b4fd612c5. Live stage_in attribute control. Both use iOS18/API math profile0; no claim that observed fast-math metadata satisfies conservative-policy admission.
- `d2r-vertex.metal`: exact `web/toolchain/metal-air-compiler/fixtures/msl-vertex.metal` from the user's `n3crosis/d2r-mobile` commit155020453d892be8a653fc9e6a1bafcbfd114c64, SHA256 cca026dee042fbd4476d929aae796d6b07b775d460cd455cf8476679e8a659f7. The driver prepends `#define SCALE 2.0f\n`, matching that fork's canary. No additional license header has been invented.
- `d2r-patch.metal`: exact same fork/commit `web/toolchain/metal-air-compiler/fixtures/msl-patch-entry-name.metal`, SHA256 ae7eee3a9519bacb782247ca871389f9f1b38fe7f02933a964f4891564ef0182. Its MIT/SPDX and independently authored regression notice remain intact.

D2R canaries use their explicitly distinct fast-f32/profile1 configuration, not a fallback for the profile0 cases. Existing D2R release/pins/source are not changed. The original D2R path pinned floor v0.1.0 and generated MSL20300 with its own Cross/options; these fixtures alone do not reproduce that whole pipeline.

Metallib output embeds a random UUID. Tests record observed digests for traceability but do not expect deterministic full binary hashes. The focused C++ metadata test calls the actual writer with valid empty arguments and malformed recognized air.patch metadata; it does not replace production code with a model.
