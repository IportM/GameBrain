import argparse
import importlib.util
import subprocess
import sys
from pathlib import Path


def require_module(name: str) -> None:
    if importlib.util.find_spec(name) is None:
        raise RuntimeError(
            f"Dépendance Python manquante : {name}. "
            "Installez registration/requirements-extraction.txt dans .venv-registration."
        )


def run_stage(label: str, command: list[str]) -> None:
    print(label, flush=True)
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f"{label} a échoué (code {error.returncode}).") from error


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extrait le cerveau et prépare un NIfTI natif pour le visualiseur"
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    require_module("ants")
    require_module("antspynet")
    require_module("tensorflow")

    source_dir = Path(__file__).resolve().parent
    registration_dir = source_dir.parent
    output = args.output.resolve()
    work = output.parent / "extraction"
    work.mkdir(parents=True, exist_ok=True)
    mask = work / "brain_mask.nii.gz"
    brain = work / "brain_extracted.nii.gz"

    run_stage(
        "Extraction du cerveau",
        [
            sys.executable,
            str(source_dir / "extract_mouse_brain.py"),
            "--input",
            str(args.input.resolve()),
            "--mask-output",
            str(mask),
            "--brain-output",
            str(brain),
            "--cache-dir",
            str(registration_dir / "resources" / "antsxnet"),
        ],
    )
    run_stage(
        "Préparation des coupes et du modèle 3D",
        [
            sys.executable,
            str(source_dir / "export_import_web.py"),
            "--input",
            str(args.input.resolve()),
            "--mask",
            str(mask),
            "--output",
            str(output),
        ],
    )


if __name__ == "__main__":
    main()
