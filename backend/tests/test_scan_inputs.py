"""Capture-to-GPU contract checks; no live database or GPU calls."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.scan_inputs import ScanInputError, geometry_report, prepare, store_prepared


def fixture(n=20):
    pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    K = [3000, 0, 0, 0, 3000, 0, 2016, 1512, 1]
    frames = [{"index": i, "file": f"{i:03d}.jpg", "timestamp": 10.0 + i,
               "width": 4032, "height": 3024, "cameraTransform": pose[:], "intrinsics": K[:],
               "trackingSegment": 0, "trackingState": "normal",
               "featurePointIdentifiers": list(range(9007199254740993, 9007199254740993 + n)),
               "featurePoints": [v for j in range(n) for v in [j * 0.1, 0.5, -2]],
               "featurePointCount": n} for i in range(2)]
    d = {"ids": frames[0]["featurePointIdentifiers"][:], "count": [20] * n,
         "baselineMm": [300] * n, "spreadMm": [10] * n, "segment": [0] * n}
    scan = {"id": "scan-1", "frameCount": 2, "frames": frames, "capture": {"densePoints": d}}
    rows = [{"id": f"photo-{f['index']}", "frame_index": f["index"], "filename": f["file"],
             "arkit": {k: deepcopy(f[k]) for k in ["cameraTransform", "intrinsics", "timestamp"]}} for f in frames]
    return scan, rows


class PreparationTests(unittest.TestCase):
    def test_qualifies_points_without_changing_coordinates_poses_or_original(self):
        scan, rows = fixture()
        scan["capture"]["densePoints"]["spreadMm"][0] = 400
        original, original_rows = deepcopy(scan), deepcopy(rows)
        derived, copied_rows, report = prepare(scan, rows)
        self.assertEqual(scan, original)
        self.assertEqual(rows, original_rows)
        self.assertEqual(derived["frames"][0]["featurePoints"], scan["frames"][0]["featurePoints"][3:])
        self.assertEqual(derived["frames"][0]["cameraTransform"], scan["frames"][0]["cameraTransform"])
        self.assertEqual(copied_rows[0]["arkit"]["intrinsics"], scan["frames"][0]["intrinsics"])
        self.assertEqual(report["counts"]["dense_rejected"], 2)
        self.assertNotIn("capture", derived)

    def test_single_photo_landmark_supported_by_high_rate_recording_survives(self):
        scan, rows = fixture()
        scan["frames"][1]["featurePoints"] = []
        scan["frames"][1]["featurePointIdentifiers"] = []
        derived, _, report = prepare(scan, rows)
        self.assertEqual(derived["frames"][0]["featurePointCount"], 20)
        self.assertEqual(report["counts"]["dense_supported"], 20)

    def test_missing_or_malformed_dense_keeps_legacy_points(self):
        for capture in [{}, {"densePoints": {"ids": [1], "count": []}}]:
            scan, rows = fixture()
            scan["capture"] = capture
            derived, _, report = prepare(scan, rows)
            self.assertEqual(derived["frames"][0]["featurePoints"], scan["frames"][0]["featurePoints"])
            self.assertEqual(report["counts"]["unassessed_kept"], 40)

    def test_unknown_dense_id_is_kept_not_invented(self):
        scan, rows = fixture()
        scan["capture"]["densePoints"]["ids"][0] = 123
        derived, _, report = prepare(scan, rows)
        self.assertEqual(report["counts"]["unassessed_kept"], 2)
        self.assertEqual(derived["frames"][0]["featurePointCount"], 20)

    def test_maximum_baseline_preserves_returning_tracks(self):
        scan, rows = fixture()
        d = scan["capture"]["densePoints"]
        d["baselineMm"] = [0] * 20
        d["maxBaselineMm"] = [300] * 20
        self.assertEqual(prepare(scan, rows)[2]["counts"]["dense_supported"], 40)

    def test_short_history_does_not_erase_valid_starting_points(self):
        scan, rows = fixture()
        scan["capture"]["densePoints"]["baselineMm"] = [3] * 20
        derived, _, report = prepare(scan, rows)
        self.assertEqual(derived["frames"][0]["featurePointCount"], 20)
        self.assertEqual(report["counts"]["unassessed_kept"], 40)

    def test_safe_integer_remap_preserves_landmark_identity(self):
        scan, rows = fixture()
        d, _, _ = prepare(scan, rows)
        ids = d["frames"][0]["featurePointIdentifiers"]
        self.assertEqual(ids, list(range(1, 21)))
        self.assertEqual(ids, d["frames"][1]["featurePointIdentifiers"])

    def test_frame_order_and_subset_match_selected_photos(self):
        scan, rows = fixture()
        d, prepared_rows, _ = prepare(scan, rows[::-1])
        self.assertEqual([f["index"] for f in d["frames"]], [1, 0])
        self.assertEqual([r["id"] for r in prepared_rows], ["photo-1", "photo-0"])
        d, _, _ = prepare(scan, rows[:1])
        self.assertEqual([f["index"] for f in d["frames"]], [0])

    def test_mismatched_pose_or_time_is_not_silently_used(self):
        for field in ["cameraTransform", "intrinsics", "timestamp"]:
            scan, rows = fixture()
            if field == "timestamp":
                rows[0]["arkit"][field] += 0.1
            else:
                rows[0]["arkit"][field][0] += 0.1
            with self.assertRaises(ScanInputError):
                prepare(scan, rows)

    def test_duplicate_and_absent_frame_indexes_fail(self):
        scan, rows = fixture()
        for bad_rows in [rows + rows[:1], [{**rows[0], "frame_index": 999}]]:
            with self.assertRaises(ScanInputError):
                prepare(scan, bad_rows)

    def test_multiple_namespaces_do_not_reach_fixed_pose_gpu(self):
        scan, rows = fixture()
        scan["capture"]["frameEpochs"] = [0, 1]
        with self.assertRaises(ScanInputError):
            prepare(scan, rows)

    def test_loss_of_coverage_is_reported_instead_of_silently_pruning(self):
        scan, rows = fixture()
        scan["capture"]["densePoints"]["spreadMm"] = [500] * 20
        with self.assertRaisesRegex(ScanInputError, "четверти"):
            prepare(scan, rows)

    def test_malformed_epoch_alignment_cannot_silently_mix_points(self):
        scan, rows = fixture()
        scan["capture"]["frameEpochs"] = [0]
        with self.assertRaises(ScanInputError):
            prepare(scan, rows)

    def test_source_scan_identity_is_verified_before_upload(self):
        scan, rows = fixture()
        storage = Mock()
        storage.download.return_value = json.dumps(scan).encode()
        with self.assertRaises(ScanInputError):
            store_prepared(storage, {"id": "different-scan", "storage_prefix": "scans/s"}, rows, "a")
        storage.upload.assert_not_called()

    def test_derivative_uploaded_separately_and_source_is_not_overwritten(self):
        scan, rows = fixture()
        storage = Mock()
        storage.download.return_value = json.dumps(scan).encode()
        meta, copied, report = store_prepared(storage, {"id": "scan-1", "storage_prefix": "scans/s"}, rows, "analysis-1")
        path, raw, options = storage.upload.call_args.args
        self.assertTrue(path.startswith("scans/s/prepared/v1/analysis-1/"))
        self.assertEqual(meta["prepared_scan_json_path"], path)
        self.assertEqual(json.loads(raw)["preparation"], report)
        self.assertEqual(copied[0]["id"], rows[0]["id"])
        storage.download.assert_called_once_with("scans/s/scan.json")

    def test_download_and_upload_failure_never_fall_back_to_unchecked_input(self):
        scan, rows = fixture()
        storage = Mock()
        storage.download.side_effect = OSError("offline")
        with self.assertRaises(ScanInputError):
            store_prepared(storage, {"storage_prefix": "scans/s"}, rows, "a")
        storage.upload.assert_not_called()
        storage.download.side_effect = None
        storage.download.return_value = json.dumps(scan).encode()
        storage.upload.side_effect = OSError("offline")
        with self.assertRaises(ScanInputError):
            store_prepared(storage, {"storage_prefix": "scans/s"}, rows, "a")


class GeometryTests(unittest.TestCase):
    def scan(self, step, dt_ms=33):
        scan, _ = fixture()
        scan["capture"]["trajectory"] = {"tMs": [0, dt_ms], "positionMm": [0, 0, 0, step, 0, 0]}
        return scan

    def test_severe_short_interval_jump_blocks_but_preserves_input(self):
        scan = self.scan(3000)
        before = deepcopy(scan)
        self.assertTrue(geometry_report(scan)["blocked"])
        with self.assertRaisesRegex(ScanInputError, "скачок"):
            prepare(scan, fixture()[1])
        self.assertEqual(scan, before)

    def test_moderate_change_is_diagnostic_only(self):
        report = geometry_report(self.scan(410))
        self.assertFalse(report["blocked"])
        self.assertEqual(len(report["events"]), 1)

    def test_normal_motion_and_long_gaps_are_not_map_jumps(self):
        self.assertFalse(geometry_report(self.scan(40))["events"])
        self.assertFalse(geometry_report(self.scan(3000, 5000))["events"])

    def test_recorded_jump_is_checked_without_full_trajectory(self):
        scan, _ = fixture()
        scan["capture"]["mapEvents"] = [{"kind": "translationJump", "severe": True}]
        self.assertTrue(geometry_report(scan)["blocked"])


if __name__ == "__main__":
    unittest.main()
