import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage
from skimage import measure


REGION_IDS = (315, 1089, 512, 703, 698, 477, 803, 549, 1097, 313, 771, 354)
PLANES = {
    "coronal": {"axis": 0, "transpose": False},
    "sagittal": {"axis": 2, "transpose": True},
    "axial": {"axis": 1, "transpose": False},
}


def plane_slice(volume: np.ndarray, plane: str, index: int) -> np.ndarray:
    image = np.take(volume, index, axis=int(PLANES[plane]["axis"]))
    result = np.asarray(image).T if PLANES[plane]["transpose"] else np.asarray(image)
    return np.fliplr(result) if plane == "sagittal" else result


def build_lookup(structures: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    label_to_mask: dict[int, int] = {}
    for mask_value, region_id in enumerate(REGION_IDS, start=1):
        for structure in structures:
            if region_id in structure["structure_id_path"]:
                label_to_mask[int(structure["id"])] = mask_value
    labels = np.asarray(sorted(label_to_mask), dtype=np.uint32)
    values = np.asarray([label_to_mask[int(label)] for label in labels], dtype=np.uint8)
    return labels, values


def encode_labels(annotation: np.ndarray, labels: np.ndarray, values: np.ndarray) -> np.ndarray:
    positions = np.searchsorted(labels, annotation)
    valid = positions < len(labels)
    safe = np.minimum(positions, len(labels) - 1)
    matches = valid & (labels[safe] == annotation)
    encoded = np.zeros(annotation.shape, dtype=np.uint8)
    encoded[matches] = values[safe[matches]]
    return encoded


def boundaries(labels: np.ndarray) -> np.ndarray:
    interior = labels > 0
    interior[1:, :] &= labels[1:, :] == labels[:-1, :]
    interior[:-1, :] &= labels[:-1, :] == labels[1:, :]
    interior[:, 1:] &= labels[:, 1:] == labels[:, :-1]
    interior[:, :-1] &= labels[:, :-1] == labels[:, 1:]
    return (labels > 0) & ~interior


def export_region_meshes(
    encoded_volume: np.ndarray,
    spacing_mm: np.ndarray,
    output: Path,
) -> list[int]:
    regions_dir = output / "regions"
    regions_dir.mkdir(parents=True, exist_ok=True)
    center = (
        (np.asarray(encoded_volume.shape, dtype=np.float32) - 1)
        * spacing_mm
        * 500
    )
    exported: list[int] = []

    for mask_value, region_id in enumerate(REGION_IDS, start=1):
        mask = encoded_volume == mask_value
        if not np.any(mask):
            continue
        smooth = ndimage.gaussian_filter(mask.astype(np.float32), sigma=0.65)
        if smooth.max() < 0.5:
            continue
        vertices, faces, _, _ = measure.marching_cubes(
            smooth,
            level=0.5,
            spacing=tuple(spacing_mm * 1000),
        )
        vertices -= center
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
        trimesh.smoothing.filter_humphrey(
            mesh, alpha=0.1, beta=0.5, iterations=2
        )
        mesh.remove_unreferenced_vertices()
        trimesh.repair.fix_normals(mesh, multibody=True)
        mesh.export(regions_dir / f"{region_id}.glb", file_type="glb")
        exported.append(region_id)

    return exported


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Exporte les labels Allen natifs pour le web")
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--structures",
        type=Path,
        default=root / "data-source" / "brainglobe" / "allen_mouse_25um_v1.2" / "structures.json",
    )
    args = parser.parse_args()

    structures = json.loads(args.structures.resolve().read_text(encoding="utf-8"))
    structures_by_id = {int(structure["id"]): structure for structure in structures}
    labels, values = build_lookup(structures)
    colors = np.zeros((len(REGION_IDS) + 1, 4), dtype=np.uint8)
    for mask_value, region_id in enumerate(REGION_IDS, start=1):
        colors[mask_value, :3] = structures_by_id[region_id]["rgb_triplet"]
        colors[mask_value, 3] = 235

    labels_image = nib.load(args.labels.resolve())
    native = np.asarray(labels_image.dataobj, dtype=np.uint32)
    volume = np.flip(np.transpose(native, (1, 2, 0)), axis=(0, 1))
    native_spacing = np.asarray(labels_image.header.get_zooms()[:3], dtype=np.float32)
    spacing = native_spacing[[1, 2, 0]]
    output = args.output.resolve()
    encoded_volume = encode_labels(volume, labels, values)
    exported_regions = export_region_meshes(encoded_volume, spacing, output)
    counts: dict[str, int] = {}
    present_regions: set[int] = set()

    for plane, definition in PLANES.items():
        count = int(volume.shape[int(definition["axis"])])
        counts[plane] = count
        width = max(3, len(str(count - 1)))
        mask_dir = output / "masks" / plane
        outline_dir = output / "outlines" / plane
        mask_dir.mkdir(parents=True, exist_ok=True)
        outline_dir.mkdir(parents=True, exist_ok=True)
        for index in range(count):
            encoded = encode_labels(plane_slice(volume, plane, index), labels, values)
            present_regions.update(int(value) for value in np.unique(encoded) if value > 0)
            file_name = f"{plane}-{index:0{width}d}.png"
            Image.fromarray(encoded, mode="L").save(mask_dir / file_name, compress_level=3)
            edge = boundaries(encoded)
            outline = np.zeros((*encoded.shape, 4), dtype=np.uint8)
            outline[edge] = colors[encoded[edge]]
            Image.fromarray(outline, mode="RGBA").save(
                outline_dir / file_name.replace(".png", ".webp"),
                format="WEBP",
                lossless=True,
                method=4,
            )

    manifest = {
        "slice_counts": counts,
        "mask_values": {
            str(mask_value): region_id
            for mask_value, region_id in enumerate(REGION_IDS, start=1)
        },
        "present_regions": sorted(present_regions),
        "region_meshes": exported_regions,
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[OK] Masques Allen natifs prêts : {output}", flush=True)


if __name__ == "__main__":
    main()
