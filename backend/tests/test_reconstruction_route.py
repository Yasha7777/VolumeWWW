"""The real /cloud route must authorise first and prefer only valid artifacts."""
import importlib.util
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from test_reconstruction import artifact

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class ReconstructionRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        modules={name:ModuleType(name) for name in ['app.config','app.supabase_client','app.auth','app.routers.analyses']}
        modules['app.config'].settings=SimpleNamespace()
        modules['app.supabase_client'].supabase=Mock()
        modules['app.auth'].get_current_user=lambda:{'id':'owner'}
        analyses=modules['app.routers.analyses'];analyses.COLMAP_BUCKET='colmap'
        for key in ['_cube_block','_is_superadmin','_photo_block']:setattr(analyses,key,Mock())
        spec=importlib.util.spec_from_file_location('app.routers.scans_test',ROOT/'app/routers/scans.py')
        cls.module=importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules,modules):spec.loader.exec_module(cls.module)
        app=FastAPI();app.include_router(cls.module.router);cls.client=TestClient(app)

    def setUp(self):
        self.storage=Mock();self.db=Mock();self.db.storage.from_.return_value=self.storage
        self.owner=patch.object(self.module,'_get_scan',return_value={'id':'scan','storage_prefix':'scans/scan'})
        self.owner_mock=self.owner.start();self.addCleanup(self.owner.stop)
        patcher=patch.object(self.module,'supabase',self.db);patcher.start();self.addCleanup(patcher.stop)

    def test_photo_artifact_wins_over_cached_preliminary_volume(self):
        self.storage.download.return_value=json.dumps(artifact()).encode()
        response=self.client.get('/scans/scan/cloud')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['surface']['volume'],1.1)
        self.storage.download.assert_called_once_with('scans/scan/reconstruction.v1.json')

    def test_missing_or_unreviewed_artifact_falls_back_to_existing_cache(self):
        for first in [OSError('not found'),json.dumps(dict(artifact(),reconstruction={'reviewed':False})).encode()]:
            self.storage.download.side_effect=[first,json.dumps({'points':[[0,0,0]],'surface':None}).encode()]
            response=self.client.get('/scans/scan/cloud')
            self.assertEqual(response.status_code,200)
            self.assertIsNone(response.json()['surface'])
            self.assertTrue(self.storage.download.call_args.args[0].endswith('cloud.v7.json'))

    def test_unauthorised_scan_never_reads_reconstruction(self):
        self.owner_mock.side_effect=HTTPException(404,'Обход не найден')
        self.assertEqual(self.client.get('/scans/scan/cloud').status_code,404)
        self.storage.download.assert_not_called()


if __name__=='__main__':unittest.main()
