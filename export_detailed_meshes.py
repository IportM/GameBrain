import json
from pathlib import Path

import numpy as np
import trimesh


ROOT = Path(__file__).resolve().parent
ATLAS_ROOT = ROOT / "data-source" / "brainglobe" / "allen_mouse_25um_v1.2"
SOURCE_DIR = ATLAS_ROOT / "meshes"
OUTPUT_DIR = ROOT / "web" / "public" / "atlas" / "detailed-regions"
ATLAS_CENTER = np.array([7500.01, 3394.489, 5687.737])


def main() -> None:
    structures = json.loads((ATLAS_ROOT / "structures.json").read_text(encoding="utf-8"))
    structures_by_id = {structure["id"]: structure for structure in structures}
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    exported = 0
    for source in sorted(SOURCE_DIR.glob("*.obj"), key=lambda path: int(path.stem)):
        region_id = int(source.stem)
        output = OUTPUT_DIR / f"{region_id}.glb"
        if output.exists() and output.stat().st_mtime_ns >= source.stat().st_mtime_ns:
            exported += 1
            continue

        mesh = trimesh.load_mesh(source, file_type="obj", process=False)
        if not isinstance(mesh, trimesh.Trimesh):
            mesh = mesh.dump(concatenate=True)
        mesh.apply_translation(-ATLAS_CENTER)
        structure = structures_by_id[region_id]
        mesh.visual = trimesh.visual.ColorVisuals(
            mesh=mesh,
            face_colors=(*structure["rgb_triplet"], 255),
        )
        mesh.export(output, file_type="glb")
        exported += 1

    print(f"[OK] {exported} maillages Allen detailles disponibles dans {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
