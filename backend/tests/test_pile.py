"""Выделение кучи по точкам ARKit (app/pile.py) на синтетическом обходе.

Запуск: python backend/tests/test_pile.py (или pytest, если установлен).
Куча — конус R 1.8 м, h 1.0 м (3.393 м³) на чуть наклонной земле; рядом
отдельный бугор и «дерево» на склоне. Камеры ходят по кругу 4.5 м на высоте
телефона и смотрят на кучу, точки видны 2–4 кадрам с шумом ARKit."""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import pile  # noqa: E402

CONE = (0.3, 0.0, 1.8, 1.0)          # x, z, радиус, высота
CONE_V = math.pi * 1.8 ** 2 * 1.0 / 3
BUMP = (3.1, 0.6, 0.5, 0.30)         # отдельный бугор у петли обхода
TILT = (0.02, -0.01)                 # земля наклонена (~1.3°)


def ground(x, z):
    return TILT[0] * x + TILT[1] * z


def cone_h(x, z, c):
    return np.maximum(0.0, c[3] * (1 - np.hypot(x - c[0], z - c[1]) / c[2]))


def make_scan(tree=False, bump=True, n_frames=72, seed=1):
    rng = np.random.default_rng(seed)
    pts = []
    # земля и куча: равномерно по кругу 4.4 м
    r = 4.4 * np.sqrt(rng.random(9000))
    a = 2 * np.pi * rng.random(9000)
    x, z = r * np.cos(a), r * np.sin(a)
    h = cone_h(x, z, CONE) + (cone_h(x, z, BUMP) if bump else 0)
    pts += list(zip(x, ground(x, z) + h, z))
    if tree:                          # крона 1.8–3.0 м над землёй на склоне кучи
        tx, tz = 1.4, 1.0
        rr = 0.6 * np.sqrt(rng.random(500))
        aa = 2 * np.pi * rng.random(500)
        cx, cz = tx + rr * np.cos(aa), tz + rr * np.sin(aa)
        pts += list(zip(cx, ground(cx, cz) + 1.8 + 1.2 * rng.random(500), cz))
    pts = np.asarray(pts)
    frames = []
    obs = [[] for _ in range(n_frames)]
    for i, p in enumerate(pts):
        for f in rng.choice(n_frames, rng.integers(2, 5), replace=False):
            obs[f].append((i, p + rng.normal(0, 0.006, 3)))
    for f in range(n_frames):
        ang = 2 * np.pi * f / n_frames
        c = np.array([4.5 * np.cos(ang), 0.0, 4.5 * np.sin(ang)])
        c[1] = ground(c[0], c[2]) + 1.5
        fwd = np.array([CONE[0], 0.4, CONE[1]]) - c
        fwd /= np.linalg.norm(fwd)
        right = np.cross(fwd, [0, 1, 0])
        right /= np.linalg.norm(right)
        up = np.cross(right, fwd)
        T = np.eye(4)
        T[:3, 0], T[:3, 1], T[:3, 2], T[:3, 3] = right, up, -fwd, c
        frames.append({
            "cameraTransform": T.T.ravel().tolist(),          # по столбцам, как пишет приложение
            "trackingState": "normal", "trackingSegment": 0,
            "featurePoints": [v for _, q in obs[f] for v in q.tolist()],
            "featurePointIdentifiers": [i for i, _ in obs[f]],
        })
    return {"frames": frames}


def test_cone_volume():
    s = pile.build_cloud(make_scan(bump=False))["surface"]
    assert abs(s["volume"] / CONE_V - 1) < 0.08, s["volume"]
    assert abs(s["top"] - 1.0) < 0.1, s["top"]


def test_separate_bump_is_not_pile():
    c = pile.build_cloud(make_scan(bump=True), max_points=10 ** 9)
    s = c["surface"]
    assert abs(s["volume"] / CONE_V - 1) < 0.08, s["volume"]
    P, flags = np.asarray(c["points"]), np.asarray(c["pile"])
    on_bump = cone_h(P[:, 0], P[:, 2], BUMP) > 0.1
    assert on_bump.sum() > 20 and flags[on_bump].sum() == 0


def test_tree_does_not_add_volume():
    v0 = pile.build_cloud(make_scan())["surface"]["volume"]
    v1 = pile.build_cloud(make_scan(tree=True))["surface"]["volume"]
    assert abs(v1 / v0 - 1) < 0.05, (v0, v1)


def test_ground_at_toe_takes_over_tilted_ground():
    s = pile.build_cloud(make_scan())["surface"]
    assert s["plane"]["source"] == "toe", s["plane"]
    assert s["debug"]["toe_ground"]["sectors"] == 8


def test_points_count_and_junk():
    scan = make_scan()
    f = scan["frames"][0]
    f["featurePoints"][:3] = ["NaN", "NaN", "NaN"]      # приложение пишет так нечисла
    c = pile.build_cloud(scan, max_points=6000)
    assert len(c["points"]) == 6000 and len(c["pile"]) == 6000
    assert c["points_total"] > 6000
    assert 0 < c["surface"]["points_pile"] < c["surface"]["points_used"] <= c["points_total"]


def test_too_few_points():
    scan = make_scan()
    for i, f in enumerate(scan["frames"]):               # 10 точек на весь обход
        n = 1 if i < 10 else 0
        f["featurePoints"], f["featurePointIdentifiers"] = f["featurePoints"][:3 * n], f["featurePointIdentifiers"][:n]
    c = pile.build_cloud(scan)
    assert c["surface"] is None


def test_lost_tracking_segment_ignored():
    scan = make_scan()
    for f in scan["frames"][:10]:                        # другой участок трекинга — другие координаты
        f["trackingSegment"] = 1
        f["featurePoints"] = [v + 5.0 for v in f["featurePoints"]]
    s = pile.build_cloud(scan)["surface"]
    assert abs(s["volume"] / CONE_V - 1) < 0.10, s["volume"]


# ─── расширенная запись приложения 1.05 (scan.json → "capture") ─────────────

def with_dense(scan, seed=2, hide_above=None):
    """Тот же обход + capture.densePoints: каждая точка видна ~12 раз,
    база 0.3 м, шум 6 мм. hide_above — точек кучи выше этой высоты нет."""
    rng = np.random.default_rng(seed)
    by_id = {}
    for f in scan["frames"]:
        pts, ids = f["featurePoints"], f["featurePointIdentifiers"]
        for j, pid in enumerate(ids):
            by_id.setdefault(pid, []).append(pts[3 * j: 3 * j + 3])
    ids, mean = [], []
    for pid, obs in by_id.items():
        p = np.median(np.asarray(obs), axis=0)
        if hide_above is not None and p[1] - ground(p[0], p[2]) > hide_above:
            continue
        ids.append(pid)
        mean.append(p + rng.normal(0, 0.003, 3))
    n = len(ids)
    mm = lambda a: np.round(np.asarray(a) * 1000).astype(int).ravel().tolist()
    scan["capture"] = {"schema": 1, "densePoints": {
        "sampleHz": 30, "ids": ids, "meanMm": mm(mean), "lastMm": mm(mean),
        "count": [12] * n, "spreadMm": [6] * n, "baselineMm": [300] * n, "rangeMm": [2000] * n,
        "firstMs": [0] * n, "lastMs": [400] * n, "segment": [0] * n}}
    return scan


def test_dense_points_used_and_volume_kept():
    c = pile.build_cloud(with_dense(make_scan(bump=False)))
    s = c["surface"]
    assert c["points_source"] == "dense"
    assert abs(s["volume"] / CONE_V - 1) < 0.08, s["volume"]
    assert s["volume_frames"] is not None and abs(s["volume_frames"] / CONE_V - 1) < 0.08


def test_dense_filters_short_tracks():
    scan = with_dense(make_scan(bump=False))
    d = scan["capture"]["densePoints"]
    d["count"] = [3] * len(d["ids"])                     # видели 3 раза — мало
    c = pile.build_cloud(scan)
    assert c["points_source"] == "frames"


def test_old_scan_without_capture_unchanged():
    c = pile.build_cloud(make_scan(bump=False))
    assert c["points_source"] == "frames" and c["quality"] is None
    assert "volume_frames" not in c["surface"]


def hide_top(scan, h):
    """Вершину выше h не видел ни один кадр."""
    for f in scan["frames"]:
        pts, ids = f["featurePoints"], f["featurePointIdentifiers"]
        keep = [j for j in range(len(ids)) if pts[3 * j + 1] - ground(pts[3 * j], pts[3 * j + 2]) <= h]
        f["featurePoints"] = [v for j in keep for v in pts[3 * j: 3 * j + 3]]
        f["featurePointIdentifiers"] = [ids[j] for j in keep]
    return scan


def test_support_share_drops_when_top_hidden():
    full_c = pile.build_cloud(with_dense(make_scan(bump=False)))
    cut_c = pile.build_cloud(with_dense(hide_top(make_scan(bump=False), 0.5)))
    assert full_c["points_source"] == cut_c["points_source"] == "dense"
    full, cut = full_c["surface"]["support"], cut_c["surface"]["support"]
    assert full["volume_share"] > 0.9, full
    assert cut["volume_share"] < full["volume_share"] - 0.15, (full, cut)
    # вершина выше 0.5 м — четверть площади конуса, а под ней ~40 % объёма
    assert 0.45 < cut["volume_share"] < 0.75, cut
    assert cut["top_share"] < full["top_share"] - 0.3, (full, cut)


def test_loop_drift_from_frames():
    scan = make_scan(bump=False)
    n = len(scan["frames"])
    for i, f in enumerate(scan["frames"]):
        f["timestamp"] = 100.0 + i
    # первые кадры снимают то же, что последние; у последних всё ниже на 4 см
    for k in range(10):
        head, tail = scan["frames"][k], scan["frames"][n - 1 - k]
        tail["featurePoints"] = list(head["featurePoints"])
        tail["featurePointIdentifiers"] = [i + 10 ** 6 for i in head["featurePointIdentifiers"]]
        pts = tail["featurePoints"]
        for j in range(1, len(pts), 3):
            pts[j] -= 0.04
    d = pile.loop_drift_cm(scan)
    assert d is not None and abs(d + 4) < 0.6, d


def test_masked_blur_small_grid():
    # сетка короче ядра свёртки — раньше падала на broadcast (обход 20.10)
    H = np.random.default_rng(3).random((18, 16))
    M = np.ones_like(H, bool)
    B = pile._masked_blur(H, M, 3.1)                     # ядро 17 клеток
    assert B.shape == H.shape
    big = np.random.default_rng(4).random((40, 40))
    k = np.exp(-np.arange(-8, 9) ** 2 / (2 * 3.1 ** 2))
    ref = big.copy()
    for ax in (0, 1):                                    # как было: mode="same"
        ref = np.apply_along_axis(lambda a: np.convolve(a, k, "same"), ax, ref)
    w = np.ones_like(big)
    for ax in (0, 1):
        w = np.apply_along_axis(lambda a: np.convolve(a, k, "same"), ax, w)
    assert np.array_equal(pile._masked_blur(big, np.ones_like(big, bool), 3.1), ref / w)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
