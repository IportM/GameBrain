#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import urllib.request
from pathlib import Path

import nrrd
import numpy as np
from PIL import Image


PLANES = (
    {"name": "coronal", "axis": 0, "transpose": False},
    {"name": "sagittal", "axis": 2, "transpose": True},
    {"name": "axial", "axis": 1, "transpose": False},
)
VOLUMES = ("projection_density", "injection_density", "data_mask")
API_URL = "https://api.brain-map.org/grid_data/download_file/{experiment_id}"
ATLAS_CENTER_MM = np.asarray((7.50001, 3.394489, 5.687737), dtype=np.float32)


def download_volume(
    experiment_id: int,
    image: str,
    resolution: int,
    destination: Path,
) -> None:
    if destination.exists() and destination.stat().st_size > 0:
        print(f"[CACHE] {destination.name}", flush=True)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    url = (
        API_URL.format(experiment_id=experiment_id)
        + f"?image={image}&resolution={resolution}"
    )
    print(f"[INFO] Téléchargement {image} à {resolution} µm", flush=True)
    request = urllib.request.Request(url, headers={"User-Agent": "GameBrain/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            with temporary.open("wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def extract_slice(
    volume: np.ndarray, axis: int, index: int, transpose: bool
) -> np.ndarray:
    result = np.asarray(np.take(volume, index, axis=axis))
    return result.T if transpose else result


def projection_strength(projection: np.ndarray, valid: np.ndarray) -> np.ndarray:
    projection = np.where(valid, np.clip(projection, 0, 1), 0)
    strength = np.log1p(projection * 1000) / np.log1p(1000)
    strength[projection < 1e-4] = 0
    return strength


def injection_strength(injection: np.ndarray, valid: np.ndarray) -> np.ndarray:
    injection = np.where(valid, np.clip(injection, 0, 1), 0)
    strength = np.sqrt(injection)
    strength[injection < 0.01] = 0
    return strength


def projection_rgba(projection: np.ndarray, valid: np.ndarray) -> np.ndarray:
    strength = projection_strength(projection, valid)

    rgba = np.zeros((*projection.shape, 4), dtype=np.uint8)
    rgba[..., 0] = (35 + 205 * strength).astype(np.uint8)
    rgba[..., 1] = (135 + 110 * strength).astype(np.uint8)
    rgba[..., 2] = (150 - 95 * strength).astype(np.uint8)
    rgba[..., 3] = (255 * strength).astype(np.uint8)
    return rgba


def injection_rgba(injection: np.ndarray, valid: np.ndarray) -> np.ndarray:
    strength = injection_strength(injection, valid)

    rgba = np.zeros((*injection.shape, 4), dtype=np.uint8)
    injection_pixels = strength > 0
    rgba[injection_pixels, 0] = 255
    rgba[injection_pixels, 1] = (
        65 + 110 * (1 - strength[injection_pixels])
    ).astype(np.uint8)
    rgba[injection_pixels, 2] = 55
    rgba[injection_pixels, 3] = (255 * strength[injection_pixels]).astype(
        np.uint8
    )
    return rgba


def downsample_strength(
    strength: np.ndarray,
    resolution_um: int,
    target_resolution_um: int = 100,
) -> np.ndarray:
    factor = max(1, target_resolution_um // resolution_um)
    usable_shape = tuple(size - size % factor for size in strength.shape)
    cropped = strength[tuple(slice(0, size) for size in usable_shape)]
    pooled_shape: list[int] = []
    for size in usable_shape:
        pooled_shape.extend((size // factor, factor))
    return cropped.reshape(pooled_shape).max(axis=(1, 3, 5))


def export_point_cloud(
    strength: np.ndarray,
    resolution_um: int,
    output: Path,
    target_resolution_um: int = 100,
) -> int:
    factor = max(1, target_resolution_um // resolution_um)
    pooled = downsample_strength(strength, resolution_um, target_resolution_um)
    indexes = np.argwhere(pooled > 0)
    positions = (
        (indexes.astype(np.float32) * factor + (factor - 1) / 2)
        * (resolution_um / 1000.0)
        - ATLAS_CENTER_MM
    )
    records = np.column_stack((positions, pooled[tuple(indexes.T)])).astype("<f4")
    output.parent.mkdir(parents=True, exist_ok=True)
    records.tofile(output)
    return int(len(records))


def export_volume(
    strength: np.ndarray,
    resolution_um: int,
    output: Path,
    target_resolution_um: int = 100,
) -> tuple[int, int, int]:
    pooled = downsample_strength(strength, resolution_um, target_resolution_um)
    texture_order = np.transpose(np.clip(pooled * 255, 0, 255).astype(np.uint8), (2, 1, 0))
    output.parent.mkdir(parents=True, exist_ok=True)
    texture_order.tofile(output)
    return tuple(int(size) for size in pooled.shape)


def injection_marker(
    strength: np.ndarray,
    resolution_um: int,
) -> tuple[list[float], float]:
    indexes = np.argwhere(strength > 0)
    if len(indexes) == 0:
        return [0.0, 0.0, 0.0], 0.15
    weights = strength[tuple(indexes.T)].astype(np.float64)
    center = np.average(indexes.astype(np.float64), axis=0, weights=weights)
    center_mm = center * (resolution_um / 1000.0) - ATLAS_CENTER_MM
    voxel_volume = (resolution_um / 1000.0) ** 3
    equivalent_radius = ((3 * len(indexes) * voxel_volume) / (4 * np.pi)) ** (1 / 3)
    return [round(float(value), 5) for value in center_mm], round(
        float(np.clip(equivalent_radius, 0.15, 0.5)), 5
    )


def export_overlays(
    projection: np.ndarray,
    injection: np.ndarray,
    valid_mask: np.ndarray,
    output: Path,
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for plane in PLANES:
        name = str(plane["name"])
        axis = int(plane["axis"])
        transpose = bool(plane["transpose"])
        count = int(projection.shape[axis])
        counts[name] = count
        width = max(3, len(str(count - 1)))
        projection_output = output / "overlays" / "projection" / name
        injection_output = output / "overlays" / "injection" / name
        projection_output.mkdir(parents=True, exist_ok=True)
        injection_output.mkdir(parents=True, exist_ok=True)
        for index in range(count):
            projection_slice = extract_slice(projection, axis, index, transpose)
            injection_slice = extract_slice(injection, axis, index, transpose)
            valid_slice = extract_slice(valid_mask, axis, index, transpose)
            for layer_output, rgba in (
                (projection_output, projection_rgba(projection_slice, valid_slice)),
                (injection_output, injection_rgba(injection_slice, valid_slice)),
            ):
                Image.fromarray(rgba, mode="RGBA").save(
                    layer_output / f"{name}-{index:0{width}d}.webp",
                    format="WEBP",
                    lossless=True,
                    method=4,
                )
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Télécharge et prépare une expérience Allen Connectivity."
    )
    parser.add_argument("--experiment-id", type=int, required=True)
    parser.add_argument("--resolution", type=int, choices=(25, 50, 100), default=50)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--annotation-mask",
        type=Path,
        help="Volume d'annotations Allen utilisé pour limiter le signal au cerveau.",
    )
    args = parser.parse_args()
    if args.experiment_id <= 0:
        raise ValueError("L'identifiant d'expérience doit être positif")

    output = args.output.expanduser().resolve()
    raw = output / "raw"
    web = output / "web"
    paths = {
        image: raw / f"{image}_{args.resolution}.nrrd" for image in VOLUMES
    }
    for image, path in paths.items():
        download_volume(args.experiment_id, image, args.resolution, path)

    volumes = {image: np.asarray(nrrd.read(path)[0]) for image, path in paths.items()}
    shapes = {image: volume.shape for image, volume in volumes.items()}
    if len(set(shapes.values())) != 1:
        raise ValueError(f"Grilles Allen incompatibles : {shapes}")
    if volumes["projection_density"].ndim != 3:
        raise ValueError("Le volume de projection Allen doit être 3D")

    project_root = Path(__file__).resolve().parents[2]
    annotation_path = args.annotation_mask or (
        project_root
        / "data-source"
        / "allen-multires"
        / f"annotation_{args.resolution}.nrrd"
    )
    annotation_path = annotation_path.expanduser().resolve()
    if not annotation_path.is_file():
        raise ValueError(
            f"Masque anatomique Allen introuvable pour {args.resolution} µm : "
            f"{annotation_path}"
        )
    annotation = np.asarray(nrrd.read(annotation_path)[0])
    if annotation.shape != volumes["projection_density"].shape:
        raise ValueError(
            "Grille du masque anatomique incompatible : "
            f"signal {volumes['projection_density'].shape}, "
            f"annotations {annotation.shape}"
        )
    valid_mask = (volumes["data_mask"] > 0) & (annotation > 0)

    counts = export_overlays(
        volumes["projection_density"].astype(np.float32, copy=False),
        volumes["injection_density"].astype(np.float32, copy=False),
        valid_mask,
        web,
    )
    point_clouds = {
        "projection": {
            "path": "point-clouds/projection.bin",
            "count": export_point_cloud(
                projection_strength(volumes["projection_density"], valid_mask),
                args.resolution,
                web / "point-clouds" / "projection.bin",
            ),
        },
        "injection": {
            "path": "point-clouds/injection.bin",
            "count": export_point_cloud(
                injection_strength(volumes["injection_density"], valid_mask),
                args.resolution,
                web / "point-clouds" / "injection.bin",
            ),
        },
    }
    projection_volume = export_volume(
        projection_strength(volumes["projection_density"], valid_mask),
        args.resolution,
        web / "volumes" / "projection.bin",
    )
    injection_volume = export_volume(
        injection_strength(volumes["injection_density"], valid_mask),
        args.resolution,
        web / "volumes" / "injection.bin",
    )
    if projection_volume != injection_volume:
        raise ValueError("Les volumes 3D de connectivité ont des dimensions incompatibles")
    marker_center, marker_radius = injection_marker(
        injection_strength(volumes["injection_density"], valid_mask),
        args.resolution,
    )
    manifest = {
        "experiment_id": args.experiment_id,
        "resolution_um": args.resolution,
        "shape": list(volumes["projection_density"].shape),
        "slice_counts": counts,
        "projection_color": "yellow-green",
        "injection_color": "orange-red",
        "overlay_layers": ["projection", "injection"],
        "point_cloud_resolution_um": max(100, args.resolution),
        "point_clouds": point_clouds,
        "volume_resolution_um": max(100, args.resolution),
        "volume_shape": list(projection_volume),
        "volumes_3d": {
            "projection": "volumes/projection.bin",
            "injection": "volumes/injection.bin",
        },
        "injection_marker": {
            "center_mm": marker_center,
            "radius_mm": marker_radius,
        },
        "anatomical_mask": str(annotation_path),
        "volumes": {image: str(path.relative_to(output)) for image, path in paths.items()},
    }
    web.mkdir(parents=True, exist_ok=True)
    (web / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"[OK] Expérience Allen {args.experiment_id} prête : {web}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        print(f"[ERROR] {error}", flush=True)
        raise SystemExit(1)
