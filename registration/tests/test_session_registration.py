import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import nibabel as nib
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from register_session import apply_session_transform, session_transform_paths


class SessionRegistrationTest(unittest.TestCase):
    def test_transform_paths_are_local_and_present(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            (session / "forward.mat").touch()
            manifest = session / "manifest.json"
            manifest.write_text(json.dumps({"forward_transforms": ["forward.mat"]}))
            self.assertEqual(session_transform_paths(session), [str((session / "forward.mat").resolve())])
            for names in ([], ["missing.mat"], ["../outside.mat"]):
                manifest.write_text(json.dumps({"forward_transforms": names}))
                with self.assertRaises(ValueError):
                    session_transform_paths(session)

    def test_apply_uses_forward_transform_and_linear_interpolation_without_scaling_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.nii.gz"
            reference = root / "reference.nii.gz"
            session = root / "session"
            session.mkdir()
            data = np.arange(125, dtype=np.float32).reshape(5, 5, 5)
            for path in (source, reference, session / "rare.nii.gz"):
                nib.save(nib.Nifti1Image(data, np.eye(4)), path)
            (session / "forward.mat").touch()
            (session / "manifest.json").write_text(json.dumps({"forward_transforms": ["forward.mat"]}))
            calls = []

            def apply(**kwargs):
                calls.append(kwargs)
                return kwargs["moving"]

            engine = types.SimpleNamespace(image_read=lambda path: nib.load(path), apply_transforms=apply,
                                           image_write=lambda image, path: nib.save(image, path))
            output = root / "prepared.nii.gz"
            with patch.dict(sys.modules, ants=engine):
                apply_session_transform(source, reference, session, output)
            self.assertEqual(calls[0]["interpolator"], "linear")
            self.assertEqual(calls[0]["transformlist"], [str((session / "forward.mat").resolve())])
            np.testing.assert_array_equal(np.asarray(nib.load(output).dataobj), data)
            np.testing.assert_array_equal(np.asarray(nib.load(source).dataobj), data)

    def test_modality_outside_its_session_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            affine = np.eye(4)
            affine[0, 3] = 100
            nib.save(nib.Nifti1Image(np.ones((5, 5, 5)), affine), root / "source.nii.gz")
            nib.save(nib.Nifti1Image(np.ones((5, 5, 5)), np.eye(4)), root / "rare.nii.gz")
            with patch.dict(sys.modules, ants=types.SimpleNamespace()):
                with self.assertRaisesRegex(ValueError, "ne chevauche pas"):
                    apply_session_transform(root / "source.nii.gz", root / "rare.nii.gz", root, root / "out.nii.gz")


if __name__ == "__main__":
    unittest.main()
