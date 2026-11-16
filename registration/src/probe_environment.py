"""Machine-readable, read-only dependency check for the local web server."""
import importlib
import importlib.util
import json
from pathlib import Path
import sys
from runtime_support import runtime_support

PACKAGES = (
    ("numpy", "numpy"), ("scipy.ndimage", "scipy"), ("nibabel", "nibabel"),
    ("nrrd", "pynrrd"), ("PIL.Image", "Pillow"), ("skimage.measure", "scikit-image"),
    ("trimesh", "trimesh"), ("matplotlib", "matplotlib"), ("ants", "antspyx"),
    ("tensorflow", "tensorflow"), ("antspynet", "antspynet"),
)


def probe(verify=False):
    checks = []
    for module, package in PACKAGES:
        entry = {"module": module, "package": package, "status": "available"}
        try:
            if importlib.util.find_spec(module.split(".")[0]) is None:
                entry["status"] = "missing"
            elif verify:
                importlib.import_module(module)
        except Exception as error:
            entry.update(status="broken", error=str(error)[-500:])
        checks.append(entry)
    resources = Path(__file__).resolve().parent.parent / "resources"
    required = [
        "structures.json", "annotation_50.nrrd", "registration_allen_ccf2017_100um.nii.gz",
        "registration_allen_ccf2017_annotation_100um.nii.gz", "site_allen_ccf2017_100um.nii.gz",
        "site_allen_ccf2017_annotation_100um.nii.gz", "antsxnet/bsplineT2MouseTemplate.nii.gz",
        "antsxnet/bsplineT2MouseTemplateBrainMask.nii.gz", "antsxnet/mouseT2wBrainExtraction3D.h5",
    ]
    return {
        "python": sys.executable, "version": sys.version.split()[0],
        **runtime_support(),
        "checks": checks, "verified": verify,
        "resourcesMissing": [name for name in required if not (resources / name).is_file() or (resources / name).stat().st_size == 0],
    }


if __name__ == "__main__":
    print("GAMEBRAIN_ENV=" + json.dumps(probe("--verify" in sys.argv)), flush=True)
