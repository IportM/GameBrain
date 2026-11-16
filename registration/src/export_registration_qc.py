"""Prepare native-space Allen images for visual inspection; no registration."""
import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from PIL import Image

from export_native_labels_web import PLANES, plane_slice


def export_qc(registration: Path) -> None:
    template_path = registration / "allen_template_in_input_space.nii.gz"
    labels_path = registration / "allen_labels_in_input_space.nii.gz"
    reference_path = registration / "input_brain_extracted.nii.gz"
    sources = (template_path, labels_path, reference_path)
    signature = {path.name: [path.stat().st_size, path.stat().st_mtime_ns] for path in sources}
    output = registration / "qc-web"
    marker = output / "manifest.json"
    if marker.exists() and json.loads(marker.read_text(encoding="utf-8")) == signature:
        return
    images = [nib.load(path) for path in sources]
    reference = images[-1]
    if any(image.shape != reference.shape or not np.allclose(image.affine, reference.affine, atol=1e-4)
           for image in images[:-1]):
        raise ValueError("QC requires matching native grids and affine matrices")
    template = np.asarray(images[0].dataobj, dtype=np.float32)
    mask = np.asarray(images[1].dataobj) > 0
    valid = mask & np.isfinite(template)
    if not np.any(valid):
        raise ValueError("Registered Allen template is empty")
    low, high = np.percentile(template[valid], [1, 99])
    gray = (np.clip((np.nan_to_num(template) - low) / max(float(high - low), 1e-6), 0, 1) * 255).astype(np.uint8)
    # Match the native import / native annotation display convention exactly.
    gray = np.flip(np.transpose(gray, (1, 2, 0)), axis=(0, 1))
    mask = np.flip(np.transpose(valid, (1, 2, 0)), axis=(0, 1))
    for plane, definition in PLANES.items():
        count = gray.shape[definition["axis"]]
        directory = output / plane
        directory.mkdir(parents=True, exist_ok=True)
        for index in range(count):
            pixels = plane_slice(gray, plane, index)
            alpha = plane_slice(mask, plane, index).astype(np.uint8) * 255
            rgba = np.stack((pixels, pixels, pixels, alpha), axis=-1)
            Image.fromarray(rgba).save(directory / f"{plane}-{index:03d}.webp", lossless=True, method=1)
    marker.write_text(json.dumps(signature), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--registration", type=Path, required=True)
    export_qc(parser.parse_args().registration.resolve())
