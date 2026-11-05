"""Exercise actual run_and_save with fake storage/DB/HTTP; never contacts production."""
import importlib
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_scan_inputs import fixture


class DispatchTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        config, client = ModuleType("app.config"), ModuleType("app.supabase_client")
        config.settings = SimpleNamespace()
        client.supabase = Mock()
        with patch.dict(sys.modules, {"app.config": config, "app.supabase_client": client}):
            cls.gpu = importlib.import_module("app.gpu")

    def setUp(self):
        self.scan, self.rows = fixture()
        self.storage = Mock()
        self.storage.download.return_value = json.dumps(self.scan).encode()
        self.db = Mock()
        self.db.storage.from_.return_value = self.storage
        self.submit = AsyncMock(return_value={"status": "success"})
        self.patches = [
            patch.object(self.gpu, "supabase", self.db),
            patch.object(self.gpu, "load_gpu_settings", return_value={"url": "http://gpu.invalid/run", "mode": "vio", "token": ""}),
            patch.object(self.gpu, "_submit_and_wait", self.submit),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)
        self.photos = [{"id": r["id"], "exif": {}} for r in self.rows]
        self.meta = {"id": "scan-1", "storage_prefix": "scans/s"}

    async def test_prepared_path_and_matching_poses_reach_receiver(self):
        await self.gpu.run_and_save("analysis-1", self.photos, {}, self.meta, self.rows[::-1])
        self.submit.assert_awaited_once()
        payload = self.submit.call_args.args[1]
        self.assertEqual(payload["photo_ids"], [r["id"] for r in self.rows])
        self.assertEqual(payload["scan"]["scan_json_path"], self.storage.upload.call_args.args[0])
        self.assertIn("/prepared/v1/analysis-1/", payload["scan"]["scan_json_path"])
        self.assertEqual(payload["frames"][0]["arkit"]["cameraTransform"], self.scan["frames"][0]["cameraTransform"])
        self.assertIs(payload["wait"], False)

    async def test_jump_prevents_gpu_request_but_does_not_mutate_source(self):
        self.scan["capture"]["trajectory"] = {"tMs": [0, 33], "positionMm": [0, 0, 0, 3000, 0, 0]}
        self.storage.download.return_value = json.dumps(self.scan).encode()
        await self.gpu.run_and_save("analysis-1", self.photos, {}, self.meta, self.rows)
        self.submit.assert_not_awaited()
        self.storage.upload.assert_not_called()
        update = self.db.table.return_value.update.call_args.args[0]
        self.assertEqual(update["status"], "error")
        self.assertIn("скачок", update["result"])

    async def test_failed_upload_never_submits_raw_fallback(self):
        self.storage.upload.side_effect = OSError("offline")
        await self.gpu.run_and_save("analysis-1", self.photos, {}, self.meta, self.rows)
        self.submit.assert_not_awaited()
        self.assertEqual(self.db.table.return_value.update.call_args.args[0]["status"], "error")

    async def test_mismatched_photo_lists_do_not_reach_receiver(self):
        await self.gpu.run_and_save("analysis-1", self.photos, {}, self.meta, self.rows[:1])
        self.submit.assert_not_awaited()
        self.storage.download.assert_not_called()

    async def test_plain_photo_upload_keeps_existing_behavior(self):
        await self.gpu.run_and_save("analysis-1", self.photos, {})
        self.submit.assert_awaited_once()
        self.storage.download.assert_not_called()
        self.assertNotIn("scan", self.submit.call_args.args[1])

    async def test_partial_gpu_result_keeps_warning_with_volume(self):
        self.submit.return_value = {
            "status": "partial", "volume_m3": 1.6885,
            "error_message": "точность объёма ±25%; 61% периметра обрезано",
        }
        await self.gpu.run_and_save("analysis-1", self.photos, {})
        saved = self.db.table.return_value.update.call_args.args[0]
        self.assertEqual(saved["status"], "completed")  # три допустимых статуса analyses
        self.assertTrue(saved["result"].startswith("Расчёт gottland.ru"))
        self.assertIn("⚠️ ОГРАНИЧЕННАЯ ТОЧНОСТЬ:", saved["result"])
        self.assertIn("61% периметра", saved["result"])
        self.assertIn("Объём DUSt3R: 1.6885 м³", saved["result"])

    async def test_unrecognized_gpu_status_is_not_reported_as_complete(self):
        self.submit.return_value = {"status": "accepted"}
        await self.gpu.run_and_save("analysis-1", self.photos, {})
        saved = self.db.table.return_value.update.call_args.args[0]
        self.assertEqual(saved["status"], "error")
        self.assertIn("без результата", saved["result"])


if __name__ == "__main__":
    unittest.main()
