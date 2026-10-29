#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import ants
import nrrd
import numpy as np

from prepare_connectivity_experiment import (
    export_overlays,
    injection_strength,
    projection_strength,
)


def registration_grid(data: np.ndarray, step: int) -> np.ndarray:
    sampled = np.asarray(data[::step, ::step, ::step], dtype=np.float32)
    return np.flip(np.transpose(sampled, (2, 0, 1)), axis=(1, 2)).copy()


def display_grid(data: np.ndarray) -> np.ndarray:
    return np.flip(np.transpose(data, (1, 2, 0)), axis=(0, 1)).copy()


def export_volume(strength: np.ndarray, output: Path) -> list[int]:
    texture_order = np.transpose(
        np.clip(strength * 255, 0, 255).astype(np.uint8), (2, 1, 0)
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    texture_order.tofile(output)
    return [int(size) for size in strength.shape]


def native_injection_marker(
    strength: np.ndarray, spacing_mm: np.ndarray
) -> tuple[list[float], float]:
    indexes = np.argwhere(strength > 0)
    if len(indexes) == 0:
        return [0.0, 0.0, 0.0], 0.15
    weights = strength[tuple(indexes.T)].astype(np.float64)
    center = np.average(indexes.astype(np.float64), axis=0, weights=weights)
    volume_center = (np.asarray(strength.shape) - 1) * spacing_mm / 2
    center_mm = center * spacing_mm - volume_center
    equivalent_radius = (
        3 * len(indexes) * float(np.prod(spacing_mm)) / (4 * np.pi)
    ) ** (1 / 3)
    return [round(float(value), 5) for value in center_mm], round(
        float(np.clip(equivalent_radius, 0.15, 0.5)), 5
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Projette une expérience de connectivité Allen dans une image recalée."
    )
    parser.add_argument("--registration", required=True, type=Path)
    parser.add_argument("--connectivity", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    registration = args.registration.expanduser().resolve()
    connectivity = args.connectivity.expanduser().resolve()
    output = args.output.expanduser().resolve()
    registration_manifest = json.loads(
        (registration / "registration_manifest.json").read_text(encoding="utf-8")
    )
    connectivity_manifest = json.loads(
        (connectivity / "web" / "manifest.json").read_text(encoding="utf-8")
    )
    source_resolution = int(connectivity_manifest["resolution_um"])
    target_resolution = int(round(registration_manifest["atlas_geometry"]["spacing_mm"][0] * 1000))
    if target_resolution % source_resolution:
        raise ValueError("Résolutions Allen incompatibles pour la projection native")
    step = target_resolution // source_resolution

    fixed_atlas = ants.image_read(registration_manifest["template"])
    native_reference = ants.image_read(str(registration / registration_manifest["outputs"]["brain"]))
    inverse_transforms = [
        str(registration / path) for path in registration_manifest["transforms"]["inverse"]
    ]
    native_volumes: dict[str, np.ndarray] = {}
    output.mkdir(parents=True, exist_ok=True)
    for name in ("projection_density", "injection_density", "data_mask"):
        source_path = connectivity / connectivity_manifest["volumes"][name]
        source = registration_grid(np.asarray(nrrd.read(source_path)[0]), step)
        if tuple(source.shape) != tuple(fixed_atlas.shape):
            raise ValueError(
                f"Grille {name} incompatible : {source.shape} au lieu de {fixed_atlas.shape}"
            )
        moving = ants.from_numpy(
            source,
            origin=fixed_atlas.origin,
            spacing=fixed_atlas.spacing,
            direction=fixed_atlas.direction,
        )
        warped = ants.apply_transforms(
            fixed=native_reference,
            moving=moving,
            transformlist=inverse_transforms,
            interpolator="nearestNeighbor" if name == "data_mask" else "linear",
            singleprecision=True,
        )
        ants.image_write(warped, str(output / f"{name}_in_native_space.nii.gz"))
        native_volumes[name] = np.asarray(warped.numpy(), dtype=np.float32)

    brain_support = np.asarray(native_reference.numpy()) != 0
    valid = (native_volumes["data_mask"] > 0.5) & brain_support
    web = output / "web"
    projection = display_grid(native_volumes["projection_density"])
    injection = display_grid(native_volumes["injection_density"])
    display_valid = display_grid(valid)
    counts = export_overlays(projection, injection, display_valid, web)
    projection_signal = projection_strength(projection, display_valid)
    injection_signal = injection_strength(injection, display_valid)
    volume_shape = export_volume(projection_signal, web / "volumes" / "projection.bin")
    export_volume(injection_signal, web / "volumes" / "injection.bin")
    native_spacing = np.asarray(native_reference.spacing, dtype=np.float64)
    display_spacing = native_spacing[[1, 2, 0]]
    marker_center, marker_radius = native_injection_marker(
        injection_signal, display_spacing
    )
    manifest = {
        "experiment_id": int(connectivity_manifest["experiment_id"]),
        "space": "native",
        "slice_counts": counts,
        "volume_shape": volume_shape,
        "volume_spacing_mm": [float(value) for value in display_spacing],
        "volumes_3d": {
            "projection": "volumes/projection.bin",
            "injection": "volumes/injection.bin",
        },
        "injection_marker": {
            "center_mm": marker_center,
            "radius_mm": marker_radius,
        },
        "registration": str(registration),
    }
    web.mkdir(parents=True, exist_ok=True)
    (web / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print("[OK] Connectivité projetée dans l'espace natif", flush=True)


if __name__ == "__main__":
    main()
