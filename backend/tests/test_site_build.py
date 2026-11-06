import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.site_build import read_build_info


class SiteBuildTests(unittest.TestCase):
    def test_returns_only_public_build_fields(self):
        info = {"version": "1.1.0", "buildId": "test-build", "builtAt": "2026-11-06T00:00:00Z",
                "revision": "abc123", "dirty": False, "unrelated": "not exposed"}
        with patch("app.site_build.Path.read_text", return_value=json.dumps(info)):
            got = read_build_info()
        self.assertEqual(got["buildId"], "test-build")
        self.assertFalse(got["dirty"])
        self.assertNotIn("unrelated", got)

    def test_missing_or_invalid_manifest_is_unknown(self):
        with patch("app.site_build.Path.read_text", side_effect=FileNotFoundError):
            self.assertIsNone(read_build_info())
        for raw in ["not JSON", "null", "[]", "{}", '{"version":"1.1.0"}']:
            with patch("app.site_build.Path.read_text", return_value=raw):
                self.assertIsNone(read_build_info())
