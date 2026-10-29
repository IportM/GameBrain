#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import nibabel as nib
import nrrd
import numpy as np


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def save_nifti(data: np.ndarray, spacing_mm: float, output: Path) -> None:
    # NRRD décrit le CCF en LPS. NIfTI stocke son affine en coordonnées RAS.
    affine = np.diag((-spacing_mm, -spacing_mm, spacing_mm, 1.0))
    image = nib.Nifti1Image(data, affine)
    image.header.set_xyzt_units("mm")
    image.set_qform(affine, code=1)
    image.set_sform(affine, code=1)
    nib.save(image, output)


def save_registration_nifti(
    data: np.ndarray, spacing_mm: float, output: Path
) -> None:
    # Reprend exactement l'ordre des axes et la géométrie RAS de 100_AMBA_ref.
    registration_data = np.flip(
        np.transpose(data, (2, 0, 1)), axis=(1, 2)
    ).copy()
    affine = np.diag((spacing_mm, spacing_mm, spacing_mm, 1.0))
    image = nib.Nifti1Image(registration_data, affine)
    image.header.set_xyzt_units("mm")
    image.set_qform(affine, code=1)
    image.set_sform(affine, code=1)
    nib.save(image, output)


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    registration_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Prépare le CCF Allen du site au format NIfTI pour ANTs."
    )
    parser.add_argument(
        "--template-nrrd",
        type=Path,
        default=root / "data-source" / "allen-multires" / "average_template_50.nrrd",
    )
    parser.add_argument(
        "--annotation-nrrd",
        type=Path,
        default=root / "data-source" / "allen-multires" / "annotation_50.nrrd",
    )
    parser.add_argument("--resolution-um", type=int, default=100)
    parser.add_argument(
        "--output-dir", type=Path, default=registration_root / "resources"
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    template_path = args.template_nrrd.expanduser().resolve()
    annotation_path = args.annotation_nrrd.expanduser().resolve()
    for path, label in (
        (template_path, "Gabarit NRRD"),
        (annotation_path, "Annotations NRRD"),
    ):
        if not path.is_file():
            raise FileNotFoundError(f"{label} introuvable: {path}")

    template, header = nrrd.read(template_path)
    annotation, annotation_header = nrrd.read(annotation_path)
    if template.shape != annotation.shape:
        raise ValueError("Le gabarit et les annotations NRRD ont des dimensions différentes")
    directions = np.asarray(header["space directions"], dtype=float)
    annotation_directions = np.asarray(
        annotation_header["space directions"], dtype=float
    )
    if not np.allclose(directions, annotation_directions):
        raise ValueError("Le gabarit et les annotations NRRD ont des espacements différents")
    source_spacing_um = float(np.linalg.norm(directions[0]))
    if not np.allclose(np.linalg.norm(directions, axis=1), source_spacing_um):
        raise ValueError("Le gabarit Allen doit avoir des voxels isotropes")
    factor = args.resolution_um / source_spacing_um
    if factor < 1 or not np.isclose(factor, round(factor)):
        raise ValueError(
            "La résolution demandée doit être un multiple entier de la résolution source"
        )
    step = int(round(factor))
    template = np.asarray(template[::step, ::step, ::step], dtype=np.uint16)
    annotation = np.asarray(annotation[::step, ::step, ::step], dtype=np.uint32)

    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    template_output = output_dir / f"site_allen_ccf2017_{args.resolution_um}um.nii.gz"
    annotation_output = (
        output_dir / f"site_allen_ccf2017_annotation_{args.resolution_um}um.nii.gz"
    )
    registration_template_output = (
        output_dir / f"registration_allen_ccf2017_{args.resolution_um}um.nii.gz"
    )
    registration_annotation_output = output_dir / (
        f"registration_allen_ccf2017_annotation_{args.resolution_um}um.nii.gz"
    )
    manifest_output = output_dir / f"site_allen_ccf2017_{args.resolution_um}um.json"
    if not args.force:
        for path in (
            template_output,
            annotation_output,
            registration_template_output,
            registration_annotation_output,
            manifest_output,
        ):
            if path.exists():
                raise FileExistsError(f"Sortie déjà présente: {path} (utiliser --force)")

    spacing_mm = args.resolution_um / 1000.0
    save_nifti(template, spacing_mm, template_output)
    save_nifti(annotation, spacing_mm, annotation_output)
    save_registration_nifti(template, spacing_mm, registration_template_output)
    save_registration_nifti(annotation, spacing_mm, registration_annotation_output)
    manifest = {
        "atlas": "Allen Mouse Brain CCF 2017",
        "resolution_um": args.resolution_um,
        "shape": list(template.shape),
        "orientation": "LPS stored through a NIfTI RAS affine",
        "template_source": str(template_path),
        "template_sha256": sha256(template_path),
        "annotation_source": str(annotation_path),
        "annotation_sha256": sha256(annotation_path),
        "template": template_output.name,
        "annotation": annotation_output.name,
        "registration_orientation": "RAS, identical to the FC3R 100_AMBA_ref geometry",
        "registration_template": registration_template_output.name,
        "registration_annotation": registration_annotation_output.name,
    }
    manifest_output.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[OK] Gabarit Allen: {template_output}")
    print(f"[OK] Annotations Allen: {annotation_output}")
    print(f"[OK] Gabarit de recalage: {registration_template_output}")
    print(f"[OK] Annotations de recalage: {registration_annotation_output}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
