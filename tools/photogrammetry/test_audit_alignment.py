import copy
import unittest
import numpy as np
from audit_alignment import audit


def fixture(n=60):
    t = np.linspace(0, 5 * np.pi, n)
    P = np.c_[3 * np.cos(t), .2 * np.sin(t * .3), 3 * np.sin(t)]
    frames, poses = [], []
    for i, p in enumerate(P):
        T = np.eye(4).flatten(order='F'); T[12:15] = p * 2 + [1, 2, 3]
        frames.append({'index': i, 'cameraTransform': T.tolist()})
        poses.append({'file': f'{i:03}.jpg', 'translation': p.tolist()})
    return poses, {'frames': frames}


class AlignmentAuditTest(unittest.TestCase):
    def test_known_scale_and_translation_jump(self):
        poses, scan = fixture()
        for frame in scan['frames'][30:]:
            frame['cameraTransform'][12] += 7
        r = audit(poses, scan)['sources']['original']
        self.assertEqual(r['selected_window_count'], 4)
        np.testing.assert_allclose(r['scale_min_median_max'], [2, 2, 2], atol=1e-10)
        self.assertEqual(r['selected_camera_fraction'], 1)

    def test_variable_scale_is_not_hidden_by_local_fit(self):
        poses, scan = fixture()
        for i, frame in enumerate(scan['frames']):
            frame['cameraTransform'][12:15] = (np.array(poses[i]['translation']) * (2 if i < 30 else 2.4)).tolist()
        r = audit(poses, scan)['sources']['original']
        self.assertAlmostEqual(r['scale_max_over_min'], 1.2)
        self.assertEqual(r['selected_window_count'], 4)

    def test_gap_does_not_bridge_or_claim_full_coverage(self):
        poses, scan = fixture()
        poses = [p for i, p in enumerate(poses) if i not in range(10, 25)]
        r = audit(poses, scan)
        self.assertEqual(r['missing_frame_indices'], list(range(10, 25)))
        windows = r['sources']['original']['windows']
        self.assertEqual([(w['first_frame'], w['last_frame']) for w in windows], [(25, 39), (40, 54)])
        self.assertEqual(r['sources']['original']['selected_camera_fraction'], .5)

    def test_duplicate_and_unknown_frames_rejected(self):
        poses, scan = fixture()
        duplicate_pose = copy.deepcopy(poses[0]); duplicate_pose['translation'][0] += 1
        with self.assertRaises(ValueError): audit(poses + [duplicate_pose], scan)
        with self.assertRaises(ValueError): audit(poses + [{'file': '999.jpg', 'translation': [0,0,0]}], scan)
        duplicate = copy.deepcopy(scan); duplicate['frames'].append(duplicate['frames'][0])
        with self.assertRaises(ValueError): audit(poses, duplicate)

    def test_nonfinite_rejected(self):
        poses, scan = fixture(); poses[0]['translation'][0] = float('nan')
        with self.assertRaises(ValueError): audit(poses, scan)

    def test_collinear_windows_not_treated_as_consistent(self):
        poses, scan = fixture()
        for i, p in enumerate(poses): p['translation'] = [i,0,0]
        r = audit(poses, scan)['sources']['original']
        self.assertEqual(r['selected_window_count'], 0)
        self.assertIsNone(r['scale_max_over_min'])
        self.assertTrue(all('unusable_reason' in w for w in r['windows']))


if __name__ == '__main__': unittest.main()
