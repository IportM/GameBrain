"""Register another session's RARE to the existing reference, without replacing it."""
import argparse
import json
import os
from pathlib import Path
from task_progress import report_progress
import shutil
import subprocess
import sys
import tempfile

import nibabel as nib
import numpy as np

from prepare_modality_import import load_scalar, geometries_overlap


def session_transform_paths(session: Path) -> list[str]:
    manifest = json.loads((session / "manifest.json").read_text(encoding="utf-8"))
    transforms = []
    for name in manifest["forward_transforms"]:
        path = (session / name).resolve()
        if path.parent != session.resolve() or not path.is_file():
            raise ValueError("Invalid session transform")
        transforms.append(str(path))
    if not transforms:
        raise ValueError("Missing session transform")
    return transforms


def apply_session_transform(source: Path, reference: Path, session: Path, output: Path) -> None:
    import ants

    image = load_scalar(source)
    session_rare = load_scalar(session / "rare.nii.gz")
    if not geometries_overlap(image, session_rare):
        raise ValueError("La modalite ne chevauche pas la RARE de sa session")
    # The caller confirms that modality and session RARE are anatomically aligned.
    with tempfile.TemporaryDirectory(dir=output.parent) as directory:
        scalar = Path(directory) / "scalar.nii.gz"
        nib.save(image, scalar)
        warped = ants.apply_transforms(
            fixed=ants.image_read(str(reference)), moving=ants.image_read(str(scalar)),
            transformlist=session_transform_paths(session), interpolator="linear",
        )
        ants.image_write(warped, str(output))
    result = load_scalar(output)
    fixed = load_scalar(reference)
    if result.shape != fixed.shape or not np.allclose(result.affine, fixed.affine, atol=1e-4):
        raise ValueError("La modalite recalee ne correspond pas a la grille de reference")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--reference-brain", type=Path, required=True)
    parser.add_argument("--mask", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--preview", type=Path, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--source-name", required=True)
    args = parser.parse_args()
    os.environ.setdefault("ITK_GLOBAL_DEFAULT_NUMBER_OF_THREADS", "4")
    import ants

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    nib.save(load_scalar(args.input), output / "rare.nii.gz")
    scripts = Path(__file__).resolve().parent
    print("Extraction du cerveau de la nouvelle session", flush=True)
    report_progress("Extraction du cerveau")
    subprocess.run([
        sys.executable, str(scripts / "extract_mouse_brain.py"),
        "--input", str(output / "rare.nii.gz"), "--mask-output", str(output / "brain_mask.nii.gz"),
        "--brain-output", str(output / "brain.nii.gz"),
        "--cache-dir", str(scripts.parent / "resources" / "antsxnet"),
    ], check=True)
    print("Recalage rigide RARE de session vers RARE de reference", flush=True)
    report_progress("Recalage de la session")
    with tempfile.TemporaryDirectory(dir=output) as directory:
        registration = ants.registration(
            fixed=ants.image_read(str(args.reference_brain)),
            moving=ants.image_read(str(output / "brain.nii.gz")),
            type_of_transform="Rigid", outprefix=str(Path(directory) / "rigid_"),
            random_seed=42, verbose=False,
        )
        transforms = []
        for index, source in enumerate(registration["fwdtransforms"]):
            name = f"forward_{index:02d}{Path(source).suffix}"
            shutil.copy2(source, output / name)
            transforms.append(name)
    manifest = {
        "name": args.name, "source_file": args.source_name,
        "transform_type": "Rigid", "forward_transforms": transforms,
        "preview_modality_id": args.preview.name,
        "reference_file": args.reference.name,
        "reference_shape": list(load_scalar(args.reference).shape),
        "reference_affine": load_scalar(args.reference).affine.tolist(),
    }
    # The ready marker is published only after the transformed RARE preview is usable.
    temporary = output / "manifest.json"
    temporary.write_text(json.dumps(manifest), encoding="utf-8")
    try:
        subprocess.run([
            sys.executable, str(scripts / "prepare_modality_import.py"),
            "--input", str(output / "rare.nii.gz"), "--reference", str(args.reference),
            "--mask", str(args.mask), "--output", str(args.preview),
            "--name", f"RARE - {args.name}", "--source-name", args.source_name,
            "--session-dir", str(output),
        ], check=True)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    print("Session recalee. Verifiez sa RARE dans Comparer avant d'importer ses modalites.", flush=True)


if __name__ == "__main__":
    main()
