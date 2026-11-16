import sys
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from export_registration_qc import export_qc


class RegistrationQCTest(unittest.TestCase):
    def prepare(self, root, affine=None):
        data = np.arange(24, dtype=np.float32).reshape(2, 3, 4) + 1
        for name, values in (
            ("input_brain_extracted", data),
            ("allen_template_in_input_space", data),
            ("allen_labels_in_input_space", np.ones_like(data)),
        ):
            matrix = affine if name == "allen_template_in_input_space" and affine is not None else np.eye(4)
            nib.save(nib.Nifti1Image(values, matrix), root / f"{name}.nii.gz")

    def test_export_grid_orientation_and_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.prepare(root)
            export_qc(root)
            expected = {"coronal": (3, (2, 4)), "sagittal": (2, (3, 4)), "axial": (4, (2, 3))}
            for plane, (count, size) in expected.items():
                files = sorted((root / "qc-web" / plane).glob("*.webp"))
                self.assertEqual(len(files), count)
                with Image.open(files[0]) as image:
                    self.assertEqual(image.size, size)
                    red = np.asarray(image)[..., 0]
                    # Native display flips AP/DV, and sagittal additionally flips horizontal.
                    if plane == "coronal":
                        self.assertGreater(int(red[0, 0]), int(red[-1, 0]))
                    if plane == "sagittal":
                        self.assertLess(int(red[0, 0]), int(red[0, -1]))
            marker = root / "qc-web" / "manifest.json"
            stamp = marker.stat().st_mtime_ns
            export_qc(root)
            self.assertEqual(marker.stat().st_mtime_ns, stamp)

    def test_rejects_same_shape_with_wrong_affine(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            affine = np.eye(4)
            affine[0, 3] = 5
            self.prepare(root, affine)
            with self.assertRaisesRegex(ValueError, "matching native grids"):
                export_qc(root)


if __name__ == "__main__":
    unittest.main()
