import csv
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import nibabel as nib
import numpy as np


SOURCE = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE))

from resource_paths import RESOURCES, portable_path, resolve_atlas_resource


class PortabilityTests(unittest.TestCase):
    def test_relative_resource_survives_project_move(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / "project with spaces"
            resource = project / "registration" / "resources" / "atlas.nii.gz"
            output = project / "registration" / "imports" / "mouse" / "registration"
            resource.parent.mkdir(parents=True)
            output.mkdir(parents=True)
            resource.touch()
            value = portable_path(resource, output)
            self.assertNotIn("\\", value)
            moved = project.with_name("moved project")
            project.rename(moved)
            restored = resolve_atlas_resource(value, moved / output.relative_to(project))
            self.assertEqual(restored, moved / resource.relative_to(project))

    def test_old_absolute_paths_use_bundled_official_atlas(self):
        name = "registration_allen_ccf2017_100um.nii.gz"
        for value in (f"Z:\\old-machine\\resources\\{name}", f"/missing-machine/resources/{name}"):
            self.assertEqual(resolve_atlas_resource(value, SOURCE), RESOURCES / name)

    def test_custom_missing_atlas_is_not_silently_replaced(self):
        with self.assertRaises(FileNotFoundError):
            resolve_atlas_resource("/missing-machine/custom-atlas.nii.gz", SOURCE)

    def test_bundled_catalogue_matches_web_region_ids(self):
        catalogue = json.loads((RESOURCES / "structures.json").read_text(encoding="utf-8"))
        web = SOURCE.parents[1] / "web" / "public" / "atlas" / "detailed-annotations.json"
        if web.exists():
            structures = json.loads(web.read_text(encoding="utf-8"))["structures"]
            by_id = {item["id"]: item for item in catalogue}
            for structure in structures:
                self.assertEqual(by_id[structure["id"]]["acronym"], structure["acronym"])

    def test_statistics_and_export_do_not_need_data_source(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            data = np.arange(1, 9, dtype=np.float32).reshape(2, 2, 2)
            labels = np.ones((2, 2, 2), dtype=np.int32)
            image = directory / "image.nii.gz"
            annotation = directory / "labels.nii.gz"
            nib.save(nib.Nifti1Image(data, np.eye(4)), image)
            nib.save(nib.Nifti1Image(labels, np.eye(4)), annotation)
            common = ["--input", str(image), "--labels", str(annotation)]
            result = subprocess.run(
                [sys.executable, str(SOURCE / "compute_region_statistics.py"), *common, "--region-id", "1"],
                cwd=directory, text=True, encoding="utf-8", capture_output=True, check=True,
            )
            stats = json.loads(result.stdout)
            self.assertEqual(stats["region_id"], 1)
            result = subprocess.run(
                [sys.executable, str(SOURCE / "export_region_statistics.py"), *common,
                 "--region-ids", "1", "--modality-name", "Synthetic"],
                cwd=directory, text=True, encoding="utf-8", capture_output=True, check=True,
            )
            rows = list(csv.DictReader(io.StringIO(result.stdout), delimiter=";"))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["region_id"], "1")
            self.assertEqual(rows[0]["acronym"], "TMv")
            self.assertAlmostEqual(float(rows[0]["mean"]), 4.5)


if __name__ == "__main__":
    unittest.main()
