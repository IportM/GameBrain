#!/usr/bin/env python3
import configparser
from pathlib import Path

from brainglobe_atlasapi import BrainGlobeAtlas


PROJECT_DIR = Path(__file__).resolve().parent
ATLAS_NAME = "allen_mouse_25um"
BRAINGLOBE_DIR = PROJECT_DIR / "data-source" / "brainglobe"
CONFIG_PATH = PROJECT_DIR / "data-source" / "brainglobe-config" / "bg_config.conf"


def ensure_local_config() -> None:
    if CONFIG_PATH.exists():
        return

    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    config = configparser.ConfigParser()
    config["default_dirs"] = {
        "brainglobe_dir": str(BRAINGLOBE_DIR),
        "interm_download_dir": str(BRAINGLOBE_DIR),
    }
    with CONFIG_PATH.open("w", encoding="utf-8") as config_file:
        config.write(config_file)


def main() -> None:
    BRAINGLOBE_DIR.mkdir(parents=True, exist_ok=True)
    ensure_local_config()
    print(f"Chargement de {ATLAS_NAME} dans {BRAINGLOBE_DIR}")

    atlas = BrainGlobeAtlas(
        ATLAS_NAME,
        brainglobe_dir=BRAINGLOBE_DIR,
        check_latest=False,
        config_dir=CONFIG_PATH,
    )

    print(f"Atlas: {atlas.atlas_name}")
    print(f"Version locale: {atlas.local_version}")
    print(f"Resolution: {tuple(atlas.resolution)} um")
    print(f"Dimensions: {tuple(atlas.shape)} voxels")
    print(f"Orientation: {atlas.orientation}")
    print(f"Structures: {len(atlas.lookup_df)}")
    print("BrainGlobe est pret.")


if __name__ == "__main__":
    main()
