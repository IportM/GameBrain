#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys

import nibabel as nib
import numpy as np


def load_3d(path: str) -> nib.Nifti1Image:
    image = nib.load(path)
    if len(image.shape) != 3:
        raise ValueError(f"Image 3D attendue: {path}")
    return image


def require_same_grid(reference, image, label: str) -> None:
    if image.shape != reference.shape or not np.allclose(
        image.affine, reference.affine, atol=1e-4
    ):
        raise ValueError(f"{label}: grille différente de la référence")


def main() -> None:
    parser = argparse.ArgumentParser(description="Valide un recalage SyN souris/Allen.")
    parser.add_argument("--native", required=True)
    parser.add_argument("--atlas", required=True)
    parser.add_argument("--moving-in-atlas", required=True)
    parser.add_argument("--atlas-in-native", required=True)
    parser.add_argument("--source-labels", required=True)
    parser.add_argument("--labels-in-native", required=True)
    args = parser.parse_args()

    native = load_3d(args.native)
    atlas = load_3d(args.atlas)
    moving_in_atlas = load_3d(args.moving_in_atlas)
    atlas_in_native = load_3d(args.atlas_in_native)
    source_labels = load_3d(args.source_labels)
    labels_in_native = load_3d(args.labels_in_native)

    require_same_grid(atlas, moving_in_atlas, "Souris dans Allen")
    require_same_grid(native, atlas_in_native, "Allen dans l'espace natif")
    require_same_grid(native, labels_in_native, "Labels dans l'espace natif")
    require_same_grid(atlas, source_labels, "Labels Allen sources")

    values = np.asarray(labels_in_native.dataobj)
    if not np.all(np.isfinite(values)) or not np.allclose(
        values, np.rint(values), atol=1e-5
    ):
        raise ValueError("Les labels projetés ne sont pas des entiers finis")
    source_ids = set(np.unique(np.asarray(source_labels.dataobj)).astype(np.int64))
    output_ids = set(np.unique(np.rint(values).astype(np.int64)))
    if not output_ids.issubset(source_ids):
        raise ValueError("Les labels projetés contiennent un identifiant inconnu")
    if len(output_ids - {0}) < 2:
        raise ValueError("Trop peu de régions Allen sont présentes après recalage")
    print(
        f"[OK] Grilles validées; {len(output_ids - {0})} régions présentes dans la souris"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
