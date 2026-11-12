from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import prepare_connectivity_experiment as preparation


class ConnectivityPreparationTests(unittest.TestCase):
    def test_parallel_overlays_preserve_exact_rgba_values(self):
        projection = np.linspace(0, 1, 24, dtype=np.float32).reshape(4, 3, 2)
        injection = 1 - projection
        mask = projection > 0.2
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()):
            output = Path(directory)
            counts = preparation.export_overlays(projection, injection, mask, output)
            self.assertEqual(counts, {"coronal": 4, "sagittal": 2, "axial": 3})
            for plane in preparation.PLANES:
                name, axis, transpose = plane["name"], plane["axis"], plane["transpose"]
                for index in range(counts[name]):
                    valid = preparation.extract_slice(mask, axis, index, transpose)
                    for layer, volume, encode in (
                        ("projection", projection, preparation.projection_rgba),
                        ("injection", injection, preparation.injection_rgba),
                    ):
                        expected = encode(preparation.extract_slice(volume, axis, index, transpose), valid)
                        with Image.open(output / "overlays" / layer / name / f"{name}-{index:03d}.webp") as image:
                            np.testing.assert_array_equal(np.asarray(image.convert("RGBA")), expected)

    def test_three_downloads_start_concurrently(self):
        barrier = threading.Barrier(3)
        calls = []

        def download(_experiment, image, _resolution, _destination):
            calls.append(image)
            barrier.wait(timeout=3)

        volume = np.ones((4, 4, 4), dtype=np.float32)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            annotation = root / "annotation.nrrd"
            annotation.touch()
            arguments = ["prepare", "--experiment-id", "42", "--output", str(root / "result"), "--annotation-mask", str(annotation)]
            with patch.object(sys, "argv", arguments), \
                    patch.object(preparation, "download_volume", side_effect=download), \
                    patch.object(preparation.nrrd, "read", return_value=(volume, {})), \
                    patch.object(preparation, "export_overlays", return_value={"coronal": 4, "sagittal": 4, "axial": 4}), \
                    patch.object(preparation, "export_point_cloud", return_value=1), \
                    patch.object(preparation, "export_volume", return_value=(2, 2, 2)), \
                    redirect_stdout(io.StringIO()):
                preparation.main()
            self.assertCountEqual(calls, preparation.VOLUMES)
            manifest = json.loads((root / "result/web/manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["experiment_id"], 42)


if __name__ == "__main__":
    unittest.main()
