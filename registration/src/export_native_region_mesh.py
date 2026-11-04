import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
import trimesh
from scipy import ndimage
from skimage import measure


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Exporte une structure Allen en espace natif")
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--region-id", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--volume-cache", type=Path)
    parser.add_argument(
        "--structures",
        type=Path,
        default=root / "data-source" / "brainglobe" / "allen_mouse_25um_v1.2" / "structures.json",
    )
    args = parser.parse_args()

    structures = json.loads(args.structures.resolve().read_text(encoding="utf-8"))
    descendants = np.asarray(
        [
            int(structure["id"])
            for structure in structures
            if args.region_id in structure["structure_id_path"]
        ],
        dtype=np.uint32,
    )
    if descendants.size == 0:
        raise ValueError(f"Structure Allen inconnue : {args.region_id}")

    labels_image = nib.load(args.labels.resolve())
    if args.volume_cache and args.volume_cache.resolve().exists():
        volume = np.load(args.volume_cache.resolve(), mmap_mode="r", allow_pickle=False)
    else:
        native = np.asarray(labels_image.dataobj, dtype=np.uint32)
        volume = np.flip(np.transpose(native, (1, 2, 0)), axis=(0, 1))
    mask = np.isin(volume, descendants)
    if not np.any(mask):
        raise ValueError(f"Structure Allen absente de l'image : {args.region_id}")

    native_spacing = np.asarray(labels_image.header.get_zooms()[:3], dtype=np.float32)
    spacing = native_spacing[[1, 2, 0]]
    coordinates = np.argwhere(mask)
    lower = np.maximum(coordinates.min(axis=0) - 2, 0)
    upper = np.minimum(coordinates.max(axis=0) + 3, np.asarray(mask.shape))
    slices = tuple(slice(int(start), int(stop)) for start, stop in zip(lower, upper))
    cropped = np.asarray(mask[slices], dtype=np.float32)
    smooth = ndimage.gaussian_filter(cropped, sigma=0.65)
    vertices, faces, _, _ = measure.marching_cubes(
        smooth,
        level=min(0.5, float(smooth.max()) * 0.75),
        spacing=tuple(spacing * 1000),
    )
    center = (np.asarray(volume.shape, dtype=np.float32) - 1) * spacing * 500
    vertices += lower * spacing * 1000
    vertices -= center
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
    trimesh.smoothing.filter_humphrey(mesh, alpha=0.1, beta=0.5, iterations=2)
    mesh.remove_unreferenced_vertices()
    trimesh.repair.fix_normals(mesh, multibody=True)
    args.output.resolve().parent.mkdir(parents=True, exist_ok=True)
    mesh.export(args.output.resolve(), file_type="glb")
    print(f"[OK] Structure native {args.region_id} exportee", flush=True)


if __name__ == "__main__":
    main()
