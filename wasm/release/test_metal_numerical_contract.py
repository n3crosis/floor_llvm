#!/usr/bin/env python3
"""Local source-contract + independent integer-formula audit, NOT Swift/GPU proof."""
from pathlib import Path
import random
import re
import unittest

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

if __name__ == "__main__":
    unittest.main()
