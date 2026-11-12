import os
from pathlib import Path, PureWindowsPath


RESOURCES = Path(__file__).resolve().parent.parent / "resources"


def portable_path(path: Path, base: Path) -> str:
    try:
        return Path(os.path.relpath(path.resolve(), base.resolve())).as_posix()
    except ValueError:
        # Different Windows drives cannot be expressed with a relative path.
        return path.resolve().as_posix()


def resolve_atlas_resource(value: str, base: Path) -> Path:
    path = Path(value.replace("\\", "/")).expanduser()
    candidate = path if path.is_absolute() else base / path
    if candidate.is_file():
        return candidate.resolve()
    name = PureWindowsPath(value).name
    bundled_names = {
        "registration_allen_ccf2017_100um.nii.gz",
        "registration_allen_ccf2017_annotation_100um.nii.gz",
        "site_allen_ccf2017_100um.nii.gz",
        "site_allen_ccf2017_annotation_100um.nii.gz",
    }
    if name in bundled_names and (RESOURCES / name).is_file():
        return RESOURCES / name
    raise FileNotFoundError(f"Atlas resource not found: {value}")
