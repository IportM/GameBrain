import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np


def load_scalar(path: Path) -> tuple[nib.Nifti1Image, np.ndarray]:
    image = nib.load(path.resolve())
    if len(image.shape) == 4 and image.shape[3] == 1:
        data = np.asarray(image.dataobj[..., 0], dtype=np.float32)
    elif len(image.shape) == 3:
        data = np.asarray(image.dataobj, dtype=np.float32)
    else:
        raise ValueError(f"Volume NIfTI 3D attendu : {image.shape}")
    return image, data


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Statistiques d'une modalité dans une région Allen")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--region-id", type=int, required=True)
    parser.add_argument(
        "--structures",
        type=Path,
        default=root / "data-source" / "brainglobe" / "allen_mouse_25um_v1.2" / "structures.json",
    )
    args = parser.parse_args()

    structures = json.loads(args.structures.resolve().read_text(encoding="utf-8"))
    structure = next((item for item in structures if int(item["id"]) == args.region_id), None)
    if structure is None:
        raise ValueError(f"Structure Allen inconnue : {args.region_id}")
    descendants = np.asarray([
        int(item["id"])
        for item in structures
        if args.region_id in [int(value) for value in item["structure_id_path"]]
    ], dtype=np.int32)

    image, data = load_scalar(args.input)
    labels_image = nib.load(args.labels.resolve())
    labels = np.asarray(labels_image.dataobj, dtype=np.int32)
    if data.shape != labels.shape or not np.allclose(
        image.affine,
        labels_image.affine,
        rtol=1e-5,
        atol=1e-4,
    ):
        raise ValueError("La modalité et les annotations Allen n'occupent pas la même grille")

    region_mask = np.isin(labels, descendants)
    region_values = data[region_mask]
    usable = region_values[np.isfinite(region_values) & (region_values != 0)]
    voxel_volume_mm3 = float(np.prod(image.header.get_zooms()[:3]))
    result = {
        "region_id": args.region_id,
        "region_name": str(structure["name"]),
        "region_acronym": str(structure["acronym"]),
        "descendant_count": int(descendants.size),
        "region_voxels": int(region_values.size),
        "valid_voxels": int(usable.size),
        "excluded_voxels": int(region_values.size - usable.size),
        "voxel_volume_mm3": voxel_volume_mm3,
        "sampled_volume_mm3": float(usable.size * voxel_volume_mm3),
        "statistics": None,
    }
    if usable.size:
        result["statistics"] = {
            "mean": float(np.mean(usable)),
            "std": float(np.std(usable)),
            "median": float(np.median(usable)),
            "min": float(np.min(usable)),
            "max": float(np.max(usable)),
            "p05": float(np.percentile(usable, 5)),
            "p95": float(np.percentile(usable, 95)),
        }
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
