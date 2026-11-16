"""Diagnose photo/ARKit scale drift without exporting a measurement.

Non-overlapping windows distinguish local scale consistency from global map
agreement. These observations do not establish independent metric accuracy and
must never replace the production worker's camera/ground/coverage checks.
"""
import argparse
import json
from pathlib import Path

import numpy as np

from measure import similarity


def audit(poses, scan, window_size=15):
    if window_size < 4:
        raise ValueError('At least four cameras per window are required')
    frames = {}
    for frame in scan['frames']:
        index = int(frame['index'])
        if index in frames:
            raise ValueError('Duplicate source frame index')
        frames[index] = frame
    anchors = {int(a['index']): a['transform'] for a in scan.get('capture', {}).get('anchors', [])}
    indexed = sorted(((int(Path(p['file']).stem), p) for p in poses), key=lambda row: row[0])
    ids = [i for i, _ in indexed]
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate reconstructed frame index')
    if any(i not in frames for i in ids):
        raise ValueError('Reconstructed frame has no source frame')
    if not ids:
        raise ValueError('No reconstructed cameras')
    P = np.asarray([p['translation'] for _, p in indexed], dtype=float)
    if P.shape != (len(ids), 3) or not np.isfinite(P).all():
        raise ValueError('Invalid reconstructed camera centres')
    # Restart partition at each registration gap; never bridge skipped photos.
    groups = np.split(np.arange(len(ids)), np.flatnonzero(np.diff(ids) != 1) + 1)
    result = {
        'purpose': 'diagnostic_only_not_a_volume_or_accuracy_validation',
        'source_camera_count': len(frames), 'registered_camera_count': len(ids),
        'missing_frame_indices': sorted(set(frames) - set(ids)),
        'window_size': window_size, 'windows_overlap': False, 'sources': {},
    }
    for source in ('original', 'final_anchors'):
        transforms = [anchors.get(i, frames[i]['cameraTransform'])
                      if source == 'final_anchors' else frames[i]['cameraTransform'] for i in ids]
        arrays = np.asarray(transforms, dtype=float)
        if arrays.shape != (len(ids), 16) or not np.isfinite(arrays).all():
            raise ValueError('Invalid ARKit camera transforms')
        Q = arrays[:, 12:15]
        windows = []
        for group in groups:
            for offset in range(0, len(group) - window_size + 1, window_size):
                take = group[offset:offset + window_size]
                row = {'first_frame': ids[int(take[0])], 'last_frame': ids[int(take[-1])],
                       'camera_count': len(take)}
                try:
                    scale, rotation, translation = similarity(P[take], Q[take])
                    residual = np.linalg.norm(P[take] @ rotation * scale + translation - Q[take], axis=1)
                    row.update(scale=float(scale), rms_m=float(np.sqrt(np.mean(residual ** 2))),
                               extent_m=float(np.linalg.norm(np.ptp(Q[take], axis=0))))
                except ValueError as exc:
                    row['unusable_reason'] = str(exc)
                windows.append(row)
        # This filter selects well-fitted diagnostic segments, not accepted scans.
        selected = [w for w in windows if 'scale' in w and w['scale'] > 0
                    and w['rms_m'] < .05 and w['extent_m'] > 2]
        scales = np.array([w['scale'] for w in selected])
        result['sources'][source] = {
            'anchor_fallback_camera_count': sum(i not in anchors for i in ids) if source == 'final_anchors' else 0,
            'windows': windows,
            'diagnostic_filter': {'rms_below_m': .05, 'extent_above_m': 2},
            'selected_window_count': len(selected),
            'selected_camera_fraction': sum(w['camera_count'] for w in selected) / len(frames),
            'scale_min_median_max': np.quantile(scales, [0, .5, 1]).tolist() if len(scales) else None,
            'scale_max_over_min': float(scales.max() / scales.min()) if len(scales) else None,
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('result_dir', type=Path)
    parser.add_argument('--scan', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--window-size', type=int, default=15)
    args = parser.parse_args()
    result = audit(json.loads((args.result_dir / 'poses.json').read_text()),
                   json.loads(args.scan.read_text()), args.window_size)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    print(json.dumps({k: {n: v for n, v in s.items() if n != 'windows'}
                      for k, s in result['sources'].items()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
