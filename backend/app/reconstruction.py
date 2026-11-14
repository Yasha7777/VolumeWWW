"""Reviewed photo reconstructions, stored separately from ARKit source/cache.

These are external-shape estimates at ARKit scale, not certified measurements.
An offline Mac worker produces them; the web server never runs RealityKit.
"""
import math


ARTIFACT_NAME = "reconstruction.v1.json"


def validate_reconstruction(data, scan_id):
    """Fail closed on incomplete, mismatched or malformed worker output."""
    def finite(v):
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)

    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise ValueError("Unsupported reconstruction schema")
    meta = data.get("reconstruction") or {}
    if not isinstance(meta, dict):
        raise ValueError("Invalid provenance")
    if meta.get("scan_id") != scan_id or meta.get("reviewed") is not True:
        raise ValueError("Reconstruction is not reviewed for this scan")
    digest = meta.get("source_sha256", "")
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("Missing source fingerprint")
    if meta.get("method") != "photogrammetry_arkit_scale" or not meta.get("created_at"):
        raise ValueError("Missing reconstruction provenance")
    count, aligned = meta.get("photo_count", 0), meta.get("aligned_cameras", 0)
    if not isinstance(count, int) or not isinstance(aligned, int) or count < 10 or aligned != count:
        raise ValueError("Incomplete camera registration")
    residual = meta.get("camera_p95_m")
    if not finite(residual) or not 0 <= residual <= .10:
        raise ValueError("Camera alignment is inconsistent")
    surface = data.get("surface") or {}
    if not isinstance(surface, dict):
        raise ValueError("Invalid surface")
    for key in ("volume", "area", "top", "R"):
        if not finite(surface.get(key)) or surface[key] <= 0:
            raise ValueError("Invalid surface dimensions")
    for key in ("size", "center", "range"):
        if len(surface.get(key, [])) != 2 or not all(finite(v) for v in surface[key]):
            raise ValueError("Invalid surface bounds")
    if not 0 <= surface["range"][0] <= surface["volume"] <= surface["range"][1]:
        raise ValueError("Invalid sensitivity range")
    plane = surface.get("plane") or {}
    if not all(finite(plane.get(k)) for k in ("a", "b", "c")):
        raise ValueError("Invalid ground plane")
    grid = surface.get("grid") or {}
    nx, nz = grid.get("nx"), grid.get("nz")
    if not isinstance(nx, int) or not isinstance(nz, int) or not 2 <= nx <= 512 or not 2 <= nz <= 512:
        raise ValueError("Invalid grid dimensions")
    if not all(finite(grid.get(k)) for k in ("cell", "x0", "z0")) or grid["cell"] <= 0:
        raise ValueError("Invalid grid coordinates")
    if len(grid.get("h", [])) != nx * nz or not all(finite(v) and v >= -1 for v in grid["h"]):
        raise ValueError("Invalid grid heights")
    for key, minimum in (("points", 1), ("cameras", 10)):
        rows = data.get(key, [])
        if not minimum <= len(rows) <= 100000 or not all(len(p) == 3 and all(finite(v) for v in p) for p in rows):
            raise ValueError("Invalid point coordinates")
    if len(data.get("pile", [])) != len(data["points"]):
        raise ValueError("Invalid point mask")
    hull = surface.get("hull", [])
    if len(hull) < 3 or not all(len(p) == 2 and all(finite(v) for v in p) for p in hull):
        raise ValueError("Invalid ground boundary")
    mesh = surface.get("mesh") or {}
    vertices, faces = mesh.get("vertices", []), mesh.get("faces", [])
    if not 3 <= len(vertices) <= 100000 or not 1 <= len(faces) <= 200000:
        raise ValueError("Missing reconstructed mesh")
    if not all(len(p) == 3 and all(finite(v) for v in p) for p in vertices):
        raise ValueError("Invalid mesh coordinates")
    if not all(len(f) == 3 and all(isinstance(i, int) and 0 <= i < len(vertices) for i in f) for f in faces):
        raise ValueError("Invalid mesh indices")
    if data.get("geometry_warning") or data.get("estimation_warning"):
        raise ValueError("Unresolved geometry warning")
    return data
