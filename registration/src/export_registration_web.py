import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage
from skimage import measure


PLANES = (
    {"name": "coronal", "axis": 0, "transpose": False},
    {"name": "sagittal", "axis": 2, "transpose": True},
    {"name": "axial", "axis": 1, "transpose": False},
)
MESH_CENTER_UM = np.array([7500.01, 3394.489, 5687.737], dtype=np.float32)
WEB_RESOLUTION_UM = 50


def to_site_axes(volume: np.ndarray) -> np.ndarray:
    """Convertit la grille RAS FC3R vers l'ordre d'axes utilisé par le site."""
    return np.flip(np.transpose(volume, (1, 2, 0)), axis=(0, 1)).copy()


def largest_component(mask: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(mask)
    if count == 0:
        raise ValueError("Le volume recalé ne contient aucun signal exploitable")
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return labels == int(np.argmax(sizes))


def brain_mask(volume: np.ndarray, atlas_mask: np.ndarray) -> np.ndarray:
    finite = volume[np.isfinite(volume)]
    positive = finite[finite > 0]
    if positive.size == 0:
        raise ValueError("Le volume recalé ne contient aucune intensité positive")
    threshold = max(float(np.percentile(positive, 1)), float(positive.max()) * 0.01)
    mask = largest_component((volume > threshold) & atlas_mask)
    mask = ndimage.binary_closing(mask, iterations=2)
    mask = ndimage.binary_fill_holes(mask)
    return largest_component(mask)


def extract_slice(volume: np.ndarray, axis: int, index: int, transpose: bool) -> np.ndarray:
    image = np.asarray(np.take(volume, index, axis=axis))
    return image.T if transpose else image


def export_slices(volume: np.ndarray, mask: np.ndarray, output: Path) -> dict[str, int]:
    zoom = 100 / WEB_RESOLUTION_UM
    resized = ndimage.zoom(volume, zoom=zoom, order=1, prefilter=False)
    resized_mask = ndimage.zoom(mask.astype(np.uint8), zoom=zoom, order=0) > 0
    brain_values = resized[resized_mask & np.isfinite(resized)]
    low, high = np.percentile(brain_values, (1, 99.5))
    counts: dict[str, int] = {}

    for plane in PLANES:
        name = str(plane["name"])
        axis = int(plane["axis"])
        transpose = bool(plane["transpose"])
        count = resized.shape[axis]
        counts[name] = int(count)
        index_width = max(3, len(str(count - 1)))
        plane_dir = output / "slices" / name
        plane_dir.mkdir(parents=True, exist_ok=True)
        for index in range(count):
            image_slice = extract_slice(resized, axis, index, transpose)
            mask_slice = extract_slice(resized_mask, axis, index, transpose)
            normalized = np.clip((image_slice - low) / max(high - low, 1e-6), 0, 1)
            gray = (normalized * 255).astype(np.uint8)
            rgba = np.dstack((gray, gray, gray, mask_slice.astype(np.uint8) * 255))
            filename = f"{name}-{index:0{index_width}d}.webp"
            Image.fromarray(rgba, mode="RGBA").save(
                plane_dir / filename, format="WEBP", quality=86, method=4
            )
    return counts


def export_mesh(mask: np.ndarray, spacing_mm: np.ndarray, output: Path) -> None:
    smooth_mask = ndimage.gaussian_filter(mask.astype(np.float32), sigma=1.15)
    vertices, faces, _, _ = measure.marching_cubes(
        smooth_mask, level=0.5, spacing=tuple(spacing_mm * 1000)
    )
    vertices -= MESH_CENTER_UM
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
    trimesh.smoothing.filter_humphrey(mesh, alpha=0.1, beta=0.5, iterations=4)
    mesh.visual = trimesh.visual.ColorVisuals(
        mesh=mesh, face_colors=(205, 216, 211, 255)
    )
    mesh.export(output / "subject.glb", file_type="glb")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prépare un recalage pour le visualiseur web")
    parser.add_argument("--result", type=Path, required=True)
    args = parser.parse_args()
    result = args.result.resolve()
    source = result / "input_in_allen_space.nii.gz"
    if not source.exists():
        raise FileNotFoundError(source)

    image = nib.load(source)
    volume = np.asarray(image.dataobj, dtype=np.float32)
    if volume.ndim != 3:
        raise ValueError(f"Volume 3D attendu, dimensions reçues : {volume.shape}")
    registration_manifest = result / "registration_manifest.json"
    if not registration_manifest.exists():
        raise FileNotFoundError(registration_manifest)
    registration = json.loads(registration_manifest.read_text(encoding="utf-8"))
    labels_path = Path(registration["labels"]).expanduser().resolve()
    if not labels_path.exists():
        raise FileNotFoundError(labels_path)
    atlas_mask = np.asarray(nib.load(labels_path).dataobj) > 0
    if atlas_mask.shape != volume.shape:
        raise ValueError(
            f"Géométries incompatibles : souris {volume.shape}, Allen {atlas_mask.shape}"
        )
    if volume.shape == (114, 132, 80):
        volume = to_site_axes(volume)
        atlas_mask = to_site_axes(atlas_mask)
    mask = brain_mask(volume, atlas_mask)
    web_output = result / "web"
    web_output.mkdir(parents=True, exist_ok=True)
    counts = export_slices(volume, mask, web_output)
    export_mesh(mask, np.asarray(image.header.get_zooms()[:3], dtype=np.float32), web_output)
    manifest = {
        "source": source.name,
        "resolution_um": WEB_RESOLUTION_UM,
        "slice_counts": counts,
        "mesh": "subject.glb",
    }
    (web_output / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[OK] Ressources web générées : {web_output}", flush=True)


if __name__ == "__main__":
    main()
