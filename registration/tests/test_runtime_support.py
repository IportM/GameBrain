from pathlib import Path
import sys
import unittest

from packaging.requirements import Requirement

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from runtime_support import runtime_support


class RuntimeSupportTest(unittest.TestCase):
    def test_mac_intel_15_has_dedicated_profile(self):
        result = runtime_support("Darwin", "x86_64", "15.7.7", (3, 12), 64)
        self.assertTrue(result["compatible"])
        self.assertEqual(result["profile"], "mac-intel")

    def test_old_intel_mac_and_wrong_python_fail_explicitly(self):
        result = runtime_support("Darwin", "x86_64", "14.7", (3, 12), 64)
        self.assertFalse(result["compatible"])
        self.assertIn("macOS 15", result["compatibilityError"])
        self.assertFalse(runtime_support("Darwin", "x86_64", "15.7.7", (3, 11), 64)["compatible"])

    def test_platform_markers_select_one_consistent_tensorflow_numpy_pair(self):
        requirements = []
        for file in ("requirements.txt", "requirements-extraction.txt"):
            for line in (ROOT / file).read_text().splitlines():
                if line.strip() and not line.startswith(("#", "-")):
                    requirements.append(Requirement(line))
        for system, machine, expected in (
            ("darwin", "x86_64", {"numpy": "==1.26.4", "tensorflow": "==2.16.2"}),
            ("darwin", "arm64", {"numpy": "==2.3.5", "tensorflow": "==2.21.0"}),
            ("win32", "AMD64", {"numpy": "==2.3.5", "tensorflow": "==2.21.0"}),
            ("linux", "x86_64", {"numpy": "==2.3.5", "tensorflow": "==2.21.0"}),
        ):
            selected = [requirement for requirement in requirements if requirement.name in expected and
                        (requirement.marker is None or requirement.marker.evaluate({"sys_platform": system, "platform_machine": machine}))]
            self.assertEqual(len(selected), 2)
            self.assertEqual({item.name: str(item.specifier) for item in selected}, expected)


if __name__ == "__main__":
    unittest.main()
