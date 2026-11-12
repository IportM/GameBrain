# Runtime Resources

These files are included so a fresh clone can run imports, registration,
region measurements and Allen connectivity without the private `data-source` folder.

- `structures.json`: structure catalogue from BrainGlobe `allen_mouse_25um_v1.2`.
- `annotation_50.nrrd`: Allen CCF 2017 annotations at 50 micrometers, used to mask connectivity.
- `registration_allen_ccf2017_*.nii.gz`: template and labels in the registration grid.
- `site_allen_ccf2017_*.nii.gz`: template and labels in the site's atlas grid.
- `antsxnet/`: previously bundled mouse brain extraction model and templates.

The copies do not contain personal images. `pnpm run doctor` checks the catalogue,
connectivity annotation and extraction model checksums and Python imports.

The developer-only atlas regeneration scripts can still require source volumes
in `data-source`. Running them is not part of installing or using the site.
