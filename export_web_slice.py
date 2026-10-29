import argparse
import gzip
import json
import shutil
from contextlib import contextmanager
from pathlib import Path

import nrrd
import numpy as np
import tifffile
from PIL import Image

from atlas_regions import REGION_IDS


ROOT = Path(__file__).resolve().parent
BRAINGLOBE_ATLAS_DIR = ROOT / "data-source" / "brainglobe" / "allen_mouse_25um_v1.2"
MULTIRES_DIR = ROOT / "data-source" / "allen-multires"
OUTPUT_DIR = ROOT / "web" / "public" / "atlas" / "slices"
RESOLUTIONS_UM = (10, 25, 50)
PLANES = (
    {"name": "coronal", "axis": 0, "transpose": False},
    {"name": "sagittal", "axis": 2, "transpose": True},
    {"name": "axial", "axis": 1, "transpose": False},
)


def region_ids(structures: list[dict], parent_id: int) -> np.ndarray:
    return np.array(
        [
            structure["id"]
            for structure in structures
            if parent_id in structure["structure_id_path"]
        ],
        dtype=np.uint32,
    )


def label_boundaries(labels: np.ndarray) -> np.ndarray:
    interior = labels > 0
    interior[1:, :] &= labels[1:, :] == labels[:-1, :]
    interior[:-1, :] &= labels[:-1, :] == labels[1:, :]
    interior[:, 1:] &= labels[:, 1:] == labels[:, :-1]
    interior[:, :-1] &= labels[:, :-1] == labels[:, 1:]
    return (labels > 0) & ~interior


def extract_slice(volume: np.ndarray, axis: int, index: int, transpose: bool) -> np.ndarray:
    result = np.asarray(np.take(volume, index, axis=axis))
    return result.T if transpose else result


def nrrd_dtype(header: dict) -> np.dtype:
    aliases = {
        "unsigned short": "u2",
        "ushort": "u2",
        "uint16": "u2",
        "unsigned int": "u4",
        "uint": "u4",
        "uint32": "u4",
    }
    dtype_code = aliases.get(str(header["type"]).lower())
    if dtype_code is None:
        raise ValueError(f"Unsupported NRRD type: {header['type']}")
    byte_order = "<" if header.get("endian", "little") == "little" else ">"
    return np.dtype(byte_order + dtype_code)


def decompress_nrrd(path: Path, raw_path: Path) -> tuple[tuple[int, ...], np.dtype]:
    header = nrrd.read_header(str(path))
    if header.get("encoding") not in {"gzip", "gz"}:
        raise ValueError(f"Expected a gzip NRRD file: {path}")

    shape = tuple(int(size) for size in header["sizes"])
    dtype = nrrd_dtype(header)
    expected_size = int(np.prod(shape)) * dtype.itemsize
    if raw_path.exists() and raw_path.stat().st_size == expected_size:
        return shape, dtype

    print(f"Decompressing {path.name} ({expected_size / 1024**3:.2f} GiB raw)")
    with path.open("rb") as source:
        while True:
            line = source.readline()
            if line in {b"\n", b"\r\n", b""}:
                break
        with gzip.GzipFile(fileobj=source, mode="rb") as compressed:
            with raw_path.open("wb") as destination:
                shutil.copyfileobj(compressed, destination, length=16 * 1024 * 1024)

    if raw_path.stat().st_size != expected_size:
        raise ValueError(
            f"Unexpected decompressed size for {path.name}: "
            f"{raw_path.stat().st_size} instead of {expected_size}"
        )
    return shape, dtype


@contextmanager
def atlas_volumes(resolution_um: int):
    if resolution_um == 25:
        reference = tifffile.memmap(BRAINGLOBE_ATLAS_DIR / "reference.tiff", mode="r")
        annotation = tifffile.memmap(BRAINGLOBE_ATLAS_DIR / "annotation.tiff", mode="r")
        yield reference, annotation
        return

    temporary_dir = MULTIRES_DIR / ".raw-cache"
    temporary_dir.mkdir(parents=True, exist_ok=True)
    raw_paths: list[Path] = []
    volumes: list[np.ndarray] = []
    try:
        for prefix in ("average_template", "annotation"):
            source_path = MULTIRES_DIR / f"{prefix}_{resolution_um}.nrrd"
            raw_path = temporary_dir / f"{prefix}_{resolution_um}.raw"
            shape, dtype = decompress_nrrd(source_path, raw_path)
            raw_paths.append(raw_path)
            mapped = np.memmap(raw_path, dtype=dtype, mode="r", shape=shape, order="F")
            print(f"Preparing {prefix}_{resolution_um} in slice-friendly memory order")
            volumes.append(np.array(mapped, order="C"))
            mapped._mmap.close()
        yield volumes[0], volumes[1]
    finally:
        volumes.clear()
        for raw_path in raw_paths:
            raw_path.unlink(missing_ok=True)
        try:
            temporary_dir.rmdir()
        except OSError:
            pass


def build_label_lookup(structures: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    label_to_mask: dict[int, int] = {}
    for mask_value, region_id in enumerate(REGION_IDS, start=1):
        for label in region_ids(structures, region_id):
            label_to_mask[int(label)] = mask_value

    sorted_labels = np.array(sorted(label_to_mask), dtype=np.uint32)
    mask_values = np.array(
        [label_to_mask[int(label)] for label in sorted_labels],
        dtype=np.uint8,
    )
    return sorted_labels, mask_values


def interaction_mask_for_slice(
    annotation_slice: np.ndarray,
    sorted_labels: np.ndarray,
    mask_values: np.ndarray,
) -> np.ndarray:
    positions = np.searchsorted(sorted_labels, annotation_slice)
    valid_positions = positions < len(sorted_labels)
    safe_positions = np.minimum(positions, len(sorted_labels) - 1)
    matches = valid_positions & (sorted_labels[safe_positions] == annotation_slice)
    interaction_mask = np.zeros(annotation_slice.shape, dtype=np.uint8)
    interaction_mask[matches] = mask_values[safe_positions[matches]]
    return interaction_mask


def export_resolution(resolution_um: int, structures: list[dict]) -> None:
    structures_by_id = {structure["id"]: structure for structure in structures}
    region_colors = np.zeros((len(REGION_IDS) + 1, 3), dtype=np.uint8)
    for mask_value, region_id in enumerate(REGION_IDS, start=1):
        region_colors[mask_value] = structures_by_id[region_id]["rgb_triplet"]
    sorted_labels, mask_values = build_label_lookup(structures)

    with atlas_volumes(resolution_um) as (reference, annotation):
        if reference.shape != annotation.shape:
            raise ValueError(
                f"Shape mismatch at {resolution_um} um: {reference.shape} and {annotation.shape}"
            )

        sample_step = max(1, round(100 / resolution_um))
        sampled_reference = np.asarray(
            reference[::sample_step, ::sample_step, ::sample_step], dtype=np.float32
        )
        brain_values = sampled_reference[sampled_reference > 0]
        low, high = np.percentile(brain_values, (1, 99.5))

        for plane in PLANES:
            name = plane["name"]
            axis = plane["axis"]
            transpose = plane["transpose"]
            count = reference.shape[axis]
            index_width = max(3, len(str(count - 1)))
            plane_dir = OUTPUT_DIR / str(resolution_um) / name
            mask_dir = plane_dir / "masks"
            plane_dir.mkdir(parents=True, exist_ok=True)
            mask_dir.mkdir(parents=True, exist_ok=True)

            for index in range(count):
                reference_slice = extract_slice(reference, axis, index, transpose).astype(
                    np.float32, copy=False
                )
                annotation_slice = extract_slice(annotation, axis, index, transpose).astype(
                    np.uint32, copy=False
                )
                grayscale = np.clip((reference_slice - low) / (high - low), 0, 1) * 255
                rgb = np.repeat(grayscale[..., None], 3, axis=2)
                interaction_mask = interaction_mask_for_slice(
                    annotation_slice, sorted_labels, mask_values
                )

                boundaries = label_boundaries(interaction_mask)
                rgb[boundaries] = region_colors[interaction_mask[boundaries]]

                filename = f"{name}-{index:0{index_width}d}"
                alpha_channel = np.where(annotation_slice > 0, 255, 0).astype(np.uint8)
                rgba = np.dstack((rgb.astype(np.uint8), alpha_channel))
                Image.fromarray(rgba, mode="RGBA").save(
                    plane_dir / f"{filename}.webp",
                    format="WEBP",
                    quality=84,
                    method=2,
                )
                Image.fromarray(interaction_mask, mode="L").save(
                    mask_dir / f"{filename}.png", compress_level=3
                )

                if index % 50 == 0 or index == count - 1:
                    print(f"[{resolution_um} um] Exported {index + 1}/{count} {name} slices")

            image_shape = extract_slice(reference, axis, count // 2, transpose).shape
            manifest = {
                "plane": name,
                "axis": axis,
                "count": int(count),
                "first_index": 0,
                "last_index": int(count - 1),
                "default_index": int(count // 2),
                "resolution_um": resolution_um,
                "orientation": "asr",
                "image_shape": list(image_shape),
                "image_pattern": f"{name}-{{index:0{index_width}d}}.webp",
                "mask_pattern": f"masks/{name}-{{index:0{index_width}d}}.png",
                "mask_values": {
                    str(mask_value): region_id
                    for mask_value, region_id in enumerate(REGION_IDS, start=1)
                },
                "normalization_percentiles": [1, 99.5],
            }
            (plane_dir / "manifest.json").write_text(
                json.dumps(manifest, indent=2), encoding="utf-8"
            )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export Allen reference slices and interaction masks for the web viewer."
    )
    parser.add_argument(
        "--resolution",
        type=int,
        choices=RESOLUTIONS_UM,
        action="append",
        dest="resolutions",
        help="Resolution to export. Repeat for multiple levels; defaults to all levels.",
    )
    args = parser.parse_args()
    resolutions = tuple(dict.fromkeys(args.resolutions or RESOLUTIONS_UM))
    structures = json.loads(
        (BRAINGLOBE_ATLAS_DIR / "structures.json").read_text(encoding="utf-8")
    )

    for resolution_um in resolutions:
        export_resolution(resolution_um, structures)


if __name__ == "__main__":
    main()
