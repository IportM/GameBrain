#!/usr/bin/env python3
import argparse
import os
import sys

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import ants
import antspynet


def main():
    parser = argparse.ArgumentParser(description="Extrait le cerveau d'une RARE.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--mask-output", required=True)
    parser.add_argument("--brain-output", required=True)
    parser.add_argument(
        "--cache-dir",
        help="Cache ANTsXNet contenant les modèles et gabarits pré-téléchargés.",
    )
    args = parser.parse_args()

    if args.cache_dir:
        if not os.path.isdir(args.cache_dir):
            raise FileNotFoundError(f"Cache ANTsXNet introuvable: {args.cache_dir}")
        antspynet.set_antsxnet_cache_directory(args.cache_dir)

    image = ants.image_read(args.input)
    if image.dimension != 3:
        raise ValueError(f"RARE 3D attendue, reçu {image.dimension} dimensions")

    corrected = ants.n4_bias_field_correction(
        image, shrink_factor=4,
        convergence={"iters": [20, 20, 10], "tol": 1e-6},
    )
    corrected = ants.n4_bias_field_correction(
        corrected, shrink_factor=2,
        convergence={"iters": [30, 20, 10], "tol": 1e-6},
    )
    probability = antspynet.mouse_brain_extraction(corrected)
    mask = ants.threshold_image(probability, "Otsu", 1, 0)
    mask = ants.iMath(mask, "ME", 6)
    mask = ants.iMath(mask, "GetLargestComponent", 10000)
    mask = ants.iMath(mask, "MD", 6)
    mask = ants.iMath(mask, "FillHoles", 0.3)
    brain = ants.multiply_images(corrected, mask)

    ants.image_write(mask, args.mask_output)
    ants.image_write(brain, args.brain_output)
    print(f"[OK] Extraction cérébrale: {int((mask.numpy() > 0.5).sum())} voxels")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
