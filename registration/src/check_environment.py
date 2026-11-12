import hashlib
import importlib
import json
from pathlib import Path
import sys


def main() -> None:
    resources = Path(__file__).resolve().parent.parent / "resources"
    required = [
        "structures.json",
        "annotation_50.nrrd",
        "registration_allen_ccf2017_100um.nii.gz",
        "registration_allen_ccf2017_annotation_100um.nii.gz",
        "site_allen_ccf2017_100um.nii.gz",
        "site_allen_ccf2017_annotation_100um.nii.gz",
    ]
    for name in required:
        path = resources / name
        if not path.is_file() or path.stat().st_size == 0:
            raise FileNotFoundError(f"Bundled resource missing: {path}")
    checksums = (resources / "antsxnet" / "SHA256SUMS").read_text(encoding="utf-8")
    checksums += (
        "\n84e7cecea1b03af16e923c3639602b8324929f833425ba03582bf56f962ea0d4  ../annotation_50.nrrd"
        "\n7157e6130b354f6bebc21aa79f882274cbbe253ac916d97123805af3b4ff8abd  ../structures.json"
    )
    for line in checksums.splitlines():
        if not line.strip():
            continue
        expected, name = line.split(maxsplit=1)
        path = resources / "antsxnet" / name
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != expected:
            raise ValueError(f"Resource checksum mismatch: {path}")
    structures = json.loads((resources / "structures.json").read_text(encoding="utf-8"))
    if not any(structure["id"] == 997 for structure in structures):
        raise ValueError("Allen structure catalogue is invalid")
    print("[OK] Allen resources and extraction models", flush=True)
    if "--resources-only" in sys.argv:
        return
    for module in (
        "numpy", "scipy", "nibabel", "nrrd", "PIL.Image", "skimage.measure",
        "trimesh", "matplotlib", "ants", "tensorflow", "antspynet",
    ):
        importlib.import_module(module)
        print(f"[OK] {module}", flush=True)


if __name__ == "__main__":
    main()
