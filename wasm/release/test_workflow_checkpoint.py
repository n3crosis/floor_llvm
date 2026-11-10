"""Source-contract tests for deliberate, non-canceling CI checkpoints."""
from pathlib import Path
import json
import re
import unittest


class WorkflowCheckpointTests(unittest.TestCase):
    def test_push_requires_explicit_checkpoint_path(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows/release-air-wasm.yml").read_text()
        push = re.search(r"(?ms)^  push:\n(.*?)(?=^\S)", workflow).group(1)
        self.assertIn("branches: [wasm, wasm-rebased-functional-20261110]", push)
        self.assertIn("paths: [wasm/release/validation-checkpoint.json]", push)
        self.assertNotIn("paths-ignore:", push)
        self.assertIn("  workflow_dispatch:", workflow)
        self.assertIn("  cancel-in-progress: false", workflow)
        checkpoint = json.loads((root / "wasm/release/validation-checkpoint.json").read_text())
        self.assertEqual(checkpoint["schemaVersion"], 1)
        self.assertTrue(checkpoint["checkpoint"])
        self.assertIs(checkpoint["releaseRequested"], False)


if __name__ == "__main__":
    unittest.main()
