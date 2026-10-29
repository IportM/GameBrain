import json
from pathlib import Path

import numpy as np
import trimesh

from atlas_regions import REGION_IDS


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = (
    ROOT / "data-source" / "brainglobe" / "allen_mouse_25um_v1.2" / "meshes"
)
OUTPUT_DIR = ROOT / "web" / "public" / "atlas" / "regions"
ATLAS_CENTER = np.array([7500.01, 3394.489, 5687.737])
WHOLE_BRAIN = {"id": 997, "acronym": "Root", "color": (132, 140, 136, 255)}

def main() -> None:
    structures = json.loads(
        (SOURCE_DIR.parent / "structures.json").read_text(encoding="utf-8")
    )
    structures_by_id = {structure["id"]: structure for structure in structures}
    regions = tuple(
        {
            "id": region_id,
            "acronym": structures_by_id[region_id]["acronym"],
            "color": (*structures_by_id[region_id]["rgb_triplet"], 255),
        }
        for region_id in REGION_IDS
    )
    meshes: dict[int, trimesh.Trimesh] = {}
    for region in (*regions, WHOLE_BRAIN):
        source = SOURCE_DIR / f"{region['id']}.obj"
        if not source.exists():
            raise FileNotFoundError(f"Allen mesh not found: {source}")

        mesh = trimesh.load_mesh(source, file_type="obj", process=False)
        if not isinstance(mesh, trimesh.Trimesh):
            mesh = mesh.dump(concatenate=True)
        meshes[region["id"]] = mesh

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Shared Allen center: {ATLAS_CENTER.tolist()}")
    for region in (*regions, WHOLE_BRAIN):
        mesh = meshes[region["id"]]
        mesh.apply_translation(-ATLAS_CENTER)
        mesh.visual = trimesh.visual.ColorVisuals(
            mesh=mesh,
            face_colors=region["color"],
        )

        output = OUTPUT_DIR / f"{region['id']}.glb"
        mesh.export(output, file_type="glb")
        print(
            f"Exported {region['acronym']} ({region['id']}): "
            f"{len(mesh.vertices):,} vertices, {len(mesh.faces):,} triangles, "
            f"{output.stat().st_size / 1024:.1f} KiB"
        )


if __name__ == "__main__":
    main()
