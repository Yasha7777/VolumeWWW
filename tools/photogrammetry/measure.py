"""Offline photo mesh -> metres -> height integral. Requires numpy/scipy.

No supplier values, title parsing, harmonic filling or scale from ARKit points.
Camera centres establish metric scale. A reviewed target/ground is still needed.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from app.reconstruction import validate_reconstruction
from app.scan_inputs import geometry_report


def similarity(P, Q):
    p, q = P.mean(0), Q.mean(0)
    X, Y = P - p, Q - q
    if np.linalg.matrix_rank(X, tol=1e-6) < 2:
        raise ValueError('Camera path is degenerate')
    u, z, vt = np.linalg.svd(X.T @ Y)
    sign = np.ones(3)
    if np.linalg.det(u @ vt) < 0:
        sign[-1] = -1
    rotation = u @ np.diag(sign) @ vt
    scale = (z * sign).sum() / np.square(X).sum()
    return scale, rotation, q - p @ rotation * scale


def align(poses, scan):
    frames = {int(f['index']): f for f in scan['frames']}
    anchors = {int(f['index']): f['transform'] for f in scan.get('capture', {}).get('anchors', [])}
    P, Q, indices = [], [], []
    # RealityKit's dictionary iteration order is not capture order.
    for row in sorted(poses, key=lambda row: int(Path(row['file']).stem)):
        i = int(Path(row['file']).stem)
        if i in frames:
            P.append(row['translation'])
            Q.append(np.array(anchors.get(i, frames[i]['cameraTransform']))[12:15])
            indices.append(i)
    if len(set(indices)) != len(frames) or len(indices) != len(frames):
        raise ValueError('Every original camera must register exactly once')
    P, Q = np.array(P), np.array(Q)
    rng = np.random.default_rng(2026)
    best = np.zeros(len(P), bool)
    for _ in range(500):
        idx = rng.choice(len(P), min(5, len(P)), replace=False)
        try:
            s, R, t = similarity(P[idx], Q[idx])
        except ValueError:
            continue
        keep = np.linalg.norm(P @ R * s + t - Q, axis=1) < .15
        if keep.sum() > best.sum():
            best = keep
    if best.sum() != len(P):
        raise ValueError('Some camera poses disagree with ARKit; manual geometry audit required')
    s, R, t = similarity(P[best], Q[best])
    errors = np.linalg.norm(P @ R * s + t - Q, axis=1)
    if np.quantile(errors, .95) > .10:
        raise ValueError('Camera fit exceeds 10 cm; this is a rejection gate, not an accuracy bound')
    return s, R, t, Q, errors


def fit_ground(vertices, gaze, seed, radius, faces=None):
    d = np.linalg.norm(vertices[:, [0, 2]] - gaze, axis=1)
    h = vertices[:, 1] - np.c_[vertices[:, 0], vertices[:, 2], np.ones(len(vertices))] @ seed
    ground = vertices[(d < radius) & (np.abs(h) < .15)]
    if faces is not None:
        # Mesh vertices are denser on rough objects than on flat ground. Sample
        # equal horizontal area instead of letting tessellation choose the base.
        step = .10
        lo = gaze-radius
        heights = rasterize(vertices, faces, seed, lo, radius*2, step)
        iz, ix = np.nonzero(np.isfinite(heights) & (np.abs(heights) < .15))
        xz = np.c_[lo[0]+(ix+.5)*step, lo[1]+(iz+.5)*step]
        y = heights[iz,ix] + np.c_[xz,np.ones(len(xz))] @ seed
        ground = np.c_[xz[:,0],y,xz[:,1]]
        ground = ground[np.linalg.norm(xz-gaze,axis=1) < radius]
    if len(ground) < 100:
        raise ValueError('Insufficient reconstructed ground')
    X = np.c_[ground[:, 0], ground[:, 2], np.ones(len(ground))]
    keep = np.ones(len(X), bool)
    for _ in range(5):
        coef = np.linalg.lstsq(X[keep], ground[keep, 1], rcond=None)[0]
        residual = ground[:, 1] - X @ coef
        sigma = np.median(np.abs(residual[keep])) * 1.4826
        keep = np.abs(residual) < max(.025, 2.5 * sigma)
    delta = ground[keep][:, [0, 2]] - gaze
    sectors = np.unique(np.floor((np.arctan2(delta[:, 1], delta[:, 0]) + np.pi) / (np.pi / 4)).astype(int) % 8)
    if len(sectors) < 6 or sigma > .04:
        raise ValueError('Ground is uneven or insufficiently observed around target')
    return coef, {'sigma_m': float(sigma), 'samples': int(keep.sum()), 'sectors': len(sectors), 'sampling': 'area_grid_10cm' if faces is not None else 'mesh_vertices'}


def rasterize(vertices, faces, plane, lo, span, cell):
    side = int(np.ceil(span / cell))
    heights = vertices[:, 1] - np.c_[vertices[:, 0], vertices[:, 2], np.ones(len(vertices))] @ plane
    H = np.full((side, side), np.nan)
    for face in faces:
        p, h = vertices[face][:, [0, 2]], heights[face]
        if np.any(p.max(0) < lo) or np.any(p.min(0) > lo + span) or max(h) < -.1:
            continue
        d = (p[1, 1]-p[2, 1])*(p[0, 0]-p[2, 0]) + (p[2, 0]-p[1, 0])*(p[0, 1]-p[2, 1])
        if abs(d) < 1e-10:
            continue
        mn = np.maximum(0, np.floor((p.min(0)-lo)/cell).astype(int))
        mx = np.minimum(side-1, np.floor((p.max(0)-lo)/cell).astype(int))
        if np.any(mx < mn):
            continue
        zz, xx = np.mgrid[mn[1]:mx[1]+1, mn[0]:mx[0]+1]
        x, z = lo[0]+(xx+.5)*cell, lo[1]+(zz+.5)*cell
        u = ((p[1, 1]-p[2, 1])*(x-p[2, 0])+(p[2, 0]-p[1, 0])*(z-p[2, 1]))/d
        v = ((p[2, 1]-p[0, 1])*(x-p[2, 0])+(p[0, 0]-p[2, 0])*(z-p[2, 1]))/d
        w = 1-u-v
        ok = (u >= -1e-7) & (v >= -1e-7) & (w >= -1e-7)
        hcell = u*h[0]+v*h[1]+w*h[2]
        idx = (zz[ok], xx[ok])
        H[idx] = np.fmax(H[idx], hcell[ok])
    return H


def target_mask(H, cell, seeds=None):
    labels, n = ndimage.label(np.isfinite(H) & (H > .07))
    centers = [np.array(H.shape) // 2] if seeds is None else seeds
    candidates = []
    for i in range(1, n+1):
        coords = np.array(np.nonzero(labels == i)).T
        if len(coords)*cell*cell >= .05:
            candidates.append((coords, i))
    if not candidates:
        raise ValueError('No object above ground')
    selected = set()
    for center in centers:
        selected.add(min((np.linalg.norm((coords-center)*cell, axis=1).min(), i) for coords,i in candidates)[1])
    mask = np.isin(labels, list(selected))
    if mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any():
        raise ValueError('Target touches ROI boundary; select a larger ROI')
    holes = ndimage.binary_fill_holes(mask) & ~mask
    # A finite low spot is observed geometry, not a missing roof.
    missing = holes & ~np.isfinite(H)
    ring = ndimage.binary_dilation(mask) & ~mask
    if missing.sum() * cell*cell > .005 or ((ring & ~np.isfinite(H)).sum() / max(ring.sum(), 1)) > .05:
        raise ValueError('Mesh is missing the top or target boundary; no filling is permitted')
    return mask


def convex_polygon(polygon):
    P=np.asarray(polygon,float)
    if P.ndim != 2 or P.shape[1] != 2 or len(P)<3 or not np.isfinite(P).all():
        raise ValueError('Invalid footprint polygon')
    edge=np.roll(P,-1,axis=0)-P
    turns=edge[:,0]*np.roll(edge,-1,axis=0)[:,1]-edge[:,1]*np.roll(edge,-1,axis=0)[:,0]
    if (turns>1e-9).all():return P
    if (turns<-1e-9).all():return P[::-1]
    raise ValueError('Footprint must be strictly convex')


def polygon_mask(shape, lo, cell, polygon):
    P=convex_polygon(polygon)
    z,x=np.indices(shape)
    X=lo[0]+(x+.5)*cell;Z=lo[1]+(z+.5)*cell
    M=np.ones(shape,bool)
    for a,b in zip(P,np.roll(P,-1,axis=0)):
        e=b-a;M &= e[0]*(Z-a[1])-e[1]*(X-a[0]) >= -1e-9
    return M


def clip_mesh(vertices, faces, polygon):
    P=convex_polygon(polygon);out=[];triangles=[];lookup={}
    for face in faces:
        poly=list(vertices[face])
        for a,b in zip(P,np.roll(P,-1,axis=0)):
            edge=b-a
            def side(v):return edge[0]*(v[2]-a[1])-edge[1]*(v[0]-a[0])
            clipped=[]
            if not poly:break
            prev=poly[-1];ds=side(prev)
            for curr in poly:
                de=side(curr)
                if (ds>=0)!=(de>=0):clipped.append(prev+(curr-prev)*(ds/(ds-de)))
                if de>=0:clipped.append(curr)
                prev,ds=curr,de
            poly=clipped
        if len(poly)<3:continue
        ids=[]
        for vertex in poly:
            key=tuple(np.round(vertex,9))
            if key not in lookup:lookup[key]=len(out);out.append(vertex)
            ids.append(lookup[key])
        for i in range(1,len(ids)-1):
            face=[ids[0],ids[i],ids[i+1]]
            if len(set(face))==3:triangles.append(face)
    if not triangles:raise ValueError('No mesh in selected footprint')
    return np.asarray(out),np.asarray(triangles,int)


def dimensions(mask, lo, cell):
    z, x = np.nonzero(mask)
    xz = np.c_[lo[0]+(x+.5)*cell, lo[1]+(z+.5)*cell]
    best = None
    for angle in np.linspace(0, np.pi/2, 361):
        R = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
        size = np.ptp(xz @ R, axis=0) + cell
        if best is None or size.prod() < best[0]:
            best = size.prod(), size
    return sorted(best[1].tolist(), reverse=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('folder', type=Path)
    p.add_argument('--scan', type=Path, required=True)
    p.add_argument('--scan-id', required=True)
    p.add_argument('--seed-cloud', type=Path, required=True)
    p.add_argument('--roi-radius', type=float, default=2.5)
    p.add_argument('--target-polygon', type=Path, help='Reviewed convex footprint in XZ metres; separates touching objects')
    p.add_argument('--target-description', default='')
    p.add_argument('--quality-notice', default='')
    p.add_argument('--ground-sampling', choices=['area','vertices'], default='area')
    p.add_argument('--target-seeds', type=Path, help='Explicit XZ metre coordinates of separate objects to sum; inspect each object first')
    p.add_argument('--reviewed', action='store_true', help='Only after inspecting source photos, ground, segmentation and model')
    args = p.parse_args()
    scan = json.loads(args.scan.read_text())
    if geometry_report(scan)['blocked']:
        raise ValueError('ARKit map discontinuity: metric reconstruction needs a separate coordinate audit')
    old = json.loads(args.seed_cloud.read_text())['surface']
    gaze = np.array(old['debug']['gaze'])
    seed = np.array([old['plane'][k] for k in ('a', 'b', 'c')])
    poses = json.loads((args.folder / 'poses.json').read_text())
    s, R, t, cameras, errors = align(poses, scan)
    mesh = json.loads((args.folder / 'mesh.json').read_text())
    V, F = np.array(mesh['vertices']) @ R*s+t, np.array(mesh['faces'], int)
    ground, ground_info = fit_ground(V, gaze, seed, args.roi_radius, faces=F if args.ground_sampling == 'area' else None)
    lo, span = gaze-args.roi_radius, args.roi_radius*2
    target_seeds = json.loads(args.target_seeds.read_text()) if args.target_seeds else None
    if target_seeds is not None:
        target_seeds = np.asarray(target_seeds, float)
        if target_seeds.ndim != 2 or target_seeds.shape[1] != 2 or not len(target_seeds) or not np.isfinite(target_seeds).all():
            raise ValueError('Target seeds must be finite XZ metre pairs')
        if np.any(target_seeds <= lo) or np.any(target_seeds >= lo+span):
            raise ValueError('Target seeds outside ROI')
    polygon = json.loads(args.target_polygon.read_text()) if args.target_polygon else None
    if polygon is not None:
        polygon = convex_polygon(polygon).tolist()
        if target_seeds is not None:
            raise ValueError('Choose a polygon or component seeds, not both')
        if np.any(np.array(polygon) <= lo) or np.any(np.array(polygon) >= lo+span):
            raise ValueError('Selection extends outside reconstruction ROI')
    checks = []
    for cell in (.02, .04, .08):
        heights = rasterize(V, F, ground, lo, span, cell)
        pixel_seeds = None if target_seeds is None else ((target_seeds-lo)/cell-.5)[:, ::-1]
        if polygon is None:
            mask = target_mask(heights, cell, pixel_seeds)
        else:
            selection = polygon_mask(heights.shape, lo, cell, polygon)
            if np.any(selection & ~np.isfinite(heights)):
                raise ValueError('Selected object has missing surface')
            mask = selection & (heights > .07)
            if not mask.any():
                raise ValueError('No elevated target in selection')
        volume = float(heights[mask].sum()*cell*cell)
        checks.append({'cell_m': cell, 'volume_m3': volume})
        if cell == .04:
            H, M = heights, mask
    if (max(c['volume_m3'] for c in checks)-min(c['volume_m3'] for c in checks)) / checks[1]['volume_m3'] > .05:
        raise ValueError('Volume depends too strongly on grid size')
    cell = .04
    volume = float(H[M].sum()*cell*cell)
    area = float(M.sum()*cell*cell)
    z, x = np.nonzero(M)
    center = lo+np.array([x.mean()+.5, z.mean()+.5])*cell
    size = dimensions(M, lo, cell)
    # Keep the real triangular surface in and immediately around the target.
    ctr = V[F].mean(1)
    ixz = np.floor((ctr[:, [0, 2]]-lo)/cell).astype(int)
    in_grid = (ixz >= 0).all(1) & (ixz < H.shape[::-1]).all(1)
    dilated = ndimage.binary_dilation(M, iterations=2)
    selected = np.zeros(len(F), bool)
    selected[in_grid] = dilated[ixz[in_grid, 1], ixz[in_grid, 0]]
    selected &= ctr[:, 1] - np.c_[ctr[:, 0], ctr[:, 2], np.ones(len(ctr))] @ ground >= -.025
    faces = F[selected]
    used, inverse = np.unique(faces, return_inverse=True)
    pv = V[used]
    display_faces = inverse.reshape(-1,3)
    if polygon is not None:
        pv, display_faces = clip_mesh(pv, display_faces, polygon)
    # Point view is also from this reconstruction, not unrelated VIO features.
    keep_points = np.linspace(0, len(pv)-1, min(6000, len(pv))).astype(int)
    points = pv[keep_points]
    idx = np.floor((points[:, [0, 2]]-lo)/cell).astype(int)
    valid = (idx >= 0).all(1) & (idx < H.shape[::-1]).all(1)
    pile = np.zeros(len(points), int)
    pile[valid] = M[idx[valid, 1], idx[valid, 0]].astype(int)
    hull = [lo.tolist(), (lo+[span, 0]).tolist(), (lo+[span, span]).tolist(), (lo+[0, span]).tolist()]
    surface = {
        'plane': dict(zip(('a', 'b', 'c'), ground.tolist()), source='photo_mesh'),
        'center': center.tolist(), 'R': max(size)*1.2, 'hull': hull,
        'grid': {'nx': H.shape[1], 'nz': H.shape[0], 'cell': cell, 'x0': float(lo[0]+cell/2), 'z0': float(lo[1]+cell/2),
                 'h': np.where(M, np.round(np.nan_to_num(H)*100, 2), -1).ravel().tolist()},
        'mesh': {'vertices': np.round(pv, 6).tolist(), 'faces': display_faces.tolist()},
        'volume': volume, 'range': [max(0., volume-area*.02), volume+area*.02],
        'area': area, 'top': float(np.quantile(H[M], .99)), 'size': size,
        'closed': bool(old.get('closed')), 'support': None, 'foot': None,
    }
    meta = {'scan_id': args.scan_id, 'reviewed': args.reviewed, 'method': 'photogrammetry_arkit_scale',
            'created_at': datetime.now(timezone.utc).isoformat(), 'source_sha256': hashlib.sha256(json.dumps(scan, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest(),
            'photo_count': len(scan['frames']), 'aligned_cameras': len(cameras), 'camera_p95_m': float(np.quantile(errors, .95)),
            'camera_rms_m': float(np.sqrt(np.mean(errors**2))), 'scale_to_arkit_m': float(s),
            'ground': ground_info, 'grid_checks': checks, 'base_sensitivity_m': .02,
            'worker_revision': 2, 'target_polygon_m': polygon, 'target_description': args.target_description, 'quality_notice': args.quality_notice,
            'target_seeds_m': None if target_seeds is None else target_seeds.tolist(),
            'roi_radius_m': args.roi_radius, 'ground_seed': seed.tolist(), 'gaze': gaze.tolist()}
    cloud = {'schema_version': 1, 'reconstruction': meta, 'surface': surface,
             'points': np.round(points, 6).tolist(), 'cameras': cameras.tolist(), 'pile': pile.tolist(),
             'points_source': 'photogrammetry', 'geometry_warning': None, 'estimation_warning': None}
    if args.reviewed:
        validate_reconstruction(cloud, args.scan_id)
    (args.folder/'reconstruction.v1.json').write_text(json.dumps(cloud, ensure_ascii=False, allow_nan=False))
    np.savez(args.folder/'review_heightfield.npz', H=H, mask=M, lo=lo, cell=cell)
    print(json.dumps({'volume': volume, 'size': size, 'top': surface['top'], 'ground': ground_info, 'checks': checks,
                      'camera_rms_m': meta['camera_rms_m'], 'reviewed': args.reviewed}, indent=2))


if __name__ == '__main__':
    main()
