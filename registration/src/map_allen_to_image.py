#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


def require_file(path: Path, label: str) -> Path:
    path = path.expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"{label} introuvable: {path}")
    return path


def run(command: list[str]) -> None:
    print("[RUN]", " ".join(command), flush=True)
    subprocess.run(command, check=True)


def same_geometry(first, second, atol: float = 1e-5) -> bool:
    return (
        tuple(first.shape) == tuple(second.shape)
        and np.allclose(first.spacing, second.spacing, atol=atol)
        and np.allclose(first.origin, second.origin, atol=atol)
        and np.allclose(first.direction, second.direction, atol=atol)
    )


def normalized(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float32)
    foreground = values[np.isfinite(values) & (values != 0)]
    if foreground.size == 0:
        return np.zeros(values.shape, dtype=np.float32)
    low, high = np.percentile(foreground, (1, 99))
    if high <= low:
        return np.zeros(values.shape, dtype=np.float32)
    return np.clip((values - low) / (high - low), 0, 1)


def write_qc(fixed, warped_moving, output: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fixed_data = normalized(fixed.numpy())
    moving_data = normalized(warped_moving.numpy())
    centers = [size // 2 for size in fixed_data.shape]
    planes = (
        (fixed_data[centers[0], :, :], moving_data[centers[0], :, :], "Sagittale"),
        (fixed_data[:, centers[1], :], moving_data[:, centers[1], :], "Coronale"),
        (fixed_data[:, :, centers[2]], moving_data[:, :, centers[2]], "Axiale"),
    )

    figure, axes = plt.subplots(1, 3, figsize=(12, 4), facecolor="#111713")
    for axis, (fixed_slice, moving_slice, title) in zip(axes, planes):
        fixed_slice = np.rot90(fixed_slice)
        moving_slice = np.rot90(moving_slice)
        rgb = np.zeros((*fixed_slice.shape, 3), dtype=np.float32)
        rgb[..., 0] = moving_slice
        rgb[..., 1] = fixed_slice
        rgb[..., 2] = moving_slice
        axis.imshow(rgb)
        axis.set_title(f"{title}\nAllen: vert | souris: magenta", color="white", fontsize=10)
        axis.axis("off")
    figure.tight_layout()
    figure.savefig(output, dpi=160, facecolor=figure.get_facecolor())
    plt.close(figure)


def copy_transform_list(
    paths: list[str], destination: Path, direction: str
) -> list[str]:
    copied: list[str] = []
    for index, source_name in enumerate(paths):
        source = require_file(Path(source_name), f"Transformation {direction}")
        target = destination / f"{direction}_{index:02d}_{source.name}"
        shutil.copy2(source, target)
        copied.append(str(target.relative_to(destination.parent)))
    return copied


def image_geometry(image) -> dict[str, object]:
    return {
        "shape": [int(value) for value in image.shape],
        "spacing_mm": [float(value) for value in image.spacing],
        "origin_mm": [float(value) for value in image.origin],
        "direction": np.asarray(image.direction, dtype=float).tolist(),
    }


def encode_labels(labels_path: Path, geometry_image):
    import ants
    import nibabel as nib

    official = np.asarray(nib.load(str(labels_path)).dataobj, dtype=np.uint32)
    if official.shape != tuple(geometry_image.shape):
        raise ValueError("La matrice des labels ne correspond pas au gabarit Allen")
    lookup = np.unique(official)
    dense = np.searchsorted(lookup, official).astype(np.uint16)
    encoded = ants.from_numpy(
        dense,
        origin=geometry_image.origin,
        spacing=geometry_image.spacing,
        direction=geometry_image.direction,
    )
    return encoded, lookup


def decode_labels(encoded_image, lookup: np.ndarray, geometry_image):
    import ants

    dense = np.rint(encoded_image.numpy()).astype(np.int64)
    if dense.min() < 0 or dense.max() >= len(lookup):
        raise ValueError("Les labels recalés contiennent un indice interne inconnu")
    official = lookup[dense].astype(np.uint32)
    return ants.from_numpy(
        official,
        origin=geometry_image.origin,
        spacing=geometry_image.spacing,
        direction=geometry_image.direction,
    )


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Recalage SyN d'une image anatomique de souris vers Allen CCF 2017."
    )
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--template",
        type=Path,
        default=root / "resources" / "registration_allen_ccf2017_100um.nii.gz",
    )
    parser.add_argument(
        "--labels",
        type=Path,
        default=root
        / "resources"
        / "registration_allen_ccf2017_annotation_100um.nii.gz",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=root / "resources" / "antsxnet",
    )
    parser.add_argument(
        "--brain-extracted",
        action="store_true",
        help="L'entrée est déjà extraite du crâne; ignore l'étape ANTsXNet.",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Utilise le préréglage SyN rapide pour un premier contrôle.",
    )
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if args.threads < 1:
        raise ValueError("--threads doit être supérieur ou égal à 1")
    os.environ["ITK_GLOBAL_DEFAULT_NUMBER_OF_THREADS"] = str(args.threads)
    os.environ.setdefault("ANTS_RANDOM_SEED", "1")

    import ants

    input_path = require_file(args.input, "Image d'entrée")
    template_source = require_file(args.template, "Gabarit Allen du site")
    labels_source = require_file(args.labels, "Annotations Allen du site")
    input_image = ants.image_read(str(input_path))
    fixed_image = ants.image_read(str(template_source))
    labels_image = ants.image_read(str(labels_source))
    if input_image.dimension != 3:
        raise ValueError(f"Image d'entrée 3D attendue, reçu {input_image.dimension}D")
    if fixed_image.dimension != 3 or labels_image.dimension != 3:
        raise ValueError("Le gabarit et les annotations Allen doivent être 3D")
    if not same_geometry(fixed_image, labels_image):
        raise ValueError("Le gabarit et les annotations Allen n'ont pas la même grille")

    output = args.output.expanduser().resolve()
    files = {
        "brain": output / "input_brain_extracted.nii.gz",
        "moving_in_atlas": output / "input_in_allen_space.nii.gz",
        "atlas_in_native": output / "allen_template_in_input_space.nii.gz",
        "labels_in_native": output / "allen_labels_in_input_space.nii.gz",
        "qc": output / "registration_qc.png",
        "manifest": output / "registration_manifest.json",
    }
    if not args.force:
        for path in (*files.values(), output / "transforms"):
            if path.exists():
                raise FileExistsError(f"Sortie déjà présente: {path} (utiliser --force)")
    output.mkdir(parents=True, exist_ok=True)
    transforms_output = output / "transforms"
    if transforms_output.exists():
        shutil.rmtree(transforms_output)
    transforms_output.mkdir(parents=True)

    with tempfile.TemporaryDirectory(
        prefix=".gamebrain-registration-", dir=output
    ) as temporary:
        work = Path(temporary)
        brain_temporary = work / files["brain"].name
        if args.brain_extracted:
            shutil.copy2(input_path, brain_temporary)
            moving_image = ants.image_read(str(brain_temporary))
            print("[OK] Extraction cérébrale ignorée")
        else:
            cache = args.cache_dir.expanduser().resolve()
            if not cache.is_dir():
                raise FileNotFoundError(f"Cache ANTsXNet introuvable: {cache}")
            mask_temporary = work / "input_brain_mask.nii.gz"
            run(
                [
                    sys.executable,
                    str(Path(__file__).with_name("extract_mouse_brain.py")),
                    "--input",
                    str(input_path),
                    "--mask-output",
                    str(mask_temporary),
                    "--brain-output",
                    str(brain_temporary),
                    "--cache-dir",
                    str(cache),
                ]
            )
            moving_image = ants.image_read(str(brain_temporary))

        transform_type = (
            "antsRegistrationSyNQuick[s]" if args.quick else "antsRegistrationSyN[s]"
        )
        print(f"[INFO] Recalage {transform_type}: souris -> Allen", flush=True)
        registration = ants.registration(
            fixed=fixed_image,
            moving=moving_image,
            type_of_transform=transform_type,
            outprefix=str(work / "input_to_allen_"),
            random_seed=1,
            singleprecision=True,
            verbose=False,
        )
        print("[OK] Transformation SyN calculée", flush=True)
        warped_moving = registration["warpedmovout"]
        warped_fixed = registration["warpedfixout"]
        dense_labels, label_lookup = encode_labels(labels_source, labels_image)
        native_dense_labels = ants.apply_transforms(
            fixed=moving_image,
            moving=dense_labels,
            transformlist=registration["invtransforms"],
            interpolator="genericLabel",
            singleprecision=True,
        )
        native_labels = decode_labels(
            native_dense_labels, label_lookup, moving_image
        )

        ants.image_write(warped_moving, str(files["moving_in_atlas"]))
        ants.image_write(warped_fixed, str(files["atlas_in_native"]))
        ants.image_write(native_labels, str(files["labels_in_native"]))
        shutil.copy2(brain_temporary, files["brain"])
        forward = copy_transform_list(
            registration["fwdtransforms"], transforms_output, "forward"
        )
        inverse = copy_transform_list(
            registration["invtransforms"], transforms_output, "inverse"
        )
        write_qc(fixed_image, warped_moving, files["qc"])

    run(
        [
            sys.executable,
            str(Path(__file__).with_name("validate_registration_outputs.py")),
            "--native",
            str(files["brain"]),
            "--atlas",
            str(template_source),
            "--moving-in-atlas",
            str(files["moving_in_atlas"]),
            "--atlas-in-native",
            str(files["atlas_in_native"]),
            "--source-labels",
            str(labels_source),
            "--labels-in-native",
            str(files["labels_in_native"]),
        ]
    )

    payload = {
        "pipeline": "gamebrain-allen-syn-v1",
        "input": str(input_path),
        "template": str(template_source),
        "labels": str(labels_source),
        "transform_type": transform_type,
        "threads": args.threads,
        "native_geometry": image_geometry(moving_image),
        "atlas_geometry": image_geometry(fixed_image),
        "outputs": {name: path.name for name, path in files.items() if name != "manifest"},
        "transforms": {"forward": forward, "inverse": inverse},
    }
    files["manifest"].write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    run(
        [
            sys.executable,
            str(Path(__file__).with_name("export_registration_web.py")),
            "--result",
            str(output),
        ]
    )
    run(
        [
            sys.executable,
            str(Path(__file__).with_name("export_native_labels_web.py")),
            "--labels",
            str(files["labels_in_native"]),
            "--output",
            str(output / "native-web"),
        ]
    )
    print(f"[OK] Recalage terminé: {output}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
