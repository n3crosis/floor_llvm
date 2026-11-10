#!/usr/bin/env python3
"""Local source/fixture and independent bit-oracle audit, NOT Swift/GPU proof.

Run beside msl41-bit-interleave.mjs, or set MSL41_INTERLEAVE_FIXTURE_SOURCE to
that exact source path for isolated staging. No compiler, library or GPU is run.
"""
from pathlib import Path
import json
import os
import random
import re
import shutil
import subprocess
import unittest


def bit_list(value, bits):
    assert 0 <= value < 1 << bits
    return list(reversed(f'{value:0{bits}b}'))


def bit_word(bits):
    assert bits
    return int(''.join(reversed(bits)), 2)


def interleave_model(even, odd, bits):
    return bit_word([v for pair in zip(bit_list(even, bits), bit_list(odd, bits)) for v in pair])


def deinterleave_model(value, bits):
    source = bit_list(value, bits * 2)
    return [bit_word(source[parity::2]) for parity in range(2)]


def interleave_inputs(bits):
    # Python arbitrary-width arithmetic independently models the Swift wrapping
    # UInt64 generator. This is not execution or type checking of Swift source.
    maximum, top = (1 << bits) - 1, 1 << (bits - 1)
    even = bit_word(['1' if i % 2 == 0 else '0' for i in range(bits)])
    pairs = [[0, 0], [maximum, 0], [0, maximum], [maximum, maximum], [1, 0], [0, 1],
             [top, 0], [0, top], [even, maximum ^ even], [maximum ^ even, even], [top, 1], [1, top]]
    for i in range(bits):
        pairs.extend([[1 << i, 0], [0, 1 << i]])
    state = 0x4d534c3431 + bits

    def next_word():
        nonlocal state
        state = (state * 6364136223846793005 + 1442695040888963407) % (1 << 64)
        return state

    for _ in range(32):
        pairs.append([next_word() & maximum, next_word() & maximum])
    wide_max = (1 << (2 * bits)) - 1
    words = [0, wide_max, wide_max // 3, 2 * (wide_max // 3), 1, 1 << (2 * bits - 1)]
    words.extend(1 << i for i in range(2 * bits))
    words.extend(next_word() & wide_max for _ in range(32))
    return pairs, words


def little_endian(words, bits):
    assert words and bits in (8, 16, 32, 64)
    return b''.join(word.to_bytes(bits // 8, 'little', signed=False) for word in words)


class MetalNumericalSourceContract(unittest.TestCase):
    def test_source_contract_and_integer_formula_model(self):
        s = Path(__file__).with_name('metal-numerical.swift').read_text()
        for token in ['MTLCreateSystemDefaultDevice()', 'device.makeLibrary(URL:', 'makeRenderPipelineState',
                      'makeComputePipelineState', 'case', 'stride = width == 3 ? 4 : width',
                      'code = 77', 'SHA256.hash', 'destinationBytesPerRow:rowBytes',
                      '2..<(size-2)', 'a.isFinite && f.isFinite', 'numericalComparison']:
            assert token in s, token
        assert 'air64-apple-macos' not in s
        # Source contract, not Swift execution: lock the four-way classification and
        # preserve detailed loader diagnostics on failures.
        classifier = re.search(r'func libraryLoadExitCode\(.*?\n}', s, re.S).group(0)
        assert 'if !appleLoaded { return 77 }' in classifier
        assert 'return floorLoaded ? 0 : 1' in classifier
        for apple, floor, expected in [(False,False,77),(False,True,77),(True,False,1),(True,True,0)]:
            actual = 77 if not apple else (0 if floor else 1)
            assert actual == expected
        assert 'libraryLoadExitCode(appleLoaded:loaded.contains("apple"),floorLoaded:loaded.contains("floor"))' in s
        assert 'if stage != "libraryLoading"' in s
        assert s.index('attributesOfItem(atPath:path)') < s.index('handle.read(upToCount:32*1024*1024)')
        assert 'no numerical proof of fwidth absolute-value behavior for negative slopes' in s
        assert 'let channels = width == 1 ? 1 : width == 2 ? 2 : 4' in s
        assert 'let format: MTLPixelFormat = width == 1 ? .r32Float : width == 2 ? .rg32Float : .rgba32Float' in s
        assert 'pixelFormat:format,width:size' in s
        assert 'pipelineDesc.colorAttachments[0].pixelFormat = format' in s
        assert 'y*(rowBytes/MemoryLayout<Float>.stride)+x*channels+lane' in s
        assert 'count:rowBytes*size/MemoryLayout<Float>.stride' in s
        assert '"channels":channels,"rowBytes":rowBytes,"pixelFormat":formatName' in s
        for width, channels in [(1,1),(2,2),(3,4),(4,4)]:
            # Validate aligned-row addressing independently from compact pixel width.
            addresses = [y*64+x*channels+lane for y in range(2,14) for x in range(2,14) for lane in range(width)]
            self.assertEqual(len(set(addresses)),12*12*width)
            self.assertLess(max(addresses),1024)
        assert 'width == 3 ? "dv_probe_\\(op)_3" : "dv_\\(op)_\\(width)"' in s
        mask = (1 << 32) - 1
        def extract(x, o, n, signed):
            if n == 0: return 0
            if n == 32: return x
            m = (1 << n) - 1
            v = (x >> o) & m
            return (v | (~m & mask)) if signed and v & (1 << (n-1)) else v
        def insert(x, y, o, n):
            if n == 0: return x
            if n == 32: return y
            m = ((1 << n) - 1) << o
            return ((x & ~m) | ((y << o) & m)) & mask
        # Bit-list model intentionally avoids the mask/sign-extension implementation.
        def bit_extract(x, o, n, signed):
            bits = [(x >> b) & 1 for b in range(32)][o:o+n]
            fill = bits[-1] if signed and bits else 0
            return sum(b << i for i, b in enumerate(bits + [fill] * (32-len(bits))))
        def bit_insert(x, y, o, n):
            xb = [(x >> b) & 1 for b in range(32)]
            yb = [(y >> b) & 1 for b in range(32)]
            xb[o:o+n] = yb[:n]
            return sum(b << i for i,b in enumerate(xb))
        rng = random.Random(20261110)
        values = [0, 0x80000000, 0xffffffff, 0xfffffff8, 0xaaaaaaaa, 0x55555555]
        values += [1 << i for i in range(32)] + [rng.getrandbits(32) for _ in range(16)]
        checks = 0
        for x in values:
            y = rng.getrandbits(32)
            for o in range(33):
                for n in range(33-o):
                    for signed in [False, True]:
                        assert extract(x,o,n,signed) == bit_extract(x,o,n,signed)
                        checks += 1
                    assert insert(x,y,o,n) == bit_insert(x,y,o,n)
                    checks += 1
        self.assertEqual(checks, 90882)


class InterleaveNumericalSourceContract(unittest.TestCase):
    def test_swift_source_contract(self):
        source = Path(__file__).with_name('metal-numerical.swift').read_text()
        for token in [
            '["integer","derivative","interleave"].contains(kind)',
            'Int(try option("--bits")) ?? 0', 'option("--form")',
            '[8,16,32].contains(interleaveBits)',
            '["scalar","vector","deinterleave"].contains(interleaveForm)',
            'interleaves(device,queue,libs,interleaveBits,interleaveForm,mode == "constants",out)',
            'let name = "msl41_\\(form)_\\(constants ? "constants" : "dynamic")_\\(bits)"',
            'String(value, radix: 2).reversed()', 'width - bits.count',
            'bits.reversed().reduce(UInt64(0))', '(0..<bits).flatMap { [a[$0], b[$0]] }',
            '$0.offset % 2 == parity', 'UInt64.max >> (64 - bits)',
            'UInt64.max >> (64 - 2 * bits)', '0x4d534c3431 + UInt64(bits)',
            'seed &* 6364136223846793005 &+ 1442695040888963407',
            'Array(all.pairs.prefix(12)) + Array(all.pairs.suffix(4))',
            'Array(all.words.prefix(6)) + Array(all.words.suffix(4))',
            'bits == 64 || value >> bits == 0', 'UInt8(truncatingIfNeeded: value >> (8 * $0))',
            'guard !bytes.isEmpty else', 'guard let address = raw.baseAddress',
            'encoder.setBuffer(input, offset: 0, index: 0)',
            'encoder.setBuffer(destination, offset: 0, index: 1)',
            'threadsPerThreadgroup: MTLSize(width: 1, height: 1, depth: 1)',
            'let input = constants ? nil : try interleaveBuffer',
            'actual[0] == expected && actual[1] == expected && actual[0] == actual[1]',
            '"expectedWordsHex"', '"byteOffset": offset', '"sha256": hash(Data(bytes))',
            '"interleaveEvidenceWriteError"', '"interleavePipelineCreation"',
            'name + "-expected.u8le"', 'name + "-" + label + ".u8le"',
            'observed[libraryIndex].append(contentsOf: bytes)',
            'stage = "interleaveEvidenceSaving"', 'report["bits"] = interleaveBits',
        ]:
            self.assertIn(token, source)
        section = source[source.index('func interleaveBitList('):source.index('func derivatives(')]
        self.assertNotIn('makeLibrary(', section)
        self.assertNotIn('UInt32(', section)
        self.assertNotIn('Int32(', section)
        self.assertNotIn('baseAddress!', section)
        self.assertNotIn('Double(', section)
        self.assertNotIn('Float(', section)
        self.assertNotIn('1 << 64)', section)
        self.assertNotIn('index: 2)', section)
        self.assertIn('do { try persist() } catch', section)
        self.assertIn('stage != "numericalComparison"', section)

    def test_pipeline_failure_preserves_per_library_diagnostics(self):
        source = Path(__file__).with_name('metal-numerical.swift').read_text()
        section = source[source.index('func interleaves('):source.index('func derivatives(')]
        pipeline = section[section.index('var pipelineEvidence:'):section.index('report["pipelineCreation"] = "passed"')]
        self.assertIn('["apple": ["status": "not_run"], "floor": ["status": "not_run"]]', pipeline)
        self.assertIn('pipelineEvidence[label] = ["status": "in_progress"]', pipeline)
        guarded_creation = re.search(r'do \{(.*?)\} catch \{(.*?)\n        \}', pipeline, re.S)
        self.assertIsNotNone(guarded_creation)
        guarded, failure = guarded_creation.groups()
        self.assertIn('guard let fn = lib.makeFunction(name: name)', guarded)
        self.assertIn('try device.makeComputePipelineState(function: fn)', guarded)
        self.assertIn('pipelineEvidence[label] = ["status": "passed"]', guarded)
        expected_failure = ['pipelineEvidence[label] = ["status": "failed", "error": String(describing: error)]',
                            'report["interleavePipelineCreation"] = pipelineEvidence', 'throw error']
        positions = [failure.index(token) for token in expected_failure]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn('code = 77', pipeline)
        # Only the failing label is changed; the other library's completed or
        # not-run status remains intact in the report before error propagation.
        self.assertNotIn('pipelineEvidence =', failure)

    def test_exhaustive_eight_bit_oracle(self):
        # Independent arithmetic-position oracle does not use string weaving.
        def arithmetic(even, odd, bits):
            return sum(((even >> i) & 1) * 4 ** i + ((odd >> i) & 1) * 2 * 4 ** i for i in range(bits))
        for word in range(1 << 16):
            even, odd = deinterleave_model(word, 8)
            self.assertEqual(arithmetic(even, odd, 8), word)
            self.assertEqual(interleave_model(even, odd, 8), word)
        # The bijection above visits all 256^2 pairs and all 65,536 wide words.

    def test_unsigned_width_and_high_64_bit_boundaries(self):
        for bits in (8, 16, 32):
            pairs, words = interleave_inputs(bits)
            maximum, wide_max = (1 << bits) - 1, (1 << (2 * bits)) - 1
            self.assertEqual(len(pairs), 44 + 2 * bits)
            self.assertEqual(len(words), 38 + 2 * bits)
            self.assertEqual(interleave_model(maximum, maximum, bits), wide_max)
            self.assertEqual(interleave_model(0, 1 << (bits - 1), bits), 1 << (2 * bits - 1))
            self.assertEqual(interleave_model(1 << (bits - 1), 0, bits), 1 << (2 * bits - 2))
            for i in range(bits):
                self.assertEqual(deinterleave_model(1 << (2 * i), bits), [1 << i, 0])
                self.assertEqual(deinterleave_model(1 << (2 * i + 1), bits), [0, 1 << i])
            for even, odd in pairs:
                word = interleave_model(even, odd, bits)
                arithmetic = sum(((even >> i) & 1) * 4 ** i + ((odd >> i) & 1) * 2 * 4 ** i for i in range(bits))
                self.assertEqual(word, arithmetic)
                self.assertEqual(deinterleave_model(word, bits), [even, odd])
                # Dynamic scalar and vector2 share tightly packed input bytes.
                self.assertEqual(len(little_endian([even, odd], bits)), bits // 4)
                encoded = little_endian([word], 2 * bits)
                self.assertEqual(len(encoded), bits // 4)
                self.assertEqual(int.from_bytes(encoded, 'little'), word)
            for word in words:
                pair = deinterleave_model(word, bits)
                self.assertEqual(interleave_model(*pair, bits), word)
                self.assertEqual(len(little_endian(pair, bits)), bits // 4)
            # Seeded, arbitrary wide inputs include non-pair-originated words.
            self.assertTrue(any(v & (1 << (2 * bits - 1)) for v in words[-32:]))
        self.assertEqual(little_endian([1 << 63], 64), b'\0' * 7 + b'\x80')
        self.assertEqual(little_endian([(1 << 64) - 1], 64), b'\xff' * 8)
        self.assertEqual(deinterleave_model(1 << 63, 32), [0, 0x80000000])
        self.assertEqual(deinterleave_model((1 << 64) - 1, 32), [0xffffffff, 0xffffffff])
        for bits in (8, 16, 32, 64):
            with self.assertRaises(OverflowError):
                little_endian([1 << bits], bits)
            with self.assertRaises(OverflowError):
                little_endian([-1], bits)
        with self.assertRaises(AssertionError):
            little_endian([], 8)

    def test_authored_fixture_names_bindings_and_exact_constants(self):
        fixture = Path(os.environ.get('MSL41_INTERLEAVE_FIXTURE_SOURCE',
                                      Path(__file__).with_name('msl41-bit-interleave.mjs')))
        if not fixture.is_file():
            self.skipTest('Set MSL41_INTERLEAVE_FIXTURE_SOURCE for isolated source staging')
        if not shutil.which('node'):
            self.skipTest('Node is unavailable; fixture cross-check not run')
        script = '''
import {pathToFileURL} from 'node:url';
const m = await import(pathToFileURL(process.argv[1]));
const data = {cases: m.msl41BitInterleaveCases.filter(c => c.status === 0 && c.kind === 0),
  inputs: [8, 16, 32].map(bits => ({bits, ...m.bitInterleaveInputs(bits)}))};
console.log(JSON.stringify(data, (_, v) => typeof v === 'bigint' ? '0x' + v.toString(16) : v));
'''
        result = subprocess.run(['node', '--input-type=module', '-e', script, str(fixture.resolve())],
                                check=True, capture_output=True, text=True, timeout=15)
        data = json.loads(result.stdout)
        self.assertEqual(len(data['cases']), 36)
        self.assertEqual(len({case['source'] for case in data['cases']}), 18)
        for authored in data['inputs']:
            pairs, words = interleave_inputs(authored['bits'])
            self.assertEqual(pairs, [[int(v, 16) for v in pair] for pair in authored['pairs']])
            self.assertEqual(words, [int(v, 16) for v in authored['words']])
        for case in data['cases']:
            self.assertEqual((case['api'], case['metalVersion'], case['ios']), (3, 410, 27))
            bits, form, mode = (case['bitInterleaveBits'], case['bitInterleaveForm'], case['bitInterleaveMode'])
            source = case['source']
            self.assertIn(f'kernel void msl41_{form}_{mode}_{bits}(', source)
            narrow, wide = {8: ('uchar', 'ushort'), 16: ('ushort', 'uint'), 32: ('uint', 'ulong')}[bits]
            output = narrow + '2' if form == 'deinterleave' else wide
            self.assertIn(f'device volatile {output}* b [[buffer(1)]]', source)
            pairs, words = interleave_inputs(bits)
            if mode == 'dynamic':
                input_type = wide if form == 'deinterleave' else narrow + ('2' if form == 'vector' else '')
                self.assertIn(f'device const volatile {input_type}* a [[buffer(0)]]', source)
                call = 'interleave(a[0],a[1])' if form == 'scalar' else f'{"deinterleave" if form == "deinterleave" else "interleave"}(a[0])'
                self.assertIn(f'b[0]={call};', source)
                self.assertEqual(len(re.findall(r'b\[\d+\]=', source)), 1)
            else:
                self.assertNotIn('buffer(0)', source)
                values = [[v] for v in words[:6] + words[-4:]] if form == 'deinterleave' else pairs[:12] + pairs[-4:]
                stores = re.findall(r'b\[(\d+)\]=([^;]+);', source)
                self.assertEqual([int(i) for i, _ in stores], list(range(len(values))))
                actual_literals = [[int(v, 16) for v in re.findall(r'0x([0-9a-f]+)ul', expr)] for _, expr in stores]
                self.assertEqual(actual_literals, values)
                expected = [deinterleave_model(v[0], bits) if form == 'deinterleave' else [interleave_model(*v, bits)] for v in values]
                packed = b''.join(little_endian(v, bits if form == 'deinterleave' else 2 * bits) for v in expected)
                self.assertEqual(len(values), 10 if form == 'deinterleave' else 16)
                self.assertEqual(len(packed), len(values) * bits // 4)


if __name__ == "__main__":
    unittest.main()
