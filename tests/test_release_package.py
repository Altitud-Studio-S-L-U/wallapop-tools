"""Behavior checks for the manual release allowlist and deterministic ZIP."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("release_package", ROOT / "scripts" / "package-release.py")
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class ReleasePackageTests(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / ".tmp"
        scratch.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="release-test-", dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in RELEASE.EXTENSION_FILES:
            destination = self.root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes((ROOT / name).read_bytes())

    def test_packages_only_runtime_assets_and_license(self):
        for name in (".env", ".git/config", "logs/token.log", "node_modules/secret.txt", "tests/private.json"):
            destination = self.root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text("must never ship", encoding="utf-8")
        output = self.root / "release.zip"
        result = RELEASE.build_archive(self.root, output)
        self.assertTrue(result["source_matches"])
        self.assertEqual(result["version"], "5.0.2")
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.namelist(), sorted(RELEASE.EXTENSION_FILES))
            self.assertEqual(json.loads(archive.read("manifest.json"))["version"], "5.0.2")

    def test_repeated_builds_are_byte_identical(self):
        first = self.root / "first.zip"
        second = self.root / "second.zip"
        RELEASE.build_archive(self.root, first)
        RELEASE.build_archive(self.root, second)
        self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_verification_rejects_modified_source(self):
        output = self.root / "release.zip"
        RELEASE.build_archive(self.root, output)
        (self.root / "content/bridge.js").write_text("changed source", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "differ from the current source"):
            RELEASE.verify_archive(self.root, output)

    def test_verification_rejects_unexpected_entries(self):
        output = self.root / "release.zip"
        RELEASE.build_archive(self.root, output)
        with zipfile.ZipFile(output, "a") as archive:
            archive.writestr(".env", "must never ship")
        with self.assertRaisesRegex(ValueError, "exactly match"):
            RELEASE.verify_archive(self.root, output)

    def test_missing_runtime_file_fails_instead_of_producing_partial_archive(self):
        (self.root / "background/service-worker.js").unlink()
        output = self.root / "release.zip"
        with self.assertRaisesRegex(ValueError, "regular file"):
            RELEASE.build_archive(self.root, output)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
