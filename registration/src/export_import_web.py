import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage
from skimage import measure


PLANES = {
    "coronal": {"axis": 0, "transpose": False},
    "sagittal": {"axis": 2, "transpose": True},
    "axial": {"axis": 1, "transpose": False},
}


def plane_slice(volume: np.ndarray, plane: str, index: int) -> np.ndarray:
    image = np.take(volume, index, axis=int(PLANES[plane]["axis"]))
    result = np.asarray(image).T if PLANES[plane]["transpose"] else np.asarray(image)
    return np.fliplr(result) if plane == "sagittal" else result


def export_slices(volume: np.ndarray, mask: np.ndarray, output: Path) -> dict[str, int]:
    finite = volume[np.isfinite(volume)]
    positive = finite[finite > 0]
    low, high = np.percentile(positive, (1, 99.5))
    counts: dict[str, int] = {}
    for plane, definition in PLANES.items():
        count = int(volume.shape[int(definition["axis"])])
        counts[plane] = count
        width = max(3, len(str(count - 1)))
        plane_dir = output / "slices" / plane
        plane_3d_dir = output / "slices-3d" / plane
        mask_outline_dir = output / "mask-outline" / plane
        plane_dir.mkdir(parents=True, exist_ok=True)
        plane_3d_dir.mkdir(parents=True, exist_ok=True)
        mask_outline_dir.mkdir(parents=True, exist_ok=True)
        for index in range(count):
            image_slice = plane_slice(volume, plane, index)
            normalized = np.clip((image_slice - low) / max(high - low, 1e-6), 0, 1)
            gray = (normalized * 255).astype(np.uint8)
            file_name = f"{plane}-{index:0{width}d}.webp"
            Image.fromarray(gray, mode="L").save(
                plane_dir / file_name,
                format="WEBP",
                quality=88,
                method=4,
            )
            mask_slice = plane_slice(mask, plane, index)
            alpha = np.where(mask_slice, 255, 0).astype(np.uint8)
            rgba = np.dstack((gray, gray, gray, alpha))
            Image.fromarray(rgba, mode="RGBA").save(
                plane_3d_dir / file_name,
                format="WEBP",
                lossless=True,
                method=4,
            )
            boundary = np.logical_xor(
                mask_slice,
                ndimage.binary_erosion(mask_slice, iterations=1, border_value=0),
            )
            boundary = ndimage.binary_dilation(boundary, iterations=1)
            outline = np.zeros((*gray.shape, 4), dtype=np.uint8)
            outline[boundary] = (82, 226, 139, 245)
            Image.fromarray(outline, mode="RGBA").save(
                mask_outline_dir / file_name,
                format="WEBP",
                lossless=True,
                method=4,
            )
    return counts


def export_mesh(mask: np.ndarray, spacing_mm: np.ndarray, output: Path) -> None:
    smooth = ndimage.gaussian_filter(mask.astype(np.float32), sigma=1.1)
    vertices, faces, _, _ = measure.marching_cubes(
        smooth, level=0.5, spacing=tuple(spacing_mm * 1000)
    )
    center = (np.asarray(mask.shape, dtype=np.float32) - 1) * spacing_mm * 500
    vertices -= center
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
    trimesh.smoothing.filter_humphrey(mesh, alpha=0.1, beta=0.5, iterations=4)
    mesh.remove_unreferenced_vertices()
    trimesh.repair.fix_normals(mesh, multibody=True)
    if mesh.is_watertight and mesh.volume < 0:
        mesh.invert()
    mesh.visual = trimesh.visual.ColorVisuals(
        mesh=mesh, face_colors=(205, 216, 211, 255)
    )
    mesh.export(output / "subject.glb", file_type="glb")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prépare un NIfTI natif pour le visualiseur")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--mask", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = args.input.resolve()
    mask_source = args.mask.resolve()
    output = args.output.resolve()
    image = nib.load(source)
    native_volume = np.asarray(image.dataobj, dtype=np.float32)
    volume = np.flip(np.transpose(native_volume, (1, 2, 0)), axis=(0, 1))
    native_mask = np.asarray(nib.load(mask_source).dataobj) > 0.5
    mask = np.flip(np.transpose(native_mask, (1, 2, 0)), axis=(0, 1))
    if volume.ndim != 3:
        raise ValueError(f"Image NIfTI 3D attendue, dimensions reçues : {volume.shape}")
    if mask.shape != volume.shape:
        raise ValueError(f"Masque incompatible : image {volume.shape}, masque {mask.shape}")
    native_spacing = np.asarray(image.header.get_zooms()[:3], dtype=np.float32)
    spacing = native_spacing[[1, 2, 0]]
    if np.any(spacing <= 0):
        raise ValueError(f"Espacement NIfTI invalide : {spacing.tolist()}")

    output.mkdir(parents=True, exist_ok=True)
    counts = export_slices(volume, mask, output)
    export_mesh(mask, spacing, output)
    size = np.asarray(volume.shape, dtype=np.float32) * spacing
    manifest = {
        "shape": [int(value) for value in volume.shape],
        "spacing_mm": [float(value) for value in spacing],
        "size_mm": [float(value) for value in size],
        "slice_counts": counts,
        "planes": {
            "coronal": {
                "spacing_mm": float(spacing[0]),
                "width_mm": float(size[2]),
                "height_mm": float(size[1]),
            },
            "sagittal": {
                "spacing_mm": float(spacing[2]),
                "width_mm": float(size[0]),
                "height_mm": float(size[1]),
            },
            "axial": {
                "spacing_mm": float(spacing[1]),
                "width_mm": float(size[2]),
                "height_mm": float(size[0]),
            },
        },
        "orientation": "site_allen_axes",
        "mesh": "subject.glb",
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[OK] Image prête pour le visualiseur : {output}", flush=True)


if __name__ == "__main__":
    main()
