"""Numerical regression: exact surfaces, not expected supplier volumes."""
import importlib.util
from pathlib import Path
import sys
import unittest
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'backend'))
spec = importlib.util.spec_from_file_location('measure', ROOT/'tools/photogrammetry/measure.py')
measure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measure)


def box(top=True, offset=0):
    # Ground plus 1 x 1 x 1.1 m external box; vertical faces need no extrapolation.
    V = np.array([[-2,0,-2], [2,0,-2], [2,0,2], [-2,0,2],
                  [-.5,1.1,-.5],[.5,1.1,-.5],[.5,1.1,.5],[-.5,1.1,.5]], float)
    V[:,0] += offset
    F = [[0,1,2],[0,2,3]] + ([[4,5,6],[4,6,7]] if top else [])
    return V, np.array(F)


class MeshVolumeTests(unittest.TestCase):
    def test_exact_box_grid_and_tilt_invariance(self):
        for cell in (.02,.04):
            V,F = box()
            # Ground tilt must not alter the vertical volume integral.
            V[:,1] += .06*V[:,0]-.03*V[:,2]-.8
            H = measure.rasterize(V,F,np.array([.06,-.03,-.8]),np.array([-2.,-2.]),4.,cell)
            M = measure.target_mask(H,cell)
            # 4 cm grid has an unavoidable half-cell boundary quantisation.
            self.assertAlmostEqual(float(H[M].sum()*cell*cell),1.1,delta=.1 if cell==.04 else .001)

    def test_missing_roof_has_no_volume(self):
        V,F = box(top=False)
        H = measure.rasterize(V,F,np.zeros(3),np.array([-2.,-2.]),4.,.04)
        with self.assertRaises(ValueError):
            measure.target_mask(H,.04)

    def test_missing_central_surface_is_not_filled(self):
        H = np.zeros((40,40)); H[10:30,10:30]=1.1; H[17:23,17:23]=np.nan
        with self.assertRaises(ValueError):
            measure.target_mask(H,.04)

    def test_observed_low_spot_is_not_an_unobserved_hole(self):
        H = np.zeros((40,40)); H[10:30,10:30]=.5; H[17:20,17:20]=.05
        M = measure.target_mask(H,.04)
        self.assertEqual(M.sum(),391)

    def test_neighbour_is_not_merged(self):
        H = np.zeros((100,100)); H[40:60,40:60]=1.;H[10:30,10:30]=3.
        M = measure.target_mask(H,.04)
        self.assertEqual(M.sum(),400)
        self.assertAlmostEqual(float(H[M].sum()*.04**2),.64)

    def test_explicit_separate_objects_sum_without_filling_gap(self):
        H = np.zeros((100,100)); H[40:60,40:60]=1.; H[10:30,10:30]=3.
        M=measure.target_mask(H,.04,[np.array([50,50]),np.array([20,20])])
        self.assertEqual(M.sum(),800)
        self.assertAlmostEqual(float(H[M].sum()*.04**2),2.56)
        self.assertFalse(M[35,35])

    def test_similarity_recovers_metric_scale_without_reflection(self):
        t=np.linspace(0,2*np.pi,40,endpoint=False)
        P=np.c_[np.cos(t),np.sin(t),.1*np.sin(3*t)]
        Q=P*2.3+np.array([2.,-.7,3.])
        s,R,b=measure.similarity(P,Q)
        np.testing.assert_allclose(P@R*s+b,Q,atol=1e-12)
        self.assertGreater(np.linalg.det(R),.999)
        self.assertAlmostEqual(s,2.3)

    def test_random_pose_dictionary_order_does_not_scramble_camera_path(self):
        t=np.linspace(0,2*np.pi,20,endpoint=False)
        points=np.c_[np.cos(t),np.ones(20),np.sin(t)]
        frames=[];poses=[]
        for i,p in enumerate(points):
            transform=np.eye(4).T.reshape(-1).tolist();transform[12:15]=p.tolist()
            frames.append({'index':i,'cameraTransform':transform})
            poses.append({'file':f'{i:03d}.jpg','translation':(p/2).tolist()})
        _,_,_,cameras,errors=measure.align(poses[::-1],{'frames':frames})
        np.testing.assert_allclose(cameras,points)
        self.assertLess(errors.max(),1e-10)

    def test_straight_camera_path_is_rejected(self):
        P=np.c_[np.arange(20),np.zeros((20,2))]
        with self.assertRaises(ValueError):
            measure.similarity(P,P)


if __name__=='__main__':
    unittest.main()
