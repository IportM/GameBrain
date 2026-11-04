import argparse
import json
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
import trimesh
from scipy import ndimage
from skimage import measure


def export_mesh(
    volume: np.ndarray,
    spacing: np.ndarray,
    descendants: np.ndarray,
    output: Path,
) -> None:
    mask = np.isin(volume, descendants)
    if not np.any(mask):
        raise ValueError("Structure absente de l'image")
    coordinates = np.argwhere(mask)
    lower = np.maximum(coordinates.min(axis=0) - 2, 0)
    upper = np.minimum(coordinates.max(axis=0) + 3, np.asarray(mask.shape))
    slices = tuple(slice(int(start), int(stop)) for start, stop in zip(lower, upper))
    smooth = ndimage.gaussian_filter(np.asarray(mask[slices], dtype=np.float32), sigma=0.65)
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
    output.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(output, file_type="glb")


def pick_region(
    volume: np.ndarray,
    spacing: np.ndarray,
    point: np.ndarray,
    direction: np.ndarray,
) -> int:
    norm = float(np.linalg.norm(direction))
    if norm <= 1e-8:
        return 0
    ray = direction / norm
    center = (np.asarray(volume.shape, dtype=np.float32) - 1) * spacing / 2
    step = max(float(np.min(spacing)) * 0.45, 0.025)
    for depth in np.arange(0.0, 4.0 + step, step):
        index = np.rint((point + ray * depth + center) / spacing).astype(np.int64)
        if np.any(index < 0) or np.any(index >= volume.shape):
            continue
        region_id = int(volume[tuple(index)])
        if region_id > 0:
            return region_id
    return 0


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Service de maillages Allen natifs")
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--volume-cache", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--structures",
        type=Path,
        default=root / "data-source" / "brainglobe" / "allen_mouse_25um_v1.2" / "structures.json",
    )
    args = parser.parse_args()

    structures = json.loads(args.structures.resolve().read_text(encoding="utf-8"))
    descendants: dict[int, list[int]] = {}
    for structure in structures:
        structure_id = int(structure["id"])
        for ancestor_id in structure["structure_id_path"]:
            descendants.setdefault(int(ancestor_id), []).append(structure_id)

    labels_image = nib.load(args.labels.resolve())
    spacing = np.asarray(labels_image.header.get_zooms()[:3], dtype=np.float32)[[1, 2, 0]]
    volume = np.load(args.volume_cache.resolve(), mmap_mode="r", allow_pickle=False)
    output_dir = args.output_dir.resolve()

    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        value = line.strip()
        if not value:
            continue
        try:
            if value.startswith("{"):
                command = json.loads(value)
                request_id = str(command["requestId"])
                region_id = pick_region(
                    volume,
                    spacing,
                    np.asarray(command["point"], dtype=np.float32),
                    np.asarray(command["direction"], dtype=np.float32),
                )
                print(
                    json.dumps(
                        {"requestId": request_id, "regionId": region_id, "ok": True},
                        ensure_ascii=True,
                    ),
                    flush=True,
                )
                continue
            region_id = int(value)
            output = output_dir / f"{region_id}.glb"
            if not output.exists():
                region_descendants = descendants.get(region_id)
                if not region_descendants:
                    raise ValueError("Structure Allen inconnue")
                export_mesh(
                    volume,
                    spacing,
                    np.asarray(region_descendants, dtype=np.uint32),
                    output,
                )
            result = {"regionId": region_id, "ok": True}
        except Exception as error:
            if value.startswith("{"):
                request_id = str(json.loads(value).get("requestId", "unknown"))
                result = {"requestId": request_id, "ok": False, "error": str(error)}
            else:
                result = {"regionId": int(value), "ok": False, "error": str(error)}
        print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
