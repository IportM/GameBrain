#!/usr/bin/env python3
import argparse
import csv
import itertools
import sys
from pathlib import Path

import nibabel as nib
from nibabel.processing import resample_from_to
import numpy as np
from scipy.ndimage import gaussian_gradient_magnitude, zoom

RIGHT_HEMISPHERE_OFFSET = 2000


def strip_nii(name):
    if name.endswith(".nii.gz"):
        return name[:-7]
    if name.endswith(".nii"):
        return name[:-4]
    return name


def load_3d(path):
    image = nib.load(str(path))
    if len(image.shape) == 3:
        data = np.asarray(image.dataobj)
    elif len(image.shape) == 4 and image.shape[3] == 1:
        data = np.asarray(image.dataobj[..., 0])
    else:
        raise ValueError(f"Image 3D attendue: {path} ({image.shape})")
    return image, data


def load_input(path):
    image = nib.load(str(path))
    if len(image.shape) == 3:
        data = np.asarray(image.dataobj)
    elif len(image.shape) == 4 and image.shape[3] == 1:
        data = np.asarray(image.dataobj[..., 0])
    elif len(image.shape) == 4:
        data = np.asarray(image.dataobj)
    else:
        raise ValueError(f"Image 3D ou 4D attendue: {path} ({image.shape})")
    return image, data


def load_orientation_source(path):
    image = nib.load(str(path))
    if len(image.shape) == 3:
        data = np.asarray(image.dataobj)
    elif len(image.shape) == 4:
        data = np.asarray(image.dataobj[..., 0])
    else:
        raise ValueError(f"Référence 3D ou 4D attendue: {path} ({image.shape})")
    return image, data


def find_orientation_source(input_path):
    stem = strip_nii(input_path.name)
    lower = stem.lower()
    sources = {
        "_t1map": "unit1",
        "_t2map": "mese",
        "_t2starmap": None,
        "_unit1": None,
        "_mese": None,
    }
    suffix = next((value for value in sources if lower.endswith(value)), None)
    if suffix is None:
        raise ValueError(
            "Nom attendu: SUJET_T1map, SUJET_T2map, SUJET_T2starmap, "
            "SUJET_UNIT1 ou SUJET_MESE"
        )
    marker = sources[suffix]
    if marker is None:
        return input_path
    subject = stem[:-len(suffix)].rstrip("_").lower()
    candidates = [
        path for path in input_path.parent.glob("*")
        if path.is_file()
        and strip_nii(path.name).lower().startswith(subject)
        and marker in path.name.lower()
        and "_rare" not in path.name.lower()
        and path.name.lower().endswith((".nii", ".nii.gz"))
    ]
    if len(candidates) > 1:
        stems = {strip_nii(path.name).lower() for path in candidates}
        if len(stems) == 1:
            compressed = [path for path in candidates if path.name.lower().endswith(".nii.gz")]
            candidates = compressed or candidates
    if len(candidates) != 1:
        raise ValueError(
            f"Référence {marker.upper()} non trouvée ou ambiguë pour {stem}"
        )
    return candidates[0]


def robust_scale(data, use):
    values = data[use & np.isfinite(data)]
    values = values[values != 0]
    if values.size == 0:
        return np.zeros_like(data, dtype=np.float32)
    low, high = np.percentile(values, (1, 99))
    return np.clip((data.astype(np.float32) - low) / (high - low + 1e-12), 0, 1)


def entropy(values):
    values = values[values > 0]
    return float(-np.sum(values * np.log(values)))


def similarity(fixed, moving, use):
    fixed = robust_scale(fixed, use)
    moving = robust_scale(moving, use)
    histogram = np.histogram2d(
        fixed[use], moving[use], bins=48, range=((0, 1), (0, 1))
    )[0]
    histogram /= histogram.sum()
    nmi = (
        entropy(histogram.sum(1)) + entropy(histogram.sum(0))
    ) / entropy(histogram)
    gradient = np.corrcoef(
        gaussian_gradient_magnitude(fixed, 1)[use],
        gaussian_gradient_magnitude(moving, 1)[use],
    )[0, 1]
    return float(nmi), float(gradient)


def detect_orientation(source_image, source_data, rare_image, rare_data):
    target = rare_data[::2, ::2, ::2]
    use = target != 0
    source_shape = np.asarray(source_data.shape)
    source_zooms = np.asarray(source_image.header.get_zooms()[:3])
    rare_shape = np.asarray(rare_image.shape)
    rare_zooms = np.asarray(rare_image.header.get_zooms()[:3])
    reliable_zooms = bool(np.all(source_zooms > 0) and np.all(source_zooms < 0.5))
    candidates = []
    for permutation in itertools.permutations(range(3)):
        if reliable_zooms:
            mismatch = np.abs(
                (source_shape * source_zooms)[list(permutation)]
                - rare_shape * rare_zooms
            ).sum()
            if mismatch > 0.5:
                continue
        elif tuple(source_shape[list(permutation)]) != tuple(rare_shape):
            continue
        transformed = np.transpose(source_data, permutation)
        transformed = zoom(
            transformed,
            [target.shape[index] / transformed.shape[index] for index in range(3)],
            order=1,
            prefilter=False,
        )
        for flips in itertools.product((0, 1), repeat=3):
            candidate = transformed
            for axis, enabled in enumerate(flips):
                if enabled:
                    candidate = np.flip(candidate, axis)
            nmi, gradient = similarity(target, candidate, use)
            candidates.append((nmi, gradient, permutation, flips))
    if not candidates:
        raise ValueError("Aucune orientation compatible avec la RARE")
    return sorted(candidates, reverse=True)


def reorient(data, permutation, flips):
    axes = tuple(permutation) + tuple(range(3, data.ndim))
    result = np.transpose(data, axes)
    for axis, enabled in enumerate(flips):
        if enabled:
            result = np.flip(result, axis)
    return np.ascontiguousarray(result)


def affine_from_rare(input_image, shape, permutation, rare_image):
    zooms = np.asarray(input_image.header.get_zooms()[:3])[list(permutation)]
    rare_zooms = np.asarray(rare_image.header.get_zooms()[:3])
    directions = rare_image.affine[:3, :3] / rare_zooms
    matrix = directions * zooms
    rare_center = nib.affines.apply_affine(
        rare_image.affine, (np.asarray(rare_image.shape) - 1) / 2
    )
    translation = rare_center - matrix @ ((np.asarray(shape[:3]) - 1) / 2)
    affine = np.eye(4)
    affine[:3, :3] = matrix
    affine[:3, 3] = translation
    return affine


def validate_existing_geometry(image):
    if int(image.header["qform_code"]) <= 0 and int(image.header["sform_code"]) <= 0:
        raise ValueError("--geometry-done exige un qform ou sform valide")
    if not np.all(np.isfinite(image.affine)):
        raise ValueError("Affine non finie")
    if abs(np.linalg.det(image.affine[:3, :3])) < 1e-9:
        raise ValueError("Affine singulière")


def save_image(data, affine, header, path, dtype):
    image = nib.Nifti1Image(np.asarray(data, dtype=dtype), affine, header.copy())
    image.set_qform(affine, 1)
    image.set_sform(affine, 1)
    image.header.set_xyzt_units("mm")
    nib.save(image, str(path))
    return image


def read_names(path):
    with open(path, newline="", encoding="utf-8-sig") as handle:
        return {
            int(row["id"]): row["name"]
            for row in csv.DictReader(handle)
            if row.get("id")
        }


def label_metadata(label_id, names):
    if label_id >= RIGHT_HEMISPHERE_OFFSET:
        base_id = label_id - RIGHT_HEMISPHERE_OFFSET
        if base_id in names:
            return names[base_id], "right"
    if label_id in names:
        return names[label_id], "left"
    return "", ""


def complete_bilateral_label_ids(atlas_label_ids, names):
    expected = {int(label_id) for label_id in atlas_label_ids if label_id != 0}
    for label_id in tuple(expected):
        if label_id >= RIGHT_HEMISPHERE_OFFSET:
            base_id = label_id - RIGHT_HEMISPHERE_OFFSET
        else:
            base_id = label_id
        if base_id in names:
            expected.add(base_id)
            expected.add(base_id + RIGHT_HEMISPHERE_OFFSET)
    return sorted(expected)


def write_statistics(image_data, labels_data, expected_label_ids, names, output):
    is_series = image_data.ndim == 4
    with open(output, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, delimiter="\t")
        header = ["id", "name", "side"]
        if is_series:
            header.append("echo")
        writer.writerow(header + [
            "n_voxels", "mean", "std", "median", "min", "max", "p05", "p95"
        ])
        for label_id in expected_label_ids:
            if label_id == 0:
                continue
            selected = image_data[labels_data == label_id]
            volumes = range(image_data.shape[3]) if is_series else (None,)
            for volume in volumes:
                values = selected[:, volume] if is_series else selected
                values = values[np.isfinite(values) & (values != 0)]
                name, side = label_metadata(int(label_id), names)
                row = [int(label_id), name, side]
                if is_series:
                    row.append(volume + 1)
                if values.size == 0:
                    writer.writerow(row + ["n/a"] * 8)
                else:
                    statistics = (
                        np.mean(values), np.std(values), np.median(values),
                        np.min(values), np.max(values),
                        np.percentile(values, 5), np.percentile(values, 95),
                    )
                    writer.writerow(row + [
                        int(values.size),
                        *(f"{value:.9g}" for value in statistics),
                    ])


def main():
    here = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Réoriente une carte si nécessaire et extrait les statistiques Allen."
    )
    parser.add_argument("--input", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--geometry-done", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    labels_path = Path(args.label).resolve()
    output = Path(args.output).resolve()
    brain_path = labels_path.parent / "rare_brain_extracted.nii.gz"
    source_path = input_path if args.geometry_done else find_orientation_source(input_path)
    required = [input_path, labels_path]
    if not args.geometry_done:
        required.extend((source_path, brain_path))
    for path in required:
        if not path.is_file():
            raise FileNotFoundError(path)

    statistics_path = output / "roi_statistics.tsv"
    reoriented_path = output / "image_reoriented.nii.gz"
    expected = [statistics_path]
    if not args.geometry_done:
        expected.append(reoriented_path)
    if not args.force:
        for path in expected:
            if path.exists():
                raise FileExistsError(f"Sortie déjà présente: {path} (utiliser --force)")
    output.mkdir(parents=True, exist_ok=True)

    input_image, input_data = load_input(input_path)
    rare_image, rare_data = load_3d(brain_path)
    if args.geometry_done:
        validate_existing_geometry(input_image)
        result_image = nib.Nifti1Image(input_data, input_image.affine)
        result_data = input_data
        print("[OK] Géométrie MRtrix conservée")
    else:
        source_image, source_data = load_orientation_source(source_path)
        candidates = detect_orientation(
            source_image, source_data.astype(np.float32),
            rare_image, rare_data.astype(np.float32),
        )
        _, _, detected_permutation, detected_flips = candidates[0]
        permutation, flips = detected_permutation, detected_flips
        result_data = reorient(input_data, permutation, flips)
        affine = affine_from_rare(input_image, result_data.shape, permutation, rare_image)
        result_image = save_image(
            result_data, affine, input_image.header, reoriented_path, input_data.dtype
        )
        margin = candidates[0][0] - candidates[1][0] if len(candidates) > 1 else 0
        print(f"[OK] Orientation: permutation={permutation}, flips={flips}, marge={margin:.6f}")

    labels = resample_from_to(
        nib.load(str(labels_path)),
        (result_data.shape[:3], result_image.affine),
        order=0,
    )
    label_data = np.rint(np.asarray(labels.dataobj)).astype(np.int32)
    if not np.any(label_data):
        raise ValueError(
            "Aucun label Allen ne chevauche l'image; vérifier sa géométrie physique"
        )
    names = read_names(here / "resources/allen_labels_table.csv")
    _, atlas_label_data = load_3d(here / "resources/100_AMBA_LR.nii.gz")
    atlas_label_ids = np.unique(np.rint(atlas_label_data).astype(np.int32))
    expected_label_ids = complete_bilateral_label_ids(atlas_label_ids, names)
    write_statistics(
        result_data, label_data, expected_label_ids, names, statistics_path
    )
    print(f"[OK] Statistiques: {statistics_path}")
    if not args.geometry_done:
        print(f"[OK] Image réorientée: {reoriented_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
