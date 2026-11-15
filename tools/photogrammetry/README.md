# Reconstruct archived scans from original photographs

This Mac-only offline worker is separate from the Linux web server and DUSt3R.
The server reads an optional reviewed `reconstruction.v1.json` from the existing
scan storage prefix. Without it, the ARKit preliminary pipeline remains active.
No supplier volumes or title-derived quantities enter the calculation.

## Workflow

1. Download **all original** `colmap_photos.storage_path` objects for a ready scan.
   Name JPEG files using `frame_index` (`000.jpg`, etc.). Keep the original
   `scan.json`. Credentials belong in the environment, never committed.
2. Compile on a Mac supporting RealityKit PhotogrammetrySession:

   ```sh
   swiftc -O -parse-as-library tools/photogrammetry/reconstruct.swift -o /tmp/volmetric-reconstruct
   swiftc -O tools/photogrammetry/export_mesh.swift -o /tmp/volmetric-export-mesh
   /tmp/volmetric-reconstruct /absolute/photos /absolute/result
   /tmp/volmetric-export-mesh /absolute/result/model.usdz /absolute/result/mesh.json
   ```

3. Install NumPy and SciPy in an **offline worker** Python environment. These are
   not new web-server dependencies. Supply an archived preliminary cloud as a
   ground/gaze seed; its volume is not read or used. For a scan without a saved
   cloud, derive this seed with `pile.collect` and `pile.build_surface` and inspect
   its plane. Run:

   ```sh
   python tools/photogrammetry/measure.py /absolute/result \
     --scan /absolute/scan.json --scan-id SCAN_UUID \
     --seed-cloud /absolute/seed-cloud.json --roi-radius 2.5
   ```

4. Review the original photographs, reconstructed target, ground from all sides,
   heightfield/segmentation and camera residuals. `roi-radius` is a spatial
   selection in metres, **not** a volume calibration. Run the same command with
   `--reviewed` only after this inspection. Never choose settings to match a
   supplier volume. Do not use an incomplete/inaccurate target just because the
   number looks plausible. For a group of disconnected pallets, inspect each
   object and supply `--target-seeds seeds.json`: a list of `[x,z]` coordinates
   in ARKit metres. These select individual components; the gap between them is
   never filled or added to the total. One nearest component is the default,
   suitable for one pile, **not** automatically the sum of a group. For touching
   packages use an explicitly reviewed `--target-polygon polygon.json` (convex
   XZ metre region). The region must enclose the actual object, including its
   overhang, while excluding neighbours. It is a selection region, not a ground
   contact outline: clipping at the pallet's wooden base can remove real walls.
   Include `--target-description` and `--quality-notice` to disclose the chosen
   object and hidden/manual boundaries in the website. The actual mesh is clipped
   at this region; unobserved walls are not invented.
5. With existing site service credentials in `SUPABASE_URL` and
   `SUPABASE_SERVICE_KEY`, publish the separate reviewed artifact:

   ```sh
   python tools/photogrammetry/publish.py /absolute/result/reconstruction.v1.json
   ```

   The publisher checks scan status, frame count and SHA-256 of canonical source
   JSON and downloads the result to verify the round trip. Each result is also
   archived by content hash under `reconstructions/`. Replacing a reviewed result
   requires `--replace-reviewed` and the exact same source fingerprint; the old
   version is archived before switching the live artifact.
   It does not change `scans`, `analyses`, source photographs or ARKit caches.
   Rollback: remove **only** that scan's `reconstruction.v1.json` artifact.
6. Deploy the site changes. With the currently cached Docker images, run
   `bash deploy_cached.sh` after pulling the repository. A full page reload clears
   the frontend's session cloud cache. The server chooses reviewed photo geometry
   before `cloud.v7.json` for clients requesting `?photogrammetry=true`, and
   exposes method/photo count explicitly. Older clients retain their VIO response
   so they cannot mislabel a photo model or omit its selection/quality notices.

## What is measured

All reconstructed camera centres are aligned to ARKit capture anchors with a
proper similarity transform. At least ten cameras must register, all source
frames must match, and inconsistent maps/poses are rejected. This establishes
ARKit scale; small residuals do **not** establish independent absolute accuracy.

The ground plane is fitted near the recorded ground. Worker revision 2 samples
uniform 10 cm horizontal areas of the mesh instead of its vertices: rough
surfaces have more triangles and must not receive more weight just because of
mesh tessellation. `--ground-sampling vertices` reproduces revision 1.
A height integral uses the upper mesh intersection at each horizontal XZ cell (Y is up). The target
is the elevated connected component nearest the recorded camera-gaze centre.
There is no harmonic interpolation of empty cells. Three discretisations are
compared; missing inner cells, truncated ROIs, insufficient ground and unstable
results stop export. Thresholds are conservative engineering gates, not calibrated
confidence bounds. Manual review is required because unobserved or automatically
closed surfaces can still look complete. The photo mesh itself is displayed,
including its vertical walls, instead of smoothing it back into a pile.

The result is an **external envelope above the chosen ground**, including gaps,
packaging and (for pallets) the base. It is not net material volume. Ground ±2 cm
is reported as a sensitivity scenario, not total uncertainty. Camera positions,
base choice, reconstruction error and coverage remain separate error sources.
Hidden material below ground cannot be recovered from these photographs.

`reconstruction.v1.json` is a private per-scan storage artifact, not a new analysis
row: existing failed/completed DUSt3R statuses are not relabelled.

## Verification

```sh
python tools/photogrammetry/test_measure.py
python backend/tests/test_reconstruction.py
node --test frontend/tests/*.test.js
```

The worker tests use exact boxes/tilted ground, missing roofs, disconnected
neighbours, known camera transformations and degenerate trajectories. They verify
numerical behaviour, not real-world measurement accuracy.
