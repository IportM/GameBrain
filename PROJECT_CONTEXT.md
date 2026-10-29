# Brain Atlas Multi-Resolution Viewer - Project Context

## Goal

Build a prototype for exploring brain atlas data with a game-programmer mindset:

- start from Allen brain atlas volumes at multiple physical resolutions;
- navigate slices/volumes interactively;
- switch resolution levels like LoD/mipmaps;
- later move toward an Unreal Engine 3D scene where the user can rotate a brain, inspect anatomical regions, and see explanatory popups.

The important framing is not only "scroll changes resolution", because that already exists in scientific viewers. The stronger project direction is:

> An interactive multi-scale brain atlas viewer that combines scientific multi-resolution data, anatomical metadata, 3D interaction, and game-style LoD.

## Current Product Direction

The first deliverable is now a shareable web application rather than an Unreal application.

The target experience is:

- three synchronized Allen atlas slices: sagittal, coronal, and axial;
- one interactive 3D brain view;
- Allen anatomical regions overlaid on the slices and represented as 3D meshes;
- mouse hover highlighting of the anatomical region under the pointer;
- rotation, pan, and zoom in 3D;
- a small information panel with the Allen region name, acronym, ID, color, and parent region.

Unreal remains a possible later immersive or VR version. The first web version will use BrainGlobe/Python for data preparation and a web 3D stack for the user-facing viewer.

Development proceeds in small verified steps. The current milestone displays the first Allen region in a local web viewer; slices and anatomical picking are deliberately deferred.

### BrainGlobe Step 1 Status

Completed on Windows:

- separate Python environment: `.venv-brainglobe`;
- `brainglobe-atlasapi 2.3.1` installed;
- stable atlas `allen_mouse_25um` version `1.2` downloaded into `data-source/brainglobe`;
- atlas resolution verified as `(25, 25, 25) um`;
- atlas shape verified as `(528, 320, 456)` voxels;
- orientation verified as `asr`;
- 840 anatomical structures found;
- reusable validation script: `check_brainglobe_atlas.py`.

This atlas validation is now the stable source-data foundation for the web application.

### BrainGlobe Step 2 Status

The atlas hierarchy and candidate meshes were inspected. Three regions are selected for the first 3D prototype:

- `Isocortex`, Allen ID `315`, color `#70FF71`;
- `HPF` (Hippocampal formation), Allen ID `1089`, color `#7ED04B`;
- `CB` (Cerebellum), Allen ID `512`, color `#F0F080`.

This set gives one outer structure, one internal structure, and one posterior structure. The reusable inspection script is `inspect_brainglobe_regions.py`.

Important hierarchy observation: parent regions aggregate descendants. `Isocortex` has no voxels directly labelled `315` in the annotation volume, but its 294 descendants aggregate to 7,891,055 voxels. The web viewer must therefore map leaf voxel IDs to their selected ancestor when synchronizing slices and 3D meshes.

### Web Step 3 Status

The first visual web milestone is complete:

- HPF mesh `1089.obj` is reproducibly converted to `1089.glb` by `export_web_mesh.py`;
- the GLB contains 14,773 vertices and 29,530 triangles and weighs about 578 KiB;
- `web/` contains a React, Three.js, React Three Fiber, and Vite viewer;
- HPF is displayed with its Allen color and a readable scientific-style material;
- mouse/touch orbit rotation and zoom are enabled;
- desktop and mobile framing are responsive;
- the production build succeeds and browser verification reports no console errors or layout overflow.

### Web Step 4 Status

The first three-region assembly is complete:

- Isocortex `315`, HPF `1089`, and Cerebellum `512` are exported with one shared Allen-space center;
- the three GLB meshes preserve their anatomical alignment;
- Isocortex is semi-transparent so internal HPF remains visible;
- each region has an independent visibility checkbox;
- all three regions remain aligned during rotation and zoom;
- desktop and mobile layouts were visually verified without console errors or overflow.

### Web Step 5 Status

The first anatomical hover interaction is complete:

- raycasting identifies Isocortex, HPF, and Cerebellum under the pointer;
- opaque internal regions take priority over the transparent Isocortex when intersections overlap;
- all 3D meshes are gray at rest and only the hovered mesh receives its Allen color plus a subtle emissive highlight;
- a contextual panel shows the Allen name, acronym, ID, color, parent name, and parent ID;
- the panel clears when the pointer leaves the anatomy or a region is hidden;
- desktop and mobile layouts were verified without overflow or console errors.

### Web Step 6 Status

The first annotated 2D slice is complete:

- `export_web_slice.py` reads the local Allen reference, annotation, and structure hierarchy;
- a central coronal slice is exported at index `264` (`6.60 mm`, `25 um` resolution);
- the Allen reference is normalized in grayscale;
- Isocortex, HPF, and Cerebellum descendants are aggregated and overlaid with translucent Allen colors and crisp boundaries;
- the web workspace now shows the 3D view and coronal slice together;
- desktop and mobile layouts were verified without clipping, overflow, or console errors.

### Web Step 7 Status

The coronal slice is now navigable:

- all `528` coronal positions are exported as optimized WebP images;
- the complete coronal series weighs about `4.43 MiB`;
- one shared intensity normalization prevents brightness changes between adjacent slices;
- a desktop slider changes the current slice continuously;
- scrolling over the coronal image moves forward or backward through the slice stack;
- wheel input is accumulated for trackpads and capped per event to keep navigation controlled;
- the panel reports both the Allen index and its physical coordinate in millimeters;
- only the selected image and its immediate neighbors are loaded;
- index `400` (`10.00 mm`) was verified in the browser with the matching image;
- 3D hover remains operational and browser verification reports no console errors or overflow.

Mobile work and mobile validation are paused for now. The current product target is desktop.

### Web Step 8 Status

The coronal slice position can now be represented in the 3D view:

- a `Plan 3D` switch is available beside the coronal controls;
- the switch is disabled by default to keep the anatomical view clear;
- the translucent coronal plane uses the same Allen-space transform as the exported meshes;
- changing the slider or scrolling through slices moves the plane to the matching position;
- the plane does not intercept raycasting, so region hover and highlighting continue to work;
- indexes `264`, `400`, and `402` were verified with their matching coordinates and plane positions;
- the application builds successfully and browser verification reports no console errors or overflow.

### Web Step 9 Status

All three orthogonal Allen slice views are now available:

- `528` coronal slices (`4.43 MiB`), `456` sagittal slices (`4.18 MiB`), and `320` axial slices (`4.11 MiB`) are exported as WebP;
- the sagittal images are oriented as anatomical profiles and the axial images show anterior at the top;
- `Coronale`, `Sagittale`, and `Axiale` tabs switch the active view;
- every orientation has independent wheel navigation, slider limits, index, and millimeter coordinate;
- switching tabs preserves the last index selected in each orientation;
- the optional 3D plane changes position and orientation with the active slice view;
- the plane does not interfere with Allen-region raycasting or hover highlighting;
- the central sagittal (`228`) and axial (`160`) slices, wheel navigation, and index preservation were verified in the browser;
- the production build succeeds with no console errors or desktop overflow.

### Web Step 10 Status

The annotated 2D slices are now anatomically interactive:

- each visible slice has a matching lossless identification mask with values for Isocortex, HPF, and CB;
- all `1,304` masks total about `2.18 MiB` and are loaded only for the active slice;
- pointer coordinates account for image scaling and letterboxing before reading the anatomical pixel;
- hovering an annotated region in any 2D orientation opens the Allen information panel;
- the same hover strengthens the region color in the slice and highlights the corresponding 3D mesh;
- moving onto an unannotated pixel or leaving the image clears the hover state;
- hovering a 3D mesh also highlights its region in the active 2D slice;
- Isocortex and HPF were verified in coronal view, CB in sagittal view, and Isocortex in axial view;
- the production build succeeds and browser verification reports no console errors or desktop overflow.

### Web Step 11 Status

The synchronized slice can now cut the 3D meshes geometrically:

- the former binary plane toggle is now an exclusive `Aucun`, `Plan`, or `Coupe` mode control;
- `Coupe` enables a Three.js local clipping plane shared by all visible Allen meshes;
- the clipping position follows the active slice index and wheel navigation without rebuilding geometry;
- each orientation exposes anatomical side choices: anterior/posterior, right/left, or superior/inferior;
- switching the preserved side produces complementary mesh sections;
- coronal, sagittal, and axial clipping were verified visually at their central indexes;
- moving the coronal slice from `264` to `268` changed the clipped canvas while the page remained fixed;
- hover raycasting and the existing translucent `Plan` mode continue to work after clipping;
- the production build succeeds and browser verification reports no console errors or desktop overflow.

### Web Step 12 Status

The open clipping boundary is now filled with the matching Allen slice image:

- exported slice WebPs use the Allen annotation volume as a transparent brain silhouette;
- the transparent series total about `13.71 MiB` across all three orientations;
- a shader-backed section plane displays the active reference image and Allen overlays at the clipping boundary;
- the plane uses the atlas dimensions `13.2 x 8.0 x 11.4 mm` and the same shared mesh center as the GLB exports;
- coronal, sagittal, and axial image axes are mapped into their matching 3D anatomical axes;
- transparent pixels are discarded, so no black rectangular background remains around the section;
- wheel navigation updates both the clipping boundary and the section texture;
- moving the axial slice from `160` to `164` changed more than `22,000` rendered canvas pixels;
- the section plane does not intercept raycasting, and HPF hover remained operational;
- the production build succeeds and browser verification reports no console errors or desktop overflow.

The visual section is now closed by the Allen image. The underlying region meshes are still surface meshes rather than newly generated watertight geometry.

### Web Step 13 Status

The 3D viewer now includes the complete Allen brain as anatomical context:

- Allen root mesh `997` is exported as a dedicated `1.9 MiB` GLB with the same shared center as the three interactive regions;
- the whole brain appears by default as a neutral translucent envelope;
- a `Cerveau` visibility control can hide or restore that envelope independently;
- the envelope is intentionally excluded from raycasting, so only Isocortex, HPF, and CB remain interactive and color-highlighted;
- HPF hover was verified through the complete-brain envelope;
- the envelope shares the active clipping plane and remains aligned with the textured Allen section;
- toggling the envelope changed more than `51,000` rendered pixels in the central coronal cut;
- the production build succeeds and browser verification reports no console errors or desktop overflow.

This is the first whole-brain milestone: the complete anatomy is visible, while detailed interaction is still limited to the original three regions.

### Web Step 14 Status

The complete 3D brain now has a unified focus treatment and corrected vertical orientation:

- the whole-brain envelope, Isocortex, HPF, and CB share the same resting opacity (`0.28`);
- hovering one interactive region raises it to `0.78` opacity and applies its Allen color;
- every non-hovered brain mesh is dimmed to `0.07`, making the target region easier to isolate;
- the whole 3D atlas display is vertically inverted to correct the previous upside-down presentation;
- slice planes and textured clipping sections use the same display transform;
- clipping-plane coordinates account for the vertical inversion, preserving anatomical alignment;
- CB hover and the central coronal clipping view were verified after the change;
- the production build succeeds and browser verification reports no console errors.

### Web Step 15 Status

Two slice-navigation regressions are fixed:

- the range slider now captures its numeric value before entering React's deferred state updater, preventing the event reference from becoming invalid and crashing the page to black;
- the dynamically loaded 3D section texture now has its own nested Suspense boundary;
- changing the active slice no longer suspends and remounts the region meshes, so their clipping materials remain active;
- coronal clipping was verified from index `264` to `265` with the slider and then to `267` with the mouse wheel;
- the production build succeeds after both fixes.

### Web Step 16 Status

Hover focus now temporarily reveals a complete region while 3D clipping is active:

- the clipping plane remains active for the whole-brain envelope and every non-hovered region;
- the hovered interactive region removes its clipping plane and appears in full with its Allen color;
- leaving the region immediately reapplies the current clipping plane;
- the complete Isocortex reveal and return to the central coronal cut were verified in the browser;
- the production build succeeds and browser verification reports no console errors.

### Web Step 17 Status

Regions can now be persistently selected and managed:

- clicking an interactive 3D mesh locks its highlight and information panel;
- clicking an annotated region in the active 2D slice produces the same persistent selection;
- hover remains temporary and takes visual priority until the pointer leaves;
- clicking the selected region again or an empty part of the 3D canvas clears the selection;
- the selected-region panel exposes `Isoler`, `Masquer`, and `Réinitialiser` commands;
- `Isoler` hides the whole-brain envelope and every other interactive region;
- `Masquer` hides the selected region and clears the selection;
- `Réinitialiser` restores the whole-brain envelope and all interactive regions;
- 3D HPF selection/isolation and 2D Isocortex selection/hiding were verified in the browser;
- the production build succeeds and browser verification reports no console errors.

### Web Step 18 Status

A permanent reset command is now available independently of region selection:

- `Réinitialiser` is displayed in the top toolbar at all times;
- it restores the whole-brain envelope and all interactive regions;
- it also clears active hover and persistent selection state;
- the selected-region panel keeps its own reset command for convenience;
- the toolbar adapts at narrow panel widths so the command remains fully visible;
- restoring a hidden whole-brain envelope and Isocortex was verified in the browser;
- the production build succeeds and browser verification reports no console errors.

### Web Step 19 Status

Allen annotations in the 2D and textured 3D sections now use a contour-only presentation:

- the former `44%` colored fill has been removed from all `1,304` exported WebP slices;
- reference anatomy remains grayscale while each available Allen region keeps its native colored boundary;
- the interaction masks are unchanged, preserving exact hover and click detection;
- hover and persistent selection draw a stronger two-pixel inner contour instead of filling the region;
- the regenerated transparent WebP series total about `15.1 MiB` across all orientations;
- the same contour-only image is displayed at the clipping boundary in 3D;
- coronal rest, selected Isocortex, and clipped 3D section states were verified in the browser;
- the export pipeline now opens Allen TIFF volumes read-only;
- the production build succeeds and browser verification reports no console errors.

### Web Step 20 Status

Isolated regions now use a neutral inspection material:

- `Isoler` still hides the whole-brain envelope and every other interactive region;
- the isolated region drops its Allen color and emissive highlight;
- its opacity becomes `1` and depth writing is restored, producing a solid neutral-gray surface;
- the information panel and Allen metadata remain available while isolated;
- both local and global reset commands leave isolation and restore normal interactive materials;
- opaque neutral HPF isolation and global restoration were verified in the browser;
- the production build succeeds and browser verification reports no console errors.

### Web Step 21 Status

Global transparency is now focus-driven instead of permanent:

- the whole-brain envelope and all visible region meshes use opacity `1` at rest;
- resting materials are treated as opaque and write to the depth buffer;
- hovering or selecting a region keeps that target opaque and Allen-colored;
- only the whole-brain context and non-targeted regions are temporarily dimmed to opacity `0.07`;
- leaving or clearing the target restores the complete opaque neutral brain;
- isolated regions retain their separate solid neutral inspection material;
- opaque rest, focused HPF, and restored rest states were verified in the browser;
- the production build succeeds and browser verification reports no console errors.

## Source Data Used So Far

The Allen template files are expected in the project-local data folder:

```text
<project-root>\Allen
```

Known files:

```text
allen_template_10.nii.gz   ~518 MB
allen_template_25.nii.gz   ~41 MB
allen_template_50.nii.gz   ~6 MB
allen_template_100.nii.gz  ~0.8 MB
```

These are NIfTI compressed volumes. They correspond to multiple physical resolutions:

```text
10 / 25 / 50 / 100 um
```

This matches the LoD/pyramid idea. The smaller resolution number is the finer data.

## Environment

A local Windows Python virtual environment is now created here:

```text
<project-root>\.venv-napari
```

Napari was installed:

```text
napari 0.5.6
```

Useful packages installed in the venv include:

```text
nibabel
pynrrd
ome-zarr
zarr
dask
numcodecs
napari-ome-zarr
tifffile
scikit-image
imageio
vispy
PyQt5
```

The previous `.venv-napari` copied from macOS/Linux was broken on Windows because it contained `bin/` launchers pointing at `/Library/Developer/...`. It was replaced by a real Windows venv with `Scripts/python.exe`.

Install or repair the environment with:

```powershell
.\.venv-napari\Scripts\python.exe -m pip install -r requirements-napari.txt
```

If Python itself must be recreated, use a Windows Python executable:

```powershell
python -m venv .venv-napari
.\.venv-napari\Scripts\python.exe -m pip install -r requirements-napari.txt
```

## Scripts In This Project

Project folder:

```text
<project-root>
```

### `run_napari.ps1`

Windows launcher for napari from the project venv.

Use:

```powershell
cd "<project-root>"
.\run_napari.ps1
```

### `run_napari.sh`

Unix/Git-Bash launcher for napari from the project venv.

Use:

```bash
cd "<project-root>"
./run_napari.sh
```

It sets:

```bash
QT_MAC_WANTS_LAYER=1
_NAPARI_RERUN_WITH_FIXES=1
```

This avoids the macOS relaunch problem that caused:

```text
ModuleNotFoundError: No module named 'napari'
```

### `open_allen_pyramid.py`

Opens the Allen NIfTI volumes in napari as a multi-resolution pyramid.

Basic use:

```powershell
cd "<project-root>"
.\.venv-napari\Scripts\python.exe open_allen_pyramid.py .\Allen --keyword template
```

Modes tested:

```powershell
# Scroll changes LoD directly instead of zooming the camera
.\.venv-napari\Scripts\python.exe open_allen_pyramid.py .\Allen --keyword template --locked-lod

# Show three central orthogonal slices side-by-side
.\.venv-napari\Scripts\python.exe open_allen_pyramid.py .\Allen --keyword template --triplanar --locked-lod

# Show three orthogonal planes in 3D at 100 um
.\.venv-napari\Scripts\python.exe open_allen_pyramid.py .\Allen --keyword template --three-planes-3d 100

# Same, plus transparent volume rendering
.\.venv-napari\Scripts\python.exe open_allen_pyramid.py .\Allen --keyword template --three-planes-3d 100 --volume-3d
```

Important observations:

- Napari's native multiscale mode works, but visually it mostly feels like zooming.
- The script adds an overlay showing the active level/resolution.
- `--locked-lod` makes the wheel/pad change `10 -> 25 -> 50 -> 100 um` directly while keeping screen size more stable.

### `allen_quad_viewer.py`

Custom PyQt + Vispy viewer approximating an orthoview + 3D layout.

This was created to resemble a medical/atlas viewer layout:

- top-left: one orthogonal slice;
- top-right: second orthogonal slice;
- bottom-left: third orthogonal slice;
- bottom-right: 3D volume view;
- red crosshairs synchronized across views;
- click/drag in slice changes the position;
- mouse wheel or keys `1/2/3/4` change the slice resolution.

Use:

```powershell
cd "<project-root>"
.\.venv-napari\Scripts\python.exe allen_quad_viewer.py .\Allen --keyword template --resolution 100 --render-resolution 100
```

Notes:

- The first version loaded full NIfTI volumes and crashed/was too slow at 10 um.
- It was improved so 2D slices are read on demand from the NIfTI proxy.
- The 3D render stays at `--render-resolution 100` by default to avoid crashing.
- `10 um` is still heavy, especially if used for 3D.

### `convert_allen_to_omezarr.py`

Converts the NIfTI pyramid into OME-Zarr.

Use:

```powershell
cd "<project-root>"
.\.venv-napari\Scripts\python.exe convert_allen_to_omezarr.py .\Allen --keyword template
```

Overwrite an existing conversion:

```powershell
.\.venv-napari\Scripts\python.exe convert_allen_to_omezarr.py .\Allen --keyword template --overwrite
```

Server/high-performance conversion example:

```powershell
python convert_allen_to_omezarr.py /path/to/Allen --keyword template --output /path/out/allen_template.ome.zarr --chunk 128 --overwrite
```

Why OME-Zarr:

- NIfTI `.nii.gz` is a compressed monolithic volume.
- OME-Zarr is chunked and multi-scale, which is better for LoD/streaming.
- The tradeoff is bigger disk size but faster access to local chunks.

Expected size:

```text
~1 GB to 3 GB
```

depending on chunks/compression.

### `open_omezarr_napari.py`

Opens an OME-Zarr explicitly with `napari-ome-zarr`.

Use:

```powershell
cd "<project-root>"
.\.venv-napari\Scripts\python.exe open_omezarr_napari.py .\allen_template.ome.zarr
```

Notes:

- Opening directly with `napari path/to/file.ome.zarr` caused a reader ambiguity:

```text
Multiple plugins found capable of reading ...
```

- This script forces `plugin="napari-ome-zarr"`.
- It also tries to move the slider to the center and auto-adjust contrast.
- At one point the OME-Zarr image appeared empty. Possible causes:
  - napari opened an empty/black first slice;
  - contrast issue;
  - OME-Zarr metadata/axis issue;
  - conversion produced a structure not fully accepted by `napari-ome-zarr`.

## Technical Lessons So Far

### NIfTI

NIfTI `.nii.gz` is fine for storage and compatibility, but bad for game-like streaming:

- compressed as a large block;
- not chunked for LoD;
- slow to read arbitrary slices at high resolution;
- not ideal for interactive 3D switching.

### OME-Zarr

Better target for scientific LoD:

- chunked;
- multi-scale;
- compatible with napari;
- closer to virtual texturing / tiled streaming.

However, OME-Zarr must be written with metadata and axes that readers expect.

Current local state:

- `allen_template.ome.zarr` exists locally.
- It currently contains one Zarr array at path `0`, shape `(1140, 1320, 800)`, dtype `uint16`.
- Root OME-Zarr `.zattrs` metadata has been added so `napari-ome-zarr` can detect it as OME-Zarr.
- This local copy is not yet a full four-level pyramid. It should be regenerated from the original `10/25/50/100 um` NIfTI files when those files are available in `.\Allen`.

### Napari

Good for:

- scientific prototyping;
- verifying multi-scale data;
- quick slice/volume inspection.

Less ideal for:

- custom 4-viewport medical UI;
- game-like interaction;
- explanatory popups;
- polished 3D atlas experience.

### Custom PyQt/Vispy Prototype

Good for proving the orthoview + 3D concept.

Weaknesses:

- rough UI;
- no anatomical metadata yet;
- no real mesh/object selection;
- 3D volume rendering is still limited by data size.

## MorphoNet / MorphoNet 2.0 Comparison

MorphoNet/MorphoNet 2.0 is a strong reference for the project.

It is a biological 3D/3D+t visualization environment using Unity and Python, focused on:

- 3D visualization;
- segmented biological objects;
- meshes;
- curation/correction;
- time-lapse and lineage;
- metadata/properties on objects.

But the project here is different:

| Topic | This Project | MorphoNet / 2.0 |
|---|---|---|
| Brain atlas Allen | Central | Not specifically central |
| Multi-resolution LoD `10/25/50/100 um` | Central | Not the main focus |
| 3D biological interaction | Yes | Yes |
| Segmentation correction | Not central | Central |
| Time-lapse 3D+t | Not central | Central |
| Educational/anatomical popups | Desired | Similar metadata idea |
| Game-engine scene | Desired, likely Unreal | Unity |

MorphoNet should be cited as:

> A strong reference for interactive biological 3D visualization, object metadata, and game-engine-based scientific exploration.

But not a direct replacement, because the intended project is more:

> A multi-scale interactive brain atlas viewer with anatomical LoD, local resolution increase, and explanatory interaction.

## Unreal Engine Direction

The user knows Unreal Engine better than Unity.

The project can absolutely be built in Unreal.

Recommended architecture:

### Data/Python Pipeline

Use Python to prepare assets:

- read Allen template and annotation volumes;
- use the annotation atlas to extract regions;
- generate meshes per anatomical region, likely via marching cubes;
- simplify meshes at multiple LoD levels;
- export meshes as `.glb`, `.fbx`, or `.obj`;
- export metadata JSON:

```json
{
  "id": 123,
  "name": "Hippocampal formation",
  "acronym": "HPF",
  "description": "...",
  "color": "#...",
  "parent": 456
}
```

### Unreal Viewer

Use Unreal for:

- orbit/fly camera;
- brain scene;
- region meshes as actors/components;
- raycast/line trace on click or hover;
- highlight selected region;
- UMG popup with anatomical information;
- hide/isolate/transparent regions;
- search/filter region hierarchy;
- mesh LoD or Nanite for detail.

### Multi-Resolution In Unreal

There are two LoD concepts:

1. Mesh LoD:
   - whole brain at 100 um;
   - big regions at 50 um;
   - selected/small regions at 25 or 10 um;
   - simplified/detailed meshes based on camera distance and selection.

2. Voxel/image LoD:
   - volume/slice data from OME-Zarr or a custom chunk format;
   - show high-resolution slices locally around selected anatomical regions;
   - potentially convert chunks to Unreal-friendly textures/volume textures.

Good framing:

```text
LoD camera = distance to object
LoD anatomical = importance/selection of a structure
LoD scientific = physical resolution available
```

## Suggested Next Steps

1. Obtain Allen annotation volume, not only the template intensity volume.
2. Obtain Allen structure metadata/tree.
3. Generate a small proof-of-concept mesh for one or a few regions.
4. Export those meshes plus metadata JSON.
5. Import into Unreal.
6. Implement:
   - orbit camera;
   - click/raycast;
   - highlight;
   - popup with region name.
7. Later add:
   - mesh LoD;
   - high-resolution local slices;
   - OME-Zarr/chunked streaming;
   - educational annotations.

## Web Viewer - Latest Milestone

The current web viewer now includes a compact tool panel on the left side of the 3D view:

- a global brain opacity slider from 10% to 100%;
- a searchable region dropdown supporting name, acronym, and Allen ID;
- independent visibility checkboxes for the whole brain and each exported region;
- direct region selection by clicking its name in the dropdown.

The former region controls were removed from the upper-right header. In 3D clip mode, pointer movement no longer triggers region hover highlighting, so the clipped anatomy remains visually stable. Existing explicit selection remains available and the isolated-region behavior remains opaque and neutral.

Validation completed:

- TypeScript compilation passes;
- Vite production build passes;
- desktop browser test passes for region search, menu selection, opacity adjustment, and clip mode;
- no browser console warnings or errors were observed.

### Clip opacity correction

Opacity is now scoped to 3D clip mode. The control is disabled for the complete-brain and plane-only modes, which always render the brain at full opacity. Changing opacity no longer recreates Three.js materials, so the brain's clipping plane is preserved. The opacity value is retained when switching away from clip mode and is restored when returning to it.

The final clip-mode rule is more specific: the opacity slider affects only the retained brain and non-selected structures. Selection does not add another dimming pass in clip mode. The selected region remains fully opaque, colored, and visible in its complete geometry across the cutting plane. At 100%, the retained brain is therefore genuinely opaque; lowering the slider reveals the selected internal region without changing that region's own opacity.

### Clean ghost brain mode

The continuous clip-opacity slider was replaced with three stable envelope presets: Opaque (100%), Attenuated (50%), and Ghost (20%). In clip mode, only the complete-brain envelope and the explicitly selected region are rendered in 3D; all other exported region meshes are hidden to avoid overlapping transparent surfaces. The selected region remains complete, colored, and opaque. Hovering a region in the 2D slice no longer swaps the 3D ghost-mode selection. Browser validation confirmed clean switching between presets and between selected regions without console errors.

### Adaptive clip context

The continuous 10-100% opacity slider was restored and now controls the currently displayed anatomical context. When the complete-brain envelope is enabled, it is the sole transparent context around the opaque selected region. When the complete-brain envelope is disabled, every checked region becomes part of the context and unchecked regions remain hidden; the selected region still stays complete, colored, and opaque. This keeps the clean envelope rendering by default while allowing custom multi-region compositions through the region list. Browser validation covered a three-region context at 35% opacity with no console errors.

### Camera-relative transparent depth

Transparent context regions in clip mode now use camera-relative front-to-back ordering with depth writes enabled. Each frame, the visible region meshes are ordered by their transformed distance to the active camera. The first surface reached at a pixel writes depth, preventing farther transparent regions from accumulating at that pixel. This approximates the requested first-hit ray behavior using the GPU depth buffer rather than expensive ray tracing. The opaque selected region remains prioritized. Browser validation covered all 12 context regions at 35% opacity before and after an interactive camera rotation, with no console errors.

### Selection context outside clip mode

The adaptive opacity and camera-relative depth behavior now activates whenever a region is selected, even when the 3D slice mode is None or Plane. The context slider defaults to 35%, remains disabled only when there is neither a selection nor an active clip, and controls either the complete-brain envelope or the checked region context. The selected region stays complete, colored, and opaque. Clearing the selection restores the normal fully opaque brain automatically. Browser validation covered a thalamus selection outside clip mode at both 35% and 60% opacity, including camera rotation, with no console errors.

### Per-pixel context depth

The camera-relative region sorting was replaced with a true GPU depth pre-pass. Invisible copies of the visible context meshes first record the nearest anatomical surface for every screen pixel. The transparent color pass is then restricted to that depth, so internal or rear surfaces no longer appear and disappear when the camera crosses a region-center ordering boundary. The selected region is rendered separately, complete, colored, and opaque above the context. This behavior applies both to explicit selections outside clip mode and to the 3D clip mode. Production build and interactive browser checks passed across multiple camera angles and opacity values with no console errors.

### Selected-region depth isolation

The selected region now uses a dedicated render layer after the context pass. The context depth is cleared before that layer is drawn, allowing the highlighted anatomy to remain fully visible while restoring normal self-occlusion inside the selected mesh. Rear-facing portions of a selected structure therefore no longer appear over its front surface when the camera rotates. The second layer is rendered without repainting the scene background, preserving the complete-brain context at every opacity value.

### Desktop workspace redesign

The floating 3D controls and region dropdown were replaced with a permanent, collapsible desktop sidebar. It now groups the full/plane/clip display mode, retained clip side, context opacity, searchable region visibility list, and the active-region inspector. The region list scrolls independently while the selected-region metadata and actions remain anchored at the bottom. The slice panel now contains only its orientation tabs, image, index, coordinate, and position slider. Region actions were clarified as Show only, Hide, and Clear, while the global action is labeled Reset display. The layout was browser-tested at a 1600 x 900 desktop viewport in full and collapsed states, including clip mode, with no console errors.

### Depth-aware slice and selection

The clip section and selected region now share one isolated overlay layer and one depth buffer. The transparent brain context is rendered first, then its depth is cleared before the section and selected anatomy are rendered together. Their visibility is therefore resolved per pixel from their real camera-space depth: selected surfaces in front remain intact, while the section remains visible wherever it is spatially exposed. Neither object has a global always-on-top priority. The Full, Plane, and Clip segmented control also fills the complete sidebar width.

### Region-list hover parity

Hovering a region row in the desktop sidebar now drives the same transient highlight as hovering that structure directly in the 3D brain: the target receives its Allen color, the remaining brain is attenuated, and the anatomical information panel appears without creating a persistent selection. Leaving the row clears the effect. The existing stability rule is preserved, so transient hover remains disabled while a region is selected or clip mode is active.

## Confirmed Near-Term Roadmap

The next data milestone is multi-resolution slice viewing. The initial target is `10 / 25 / 50 um` (with `100 um` kept as a possible later level). Switching levels must preserve the same physical anatomical position rather than the same raw slice index. The first implementation will change the 2D reference images and annotation masks only; the current 3D GLB region meshes remain shared between all slice resolutions. Polygon mesh LoD is a separate rendering optimization and can be added later without changing the scientific slice resolution.

Later planned work, after the multi-resolution milestone:

- import a personal mouse-brain image or volume and integrate the user's existing Allen registration code;
- add connectivity maps;
- integrate the future M2M tool supplied by the user.

### Web multi-resolution milestone

The web viewer now supports native Allen `10 / 25 / 50 um` slice levels. The selector is located in the 2D slice header and affects the coronal, sagittal, and axial reference images, interaction masks, and the section texture shown in 3D clip mode. The GLB brain and region meshes do not change with slice resolution.

Resolution changes preserve physical position in millimetres across every orientation. For example, `6.60 mm` maps to coronal index `660` at 10 um, `264` at 25 um, and `132` at 50 um. Wheel navigation, the position slider, region hover masks, and clip mode all use the active level's native slice count.

The official Allen CCF 2017 annotation and average-template NRRD volumes for 10 and 50 um are stored in `data-source/allen-multires`. The reusable `export_web_slice.py` exporter accepts repeated `--resolution` options and generates resolution-scoped assets below `web/public/atlas/slices/<resolution>`. Approximate generated web-data sizes are 205 MB at 10 um, 25.8 MB at 25 um, and 5.7 MB at 50 um.

Validation completed:

- TypeScript compilation passes;
- Vite production build passes;
- all three orientations load at native dimensions for each level;
- physical positions remain stable when changing resolution;
- changing resolution in 3D clip mode preserves clip mode;
- no browser console warnings or errors were observed.

### Region-menu preview in clip mode

The region list now has its own transient preview state. In 3D clip mode, hovering a menu row displays that region complete, opaque, and Allen-coloured above the clipped context without creating a persistent selection. Leaving the row removes the preview. Direct pointer hover on the 3D brain remains disabled for scene highlighting in clip mode, preserving the intended stable cut visualization. Keyboard focus on a region row provides the same temporary preview.

The same transient 3D preview is now enabled when hovering an annotated region on the 2D slice while clip mode is active. Direct hover on the 3D mesh itself remains disabled in clip mode, so camera inspection of the clipped brain stays stable.

### Project cleanup audit

A conservative cleanup pass removed only rebuildable or verified duplicate content:

- the Vite `web/dist` output;
- TypeScript and Python build caches;
- the legacy top-level 25 um slice folders, after confirming they exactly duplicated `web/public/atlas/slices/25`;
- 422 MB of unreachable Git objects after verifying that the repository had no commits, refs, reflogs, or staged files.

Generated slice and mesh exports, the legacy OME-Zarr, source atlas data, virtual environments, and build outputs are now explicitly ignored by Git. The cleanup recovered approximately 707 MB and reduced the project directory to about 2.65 GB. Optional deeper cleanup remains possible by removing the rebuildable Napari environment and its obsolete single-level OME-Zarr prototype.

### Web-first project structure

The optional deeper cleanup is complete. The obsolete `.venv-napari` environment and `allen_template.ome.zarr` prototype were removed, recovering approximately 930 MB more. The Napari source files remain available under `legacy/napari`, with their project-root paths adjusted for the new location.

The former monolithic `web/src/main.tsx` was separated without changing viewer behavior. The entry point now only mounts React; atlas metadata, resolution helpers, and anatomical transforms live in `web/src/atlas.ts`; 2D mask interaction lives in `web/src/InteractiveSlice.tsx`; and the main interface lives in `web/src/App.tsx`. A root README now documents local startup, generated assets, and the source layout.

The production bundle is separated into application, React, React Three Fiber, and Three.js chunks for better browser caching. TypeScript compilation, the production build, Python syntax checks, and browser tests of region selection plus 10/25 um switching all pass without console errors.

### First runtime optimization pass

The 3D canvas now renders on demand instead of continuously while the scene is idle, and its device-pixel ratio is capped at 1.5 to reduce GPU work on dense desktop displays. Orbit rotation, damping, selection, and clip overlays still request frames normally when the scene changes.

The whole-brain envelope is preloaded first and each anatomical region has its own Suspense boundary, so the main brain can appear before every regional GLB has finished loading. Region and annotation-mask lookups now use precomputed ID maps, sidebar search results are memoized, and 2D slice images use asynchronous decoding. Browser checks covered selection, clip mode, and camera rotation without console warnings or errors.

### Personal-volume registration import

The supplied `Recallage_Allen.zip` was inspected and integrated under `registration/`. It targets individual 3D RARE acquisitions in NIfTI format and performs N4 correction, ANTsXNet mouse-brain extraction, affine Allen-to-subject registration, and nearest-neighbor projection of bilateral Allen labels. It can also compute bilateral ROI statistics for 3D quantitative maps or 4D MESE series.

The web interface now exposes the first native-space registration milestone. Once a NIfTI import is ready, `Recaler Allen` launches `map_allen_to_image.py` on the already extracted brain with the full SyN preset. Progress, recent logs, failures, completion, and persisted results are available through the local Vite API. This milestone computes and validates the native Allen template and label volume.

Native registered labels are now exported to `registration/native-web` for the current import. The 666 detailed Allen labels remain preserved in the NIfTI result and are collapsed into the same 12 major anatomical groups used by the current UI. Imported slices can display all registered boundaries, resolve the region under the pointer, select it, and show its existing information panel. An already completed registration is upgraded through an export-only pass instead of rerunning SyN. Python child processes are explicitly configured for UTF-8 output on Windows so accented progress messages remain readable.

A portable `map_allen_to_image.py` entry point replaces the original hard-coded shared-server Python path. It accepts an already extracted brain when requested, validates NIfTI geometry, preserves the affine transform, validates integer labels, and emits a `registration_manifest.json` for the future web integration. Heavy models and atlas resources remain local and ignored by Git.

The Windows workstation now has a dedicated `.venv-registration` environment with ANTsPy. The web dialog accepts a user-selected `.nii` or `.nii.gz` and runs the full SyN registration through the local Vite API. A first quick registration completed technically but produced anatomically incorrect native overlays. Investigation showed that the imported image and extracted brain matched the historical `derivatives` inputs, while the fixed atlas used a different physical axis geometry and the quick preset. Registration now uses an Allen resource that is voxel-identical and geometrically identical to the historical FC3R `100_AMBA_ref`, paired with official Allen labels transformed into the same grid. Existing quick results are not reused by the web exporter.

The registration-space web exporter now reads the annotation resource recorded in each registration manifest instead of assuming the site's original axis order. FC3R-oriented registration volumes are converted back to the site's display axes only during export. If the expensive SyN succeeds but a later export fails, completed native assets can be regenerated without rerunning SyN, and the local API reconciles the recovered result from manifest timestamps.

Native Allen export now also builds one GLB mesh for each of the 12 major anatomical groups. In imported-image mode, the region selected or hovered from a 2D slice or the region list is rendered in its Allen color inside the extracted subject-brain surface. Both meshes use the same native voxel transform, reordered spacing, and volume center; selected regions remain complete when the 3D clipping mode is active.

The imported-image interface was simplified after the registration workflow made the two headers visually crowded. Once an image exists, import replacement, Allen registration status/actions, and deletion are grouped under a single `Image` menu with a small status indicator. The slice header presents native resolution in its subtitle and uses compact checkbox-style controls for Allen regions and the extraction-mask outline.

### Connectivity milestone 1

The first Allen connectivity milestone intentionally covers one experiment at a time in Allen space and only the 2D slice views. A `Connectivité` dialog accepts an Allen experiment ID (initially `100140756`), then a local Python worker downloads the 50 um `projection_density`, `injection_density`, and `data_mask` grid volumes directly from the Allen API. Raw NRRDs and generated overlays are cached under `registration/connectivity/<experiment-id>`.

Projection density is exported as a yellow-green logarithmic heat overlay and the injection site as orange-red. Both are restricted to the Allen anatomical support so weak experimental signal outside the brain is not displayed. They are exported as independent transparent layers and follow the current physical slice position across the existing 10/25/50 um Allen reference levels. A compact slice-header panel controls overall visibility, projection and injection independently, overlay opacity, and the minimum visible signal. 3D connectivity rendering, experiment search/metadata, structure summaries, and projection into an imported mouse remain deliberately deferred to later milestones.

The same experiment is also exported as a compact 100 um intensity volume for the 3D Allen view. A GPU ray-marching shader renders projection density with maximum-intensity projection (MIP), so paths appear continuous instead of exposing the regular voxel lattice. The shader uses a fixed 112 samples per camera ray and the 3D canvas temporarily uses DPR 1 while MIP is active to avoid GPU context loss. Injection is represented by a separate orange-red 3D marker whose weighted center and equivalent radius are computed from the injection-density volume. Projection and injection visibility, opacity, and minimum projection signal reuse the 2D controls. Enabling connectivity automatically uses the viewer's context opacity for the anatomical meshes so internal signal remains visible, and MIP sampling respects the active 3D clipping plane. Weak projections remain green and strong projections transition through yellow to white. Experiment search/metadata, structure summaries, and projection into an imported mouse remain deliberately deferred to later milestones.

The connectivity loader now offers two complementary entry paths. `Par région` resolves a structure name, acronym, or numeric structure ID through the official Allen ontology, then queries the stable `ApiConnectivity` metadata table and presents a compact list of experiments with the primary injection structure, experiment ID, line/strain, sex, and injection volume. Any result can be loaded directly through the existing cached preparation pipeline. `Par identifiant` preserves the original direct experiment-ID input for known datasets. Search itself does not download volumetric grids; the heavy preparation only begins after the user explicitly chooses an experiment.

The first native-connectivity milestone is implemented for 2D validation. When an imported image has a completed Allen registration and an Allen connectivity experiment is loaded, `Projeter sur l'image` converts the 50 um connectivity grids into the exact 100 um registration-atlas geometry and applies the already saved inverse SyN transforms. Projection density uses linear interpolation, the validity mask uses nearest-neighbor interpolation, and the result is restricted to the extracted native brain. Separate projection and injection overlays are exported for every native coronal, sagittal, and axial slice. The Allen-space maps remain untouched, and native 3D connectivity is deliberately deferred until the transformed 2D alignment has been inspected.

Native connectivity now also exports a full-resolution compact projection volume and a native injection marker. The 3D MIP renderer accepts anisotropic native voxel spacing and a source-specific center, so the transformed signal shares the imported subject mesh's centered display coordinates instead of the Allen atlas offsets. Projection threshold, opacity, clipping, and injection visibility continue to use the existing connectivity controls. Native projections created before this extension must be regenerated once with `Reprojeter sur l'image` to produce the 3D volume files and updated manifest.

The top-bar `Revenir à zéro` action is an explicit destructive session reset. After user confirmation, the local API refuses the action while any worker is active, verifies that both deletion targets remain inside `registration/`, removes every imported-image job and all derived extraction/registration/native-connectivity outputs, removes every downloaded and prepared connectivity experiment, recreates the empty cache directories, and resets all in-memory states. The interface then returns to the centred 25 um coronal Allen view with its default camera and controls, exactly as on a first launch. Static Allen atlas resources, source code, environments, and user-supplied source archives are never deleted.

The first direct registration-to-viewer experiment was removed from the interface after it exposed incorrect slice presentation. Registration code and prior outputs remain available locally, but the web button no longer launches ANTs or displays a registered result.

The current web milestone is a clean native import step. The top-bar `Importer` button accepts a user-selected 3D `.nii` or `.nii.gz`, then generates a GLB surface and native coronal, sagittal, and axial slices without registration or Allen overlays. NIfTI geometry is canonicalized, each plane uses the file's own slice count and spacing, and the interface switches to `Image importée`. An `Allen / Image importée` selector permits returning to the atlas. Region controls and interaction masks are hidden in native-image mode because they are not scientifically meaningful before registration.

The native import conversion uses the same axis convention as the Allen resources displayed by the site: transpose NIfTI axes to `(1, 2, 0)`, then flip the first two axes. Imported slices must be regenerated after any orientation change by importing the source NIfTI again.

The threshold-derived GLB surface and the temporary three-plane 3D replacement were removed. Native import now runs ANTsXNet mouse-brain extraction first, uses the extracted mask only to generate the GLB brain surface, and keeps the original acquisition intensities for the 2D slices. This extraction is independent from Allen registration. The extraction environment requires `registration/requirements-extraction.txt`, while the pretrained ANTsXNet assets are already stored under `registration/resources/antsxnet`.

The imported sagittal presentation is mirrored horizontally relative to raw NIfTI storage so that anterior is on the left and posterior/cerebellum on the right, matching the Allen sagittal convention used by the site. The corresponding imported 3D sagittal plane transform is mirrored as well so its texture remains spatially coherent with the extracted mesh.

When a native import is active, the top bar exposes `Supprimer l'image`. This deletes the uploaded NIfTI and all derived extraction/viewer resources for the current import, clears the persisted import state, and returns the interface to the centred Allen atlas. Deletion is rejected while an extraction is running.

## Important Caveats

- If data from different sources are used, they must be registered/aligned to the same atlas space.
- Downsampling intensity images is not the same as downsampling labels.
- For label/segmentation volumes, use nearest-neighbor or majority voting, not bilinear interpolation.
- The Allen `10/25/50/100 um` template levels are already aligned as atlas resources, which makes them suitable for LoD.
