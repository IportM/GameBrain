import argparse
import json
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image


ROOT = Path(__file__).resolve().parent
ATLAS_DIR = ROOT / "data-source" / "brainglobe" / "allen_mouse_25um_v1.2"
OUTPUT_DIR = ROOT / "web" / "public" / "atlas"
PLANES = (
    {"name": "coronal", "axis": 0, "transpose": False},
    {"name": "sagittal", "axis": 2, "transpose": True},
    {"name": "axial", "axis": 1, "transpose": False},
)


def extract_slice(volume: np.ndarray, axis: int, index: int, transpose: bool) -> np.ndarray:
    result = np.asarray(np.take(volume, index, axis=axis))
    return result.T if transpose else result


def encode_label_values(annotation_slice: np.ndarray, labels: np.ndarray) -> np.ndarray:
    positions = np.searchsorted(labels, annotation_slice)
    valid = positions < len(labels)
    safe = np.minimum(positions, len(labels) - 1)
    matches = valid & (labels[safe] == annotation_slice)
    encoded = np.zeros(annotation_slice.shape, dtype=np.uint32)
    encoded[matches] = safe[matches] + 1
    return encoded


def encode_rgb(values: np.ndarray) -> np.ndarray:
    encoded = np.zeros((*values.shape, 3), dtype=np.uint8)
    encoded[..., 0] = values & 255
    encoded[..., 1] = (values >> 8) & 255
    encoded[..., 2] = (values >> 16) & 255
    return encoded


def label_boundaries(labels: np.ndarray) -> np.ndarray:
    interior = labels > 0
    interior[1:, :] &= labels[1:, :] == labels[:-1, :]
    interior[:-1, :] &= labels[:-1, :] == labels[1:, :]
    interior[:, 1:] &= labels[:, 1:] == labels[:, :-1]
    interior[:, :-1] &= labels[:, :-1] == labels[:, 1:]
    return (labels > 0) & ~interior


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export detailed Allen annotation masks for the web viewer."
    )
    parser.add_argument("--resolution", type=int, choices=(25,), default=25)
    parser.add_argument("--manifest-only", action="store_true")
    args = parser.parse_args()

    structures = json.loads((ATLAS_DIR / "structures.json").read_text(encoding="utf-8"))
    structures_by_id = {int(structure["id"]): structure for structure in structures}
    labels = np.asarray(sorted(structures_by_id), dtype=np.uint32)
    mask_value_by_id = {int(label): index + 1 for index, label in enumerate(labels)}
    colors = np.zeros((len(labels) + 1, 3), dtype=np.uint8)
    for label in labels:
        colors[mask_value_by_id[int(label)]] = structures_by_id[int(label)]["rgb_triplet"]

    catalog = []
    for label in labels:
        structure = structures_by_id[int(label)]
        path = [int(value) for value in structure["structure_id_path"]]
        parent_id = path[-2] if len(path) > 1 else None
        parent = structures_by_id.get(parent_id) if parent_id is not None else None
        catalog.append(
            {
                "id": int(label),
                "acronym": structure["acronym"],
                "name": structure["name"],
                "color": "#{:02X}{:02X}{:02X}".format(*structure["rgb_triplet"]),
                "parentId": parent_id,
                "parentName": parent["name"] if parent else None,
                "path": path,
                "maskValue": mask_value_by_id[int(label)],
                "meshAvailable": (ATLAS_DIR / "meshes" / f"{int(label)}.obj").exists(),
            }
        )

    manifest = {
        "resolution_um": args.resolution,
        "encoding": "rgb24-mask-value",
        "structure_count": len(catalog),
        "structures": catalog,
    }
    (OUTPUT_DIR / "detailed-annotations.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    if args.manifest_only:
        print(f"[OK] Catalogue de {len(catalog)} structures Allen exporte", flush=True)
        return

    annotation = tifffile.memmap(ATLAS_DIR / "annotation.tiff", mode="r")
    for plane in PLANES:
        name = plane["name"]
        axis = int(plane["axis"])
        transpose = bool(plane["transpose"])
        count = annotation.shape[axis]
        width = max(3, len(str(count - 1)))
        output = OUTPUT_DIR / "slices" / str(args.resolution) / name / "detailed-masks"
        outlines = OUTPUT_DIR / "slices" / str(args.resolution) / name / "detailed-outlines"
        output.mkdir(parents=True, exist_ok=True)
        outlines.mkdir(parents=True, exist_ok=True)
        for index in range(count):
            annotation_slice = extract_slice(annotation, axis, index, transpose).astype(
                np.uint32, copy=False
            )
            values = encode_label_values(annotation_slice, labels)
            Image.fromarray(encode_rgb(values), mode="RGB").save(
                output / f"{name}-{index:0{width}d}.png",
                compress_level=3,
            )
            edge = label_boundaries(values)
            outline = np.zeros((*values.shape, 4), dtype=np.uint8)
            outline[edge, :3] = colors[values[edge]]
            outline[edge, 3] = 220
            Image.fromarray(outline, mode="RGBA").save(
                outlines / f"{name}-{index:0{width}d}.webp",
                format="WEBP",
                lossless=True,
                method=4,
            )
            if index % 100 == 0 or index == count - 1:
                print(f"[{name}] {index + 1}/{count}", flush=True)

    print(f"[OK] {len(catalog)} structures Allen exportees", flush=True)


if __name__ == "__main__":
    main()
