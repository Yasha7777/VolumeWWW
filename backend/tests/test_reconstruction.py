import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.reconstruction import validate_reconstruction


def artifact():
    return {'schema_version':1,'reconstruction':{'scan_id':'scan','reviewed':True,
        'source_sha256':'a'*64,'method':'photogrammetry_arkit_scale','created_at':'2026-11-14T00:00:00Z',
        'photo_count':10,'aligned_cameras':10,'camera_p95_m':.02},
        'points':[[0,0,0]],'pile':[1],'cameras':[[0,1,0]]*10,
        'surface':{'volume':1.1,'area':1.,'top':1.1,'R':2.,'size':[1.,1.],'center':[0,0],
        'range':[1.08,1.12],'plane':{'a':0,'b':0,'c':0},'hull':[[0,0],[1,0],[0,1]],
        'grid':{'nx':2,'nz':2,'cell':.1,'x0':0,'z0':0,'h':[110]*4},
        'mesh':{'vertices':[[0,1.1,0],[1,1.1,0],[0,1.1,1]],'faces':[[0,1,2]]}}}


class ReconstructionTests(unittest.TestCase):
    def test_reviewed_source_retains_actual_mesh_and_volume(self):
        data=artifact()
        self.assertIs(validate_reconstruction(data,'scan'),data)

    def test_wrong_scan_or_unreviewed_never_replaces_preliminary_cloud(self):
        with self.assertRaises(ValueError):validate_reconstruction(artifact(),'another-scan')
        data=artifact();data['reconstruction']['reviewed']=False
        with self.assertRaises(ValueError):validate_reconstruction(data,'scan')

    def test_partial_registration_or_inconsistent_scale_is_not_publishable(self):
        for key,value in [('aligned_cameras',9),('camera_p95_m',.4),('source_sha256','')]:
            data=artifact();data['reconstruction'][key]=value
            with self.assertRaises(ValueError):validate_reconstruction(data,'scan')

    def test_nan_volume_missing_heights_or_bad_faces_cannot_reach_webgl(self):
        for mutate in [lambda s:s.update(volume=float('nan')),
                       lambda s:s['grid'].update(h=[]),
                       lambda s:s['mesh'].update(faces=[[0,1,200]])]:
            data=artifact();mutate(data['surface'])
            with self.assertRaises(ValueError):validate_reconstruction(data,'scan')


if __name__=='__main__':unittest.main()
