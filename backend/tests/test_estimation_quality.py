import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import pile

class EstimationQualityTests(unittest.TestCase):
    def test_rejects_model_dominated_by_unobserved_cells(self):
        # A narrow ground-only interval must not make a sparse model publishable.
        surface = {'volume': 5.505, 'range': [5.057, 5.962],
                   'support': {'volume_share': .29}, '_in_pile': np.ones(40, bool)}
        points = np.zeros((40, 3))
        with patch.object(pile, 'collect', return_value={'points': points, 'cams': points,
                'fwd': points, 'n_ids': 40, 'min_obs': 2}), patch.object(pile, 'build_surface', return_value=surface):
            result = pile.build_cloud({})
        self.assertIsNone(result['surface'])
        self.assertTrue(result['estimation_warning'])
        self.assertEqual(len(result['points']), 40)
        self.assertFalse(any(result['pile']))

    def test_disagreement_is_rejected_even_with_dense_support(self):
        s = {'volume': 34, 'volume_frames': 25, 'support': {'volume_share': .8}}
        self.assertTrue(pile.estimation_warning(s))

    def test_consistent_supported_surface_remains_preliminary(self):
        s = {'volume': 1.419, 'volume_frames': 1.345, 'support': {'volume_share': .828}}
        self.assertIsNone(pile.estimation_warning(s))

    def test_empty_surface_has_no_additional_warning(self):
        self.assertIsNone(pile.estimation_warning(None))
