import argparse
import csv
import json
import sys
from pathlib import Path

import nibabel as nib
import numpy as np


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Exporte les statistiques régionales en CSV")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--modality-name", required=True)
    parser.add_argument("--region-ids", required=True)
    parser.add_argument(
        "--structures",
        type=Path,
        default=root / "data-source" / "brainglobe" / "allen_mouse_25um_v1.2" / "structures.json",
    )
    args = parser.parse_args()

    structures = json.loads(args.structures.resolve().read_text(encoding="utf-8"))
    structures_by_id = {int(item["id"]): item for item in structures}
    requested = [int(value) for value in args.region_ids.split(",") if value.strip()]
    if not requested:
        raise ValueError("Aucune région sélectionnée")
    unknown = [region_id for region_id in requested if region_id not in structures_by_id]
    if unknown:
        raise ValueError(f"Structures Allen inconnues : {unknown[:5]}")

    image = nib.load(args.input.resolve())
    labels_image = nib.load(args.labels.resolve())
    data = np.asarray(image.dataobj, dtype=np.float32)
    labels = np.asarray(labels_image.dataobj, dtype=np.int32)
    if data.shape != labels.shape or not np.allclose(
        image.affine,
        labels_image.affine,
        rtol=1e-5,
        atol=1e-4,
    ):
        raise ValueError("La modalité et les annotations Allen n'occupent pas la même grille")

    flat_labels = labels.reshape(-1)
    flat_data = data.reshape(-1)
    order = np.argsort(flat_labels, kind="stable")
    sorted_labels = flat_labels[order]
    sorted_data = flat_data[order]
    unique, starts, counts = np.unique(sorted_labels, return_index=True, return_counts=True)
    all_counts: dict[int, int] = {}
    valid_values: dict[int, np.ndarray] = {}
    for label_id, start, count in zip(unique, starts, counts):
        numeric_id = int(label_id)
        if numeric_id <= 0:
            continue
        values = sorted_data[int(start):int(start + count)]
        all_counts[numeric_id] = int(count)
        valid_values[numeric_id] = values[np.isfinite(values) & (values != 0)]

    descendants: dict[int, list[int]] = {region_id: [] for region_id in requested}
    requested_set = set(requested)
    for structure in structures:
        structure_id = int(structure["id"])
        for ancestor in structure["structure_id_path"]:
            ancestor_id = int(ancestor)
            if ancestor_id in requested_set:
                descendants[ancestor_id].append(structure_id)

    voxel_volume = float(np.prod(image.header.get_zooms()[:3]))
    writer = csv.writer(
        sys.stdout,
        delimiter=";",
        lineterminator="\n",
        quoting=csv.QUOTE_ALL,
    )
    writer.writerow([
        "modality", "region_id", "acronym", "region", "descendant_count",
        "region_voxels", "valid_voxels", "excluded_voxels", "sampled_volume_mm3",
        "mean", "std", "median", "min", "max", "p05", "p25", "p75", "p95",
    ])
    for region_id in requested:
        structure = structures_by_id[region_id]
        region_labels = descendants[region_id]
        region_voxels = sum(all_counts.get(label_id, 0) for label_id in region_labels)
        arrays = [valid_values[label_id] for label_id in region_labels if label_id in valid_values]
        values = np.concatenate(arrays) if arrays else np.empty(0, dtype=np.float32)
        row = [
            args.modality_name,
            region_id,
            structure["acronym"],
            structure["name"],
            len(region_labels),
            region_voxels,
            int(values.size),
            region_voxels - int(values.size),
            f"{values.size * voxel_volume:.9g}",
        ]
        if values.size:
            statistics = [
                np.mean(values), np.std(values), np.median(values), np.min(values), np.max(values),
                np.percentile(values, 5), np.percentile(values, 25),
                np.percentile(values, 75), np.percentile(values, 95),
            ]
            row.extend(f"{float(value):.9g}" for value in statistics)
        else:
            row.extend(["n/a"] * 9)
        writer.writerow(row)


if __name__ == "__main__":
    main()
