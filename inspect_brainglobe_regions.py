#!/usr/bin/env python3
import json

import meshio
import numpy as np

from brainglobe_atlasapi import BrainGlobeAtlas
from check_brainglobe_atlas import (
    ATLAS_NAME,
    BRAINGLOBE_DIR,
    CONFIG_PATH,
    ensure_local_config,
)


SELECTED_ACRONYMS = ("Isocortex", "HPF", "CB")
COMPARISON_ACRONYMS = ("TH", "STR")


def triangle_count(mesh: meshio.Mesh) -> int:
    return sum(len(cell_block.data) for cell_block in mesh.cells if cell_block.type == "triangle")


def main() -> None:
    ensure_local_config()
    atlas = BrainGlobeAtlas(
        ATLAS_NAME,
        brainglobe_dir=BRAINGLOBE_DIR,
        check_latest=False,
        config_dir=CONFIG_PATH,
    )

    structures_path = BRAINGLOBE_DIR / atlas.local_full_name / "structures.json"
    structures = json.loads(structures_path.read_text(encoding="utf-8"))
    by_acronym = {structure["acronym"]: structure for structure in structures}
    by_id = {structure["id"]: structure for structure in structures}

    print("Regions retenues pour le premier prototype:")
    print("acronym | id   | vertices | triangles | taille mm                 | couleur | parent")
    print("--------+------+----------+-----------+---------------------------+---------+----------------")

    for acronym in (*SELECTED_ACRONYMS, *COMPARISON_ACRONYMS):
        structure = by_acronym[acronym]
        mesh_path = atlas.meshfile_from_structure(structure["id"])
        mesh = meshio.read(mesh_path)
        extent_mm = (mesh.points.max(axis=0) - mesh.points.min(axis=0)) / 1000.0
        parent_id = structure["structure_id_path"][-2] if len(structure["structure_id_path"]) > 1 else None
        parent = by_id[parent_id]["name"] if parent_id is not None else "-"
        color = "#{:02X}{:02X}{:02X}".format(*structure["rgb_triplet"])
        selected = "*" if acronym in SELECTED_ACRONYMS else " "

        print(
            f"{selected}{acronym:<7} | {structure['id']:<4} | {len(mesh.points):>8} | "
            f"{triangle_count(mesh):>9} | "
            f"{extent_mm[0]:>6.2f} x {extent_mm[1]:>6.2f} x {extent_mm[2]:>6.2f} | "
            f"{color} | {parent}"
        )

    print("\n* selectionne: Isocortex, Hippocampal formation, Cerebellum")

    print("\nVerification dans le volume d'annotations:")
    print("acronym  | descendants | voxels directs | voxels agreges")
    print("---------+-------------+----------------+---------------")
    annotation = atlas.annotation
    for acronym in SELECTED_ACRONYMS:
        structure = by_acronym[acronym]
        direct_voxels = int(np.count_nonzero(annotation == structure["id"]))
        aggregate_voxels = int(np.count_nonzero(atlas.get_structure_mask(acronym)))
        descendants = len(atlas.get_structure_descendants(acronym))
        print(
            f"{acronym:<8} | {descendants:>11} | {direct_voxels:>14} | "
            f"{aggregate_voxels:>13}"
        )


if __name__ == "__main__":
    main()
