import argparse
import json
from pathlib import Path

import nibabel as nib
from nibabel.processing import resample_from_to
import numpy as np
from PIL import Image


PLANES = {
    "coronal": {"axis": 0, "transpose": False},
    "sagittal": {"axis": 2, "transpose": True},
    "axial": {"axis": 1, "transpose": False},
}


def plane_slice(volume: np.ndarray, plane: str, index: int) -> np.ndarray:
    image = np.take(volume, index, axis=int(PLANES[plane]["axis"]))
    result = np.asarray(image).T if PLANES[plane]["transpose"] else np.asarray(image)
    return np.fliplr(result) if plane == "sagittal" else result


def export_slices(
    volume: np.ndarray,
    mask: np.ndarray,
    low: float,
    high: float,
    output: Path,
) -> dict[str, int]:
    display = np.flip(np.transpose(volume, (1, 2, 0)), axis=(0, 1))
    display_mask = np.flip(np.transpose(mask, (1, 2, 0)), axis=(0, 1))
    counts: dict[str, int] = {}
    for plane, definition in PLANES.items():
        count = int(display.shape[int(definition["axis"])])
        counts[plane] = count
        width = max(3, len(str(count - 1)))
        target = output / "slices" / plane
        masked_target = output / "slices-masked" / plane
        target.mkdir(parents=True, exist_ok=True)
        masked_target.mkdir(parents=True, exist_ok=True)
        for index in range(count):
            image = plane_slice(display, plane, index)
            image_mask = plane_slice(display_mask, plane, index)
            normalized = np.clip((image - low) / max(high - low, 1e-12), 0, 1)
            gray = np.where(np.isfinite(normalized), normalized * 255, 0).astype(np.uint8)
            Image.fromarray(gray, mode="L").save(
                target / f"{plane}-{index:0{width}d}.webp",
                format="WEBP",
                quality=90,
                method=4,
            )
            rgba = np.dstack((gray, gray, gray, np.where(image_mask, 255, 0).astype(np.uint8)))
            Image.fromarray(rgba, mode="RGBA").save(
                masked_target / f"{plane}-{index:0{width}d}.webp",
                format="WEBP",
                lossless=True,
                method=4,
            )
    return counts


def load_scalar(path: Path) -> nib.Nifti1Image:
    image = nib.load(path.resolve())
    if len(image.shape) == 4 and image.shape[3] == 1:
        data = np.asarray(image.dataobj[..., 0])
        image = nib.Nifti1Image(data, image.affine, image.header)
    if len(image.shape) != 3:
        raise ValueError(f"Volume NIfTI 3D attendu, dimensions reçues : {image.shape}")
    if not np.all(np.isfinite(image.affine)) or abs(np.linalg.det(image.affine[:3, :3])) < 1e-9:
        raise ValueError("Géométrie NIfTI invalide ou singulière")
    return image


def world_bounds(image: nib.Nifti1Image) -> tuple[np.ndarray, np.ndarray]:
    upper = np.asarray(image.shape[:3], dtype=np.float64) - 1
    corners = np.asarray([
        (x, y, z)
        for x in (0, upper[0])
        for y in (0, upper[1])
        for z in (0, upper[2])
    ])
    world = nib.affines.apply_affine(image.affine, corners)
    return world.min(axis=0), world.max(axis=0)


def geometries_overlap(first: nib.Nifti1Image, second: nib.Nifti1Image) -> bool:
    first_min, first_max = world_bounds(first)
    second_min, second_max = world_bounds(second)
    overlap = np.minimum(first_max, second_max) - np.maximum(first_min, second_min)
    return bool(np.all(overlap > 0))


def main() -> None:
    parser = argparse.ArgumentParser(description="Valide une modalité par rapport à la RARE")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--mask", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--source-name", required=True)
    args = parser.parse_args()

    source = load_scalar(args.input)
    reference = load_scalar(args.reference)
    mask_image = load_scalar(args.mask)
    same_grid = source.shape == reference.shape and np.allclose(
        source.affine, reference.affine, rtol=1e-5, atol=1e-4
    )
    if not same_grid and not geometries_overlap(source, reference):
        raise ValueError("La modalité ne chevauche pas l'espace physique de la RARE")

    args.output.mkdir(parents=True, exist_ok=True)
    if same_grid:
        prepared = source
        geometry_status = "compatible"
    else:
        prepared = resample_from_to(
            source,
            (reference.shape, reference.affine),
            order=1,
        )
        geometry_status = "resampled"

    prepared_path = args.output / "prepared.nii.gz"
    nib.save(prepared, prepared_path)
    data = np.asarray(prepared.dataobj, dtype=np.float32)
    prepared_mask = resample_from_to(
        mask_image,
        (reference.shape, reference.affine),
        order=0,
    )
    mask = np.asarray(prepared_mask.dataobj) > 0.5
    if not np.any(mask):
        raise ValueError("Le masque cérébral ne chevauche pas la modalité")
    finite = data[np.isfinite(data)]
    if finite.size == 0:
        raise ValueError("La modalité ne contient aucune valeur finie")
    brain_values = data[mask & np.isfinite(data)]
    brain_nonzero = brain_values[brain_values != 0]
    nonzero = finite[finite != 0]
    measured = brain_nonzero if brain_nonzero.size else brain_values
    if measured.size == 0:
        raise ValueError("Aucune valeur exploitable dans le masque cérébral")
    low = float(np.percentile(measured, 1))
    high = float(np.percentile(measured, 99))
    slice_counts = export_slices(data, mask, low, high, args.output)
    display_volume = np.flip(np.transpose(data, (1, 2, 0)), axis=(0, 1))
    display_mask = np.flip(np.transpose(mask, (1, 2, 0)), axis=(0, 1))
    np.asarray(display_volume, dtype="<f4").tofile(args.output / "volume.float32")
    np.asarray(display_mask, dtype=np.uint8).tofile(args.output / "brain-mask.uint8")
    manifest = {
        "name": args.name,
        "source_file": args.source_name,
        "geometry_status": geometry_status,
        "shape": [int(value) for value in prepared.shape],
        "spacing_mm": [float(value) for value in prepared.header.get_zooms()[:3]],
        "source_shape": [int(value) for value in source.shape],
        "source_spacing_mm": [float(value) for value in source.header.get_zooms()[:3]],
        "finite_voxels": int(finite.size),
        "nonzero_voxels": int(nonzero.size),
        "value_range": [float(np.min(measured)), float(np.max(measured))],
        "percentiles": [
            low,
            high,
        ],
        "slice_counts": slice_counts,
        "volume_shape": [int(value) for value in display_volume.shape],
        "prepared_file": prepared_path.name,
    }
    (args.output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
