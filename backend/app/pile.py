"""Предварительный объём кучи по точкам ARKit (VIO). Считается здесь, на
бэкенде сайта, по ВСЕМ точкам обхода; браузер получает готовую сетку высот
и только рисует её (до 13.10.2026 считал сам, по 6000 точкам из ~13 000).

  1. Точки. Одну точку ARKit видят несколько кадров — берём медиану её
     положений. Точки, которые видел один кадр, отбрасываем: самые шумные.
     Только кадры основного участка трекинга (после сброса трекинга у ARKit
     другая система координат).
  2. Область — петля обхода (выпуклая оболочка позиций камеры).
  3. Земля — по траектории: наклон — плоскость камеры, высота — нижний
     плотный слой точек у ног. Запасной путь — RANSAC по нижней огибающей.
  4. Сетка высот: медиана в клетке, клетка — под плотность точек (~4 точки).
     Пустые клетки — гармоническая интерполяция; по краю петли — ноль (под
     ногами земля), поэтому склоны сходят к нулю, а не обрываются стенкой.
  5. Угол естественного откоса. Насыпной материал не держит склон круче
     ~45°. Где сглаженная поверхность круче 50°, точки, торчащие над срезом
     больше чем на 15 см, выбрасываются, сетка строится заново и срезается
     конусом 50°. Так уходят дерево, столб, человек в кадре.
  6. Бугры. Заливка сверху вниз: два бугра — одна куча, если седловина между
     ними выше max(10 см, 20 % высоты кучи); ниже — разные. Кучей считается
     крупнейший бугор у точки, куда смотрела камера.
  7. Подошва: куча кончается там, где склон положе 12° и высота ниже 30 %
     вершины — газон, листья, растёкшийся край.
  8. Земля у подошвы: плоскость по точкам в полосе 0.15–1 м за краем кучи.
     Видна со всех сторон и ровная — второй проход от неё (земля под кучей
     часто наклонная: «14 м³» — асфальт под ногами на 25 см выше газона).
  9. Объём = Σ высот × площадь клетки внутри кучи (ARKit в метрах → м³).
     Разброс — от неточности земли (её сдвиг на ±δ меняет объём на ≈ S·δ).
"""
import logging
import warnings
from collections import deque

import numpy as np

logger = logging.getLogger(__name__)

MIN_OBS = 2                  # точку должны видеть не меньше 2 кадров
MIN_POINTS = 300             # меньше — берём и точки одного кадра
PTS_PER_CELL = 4
CELL_MIN_M, CELL_MAX_M = 0.08, 0.30
GROUND_EPS_M = 0.05          # ниже — земля, в объём не идёт
REPOSE_DEG = 50.0            # угол откоса с запасом: щебень держит до ~45°
ABOVE_TOL_M = 0.15           # точка выше срезанной поверхности на столько — не куча
SADDLE_ABS_M, SADDLE_REL = 0.10, 0.20
PERSIST_MIN_M = 0.08         # бугор ниже седловины меньше чем на 8 см — шум
TOE_SLOPE_DEG, TOE_CORE_REL = 12.0, 0.30
TOE_KEEP_MIN = 0.60          # подошва срезала бы больше 40 % объёма — пологая насыпь, не режем
GAZE_NEAR_R = 0.6            # кучей считаем бугор не дальше 0.6 R от точки взгляда
BAND_M = (0.15, 1.0)
BAND_MIN_PTS, BAND_MIN_SECTORS, BAND_SECTOR_PTS = 60, 5, 8
BAND_MAX_SIGMA_M, BAND_MAX_TILT_DEG = 0.08, 12.0
RENDER_MIN_CELLS = 90        # сетка для вида мельче — удваиваем


# ─── точки и камеры ─────────────────────────────────────────────────────────

def _num(v):
    # приложение пишет NaN/Infinity строками — такие значения не числа
    return isinstance(v, (int, float)) and not isinstance(v, bool) and np.isfinite(v)


def collect(scan):
    """Медианные точки ARKit и позы камеры основного участка трекинга.
    Метры, y — вверх по гравитации."""
    frames = [f for f in (scan.get("frames") or []) if isinstance(f, dict)]
    seg_count = {}
    for f in frames:
        s = f.get("trackingSegment", 0)
        seg_count[s] = seg_count.get(s, 0) + 1
    main_seg = max(seg_count, key=seg_count.get) if seg_count else 0
    frames = [f for f in frames if f.get("trackingSegment", 0) == main_seg]
    normal = [f for f in frames if f.get("trackingState") in (None, "normal")]
    # при «limited» ARKit сдвигает точки; но если нормальных кадров мало
    # (сумерки), лучше шумные точки, чем никаких
    obs_frames = normal if len(normal) >= 0.5 * max(len(frames), 1) else frames

    cams, fwd = [], []
    for f in frames:
        m = f.get("cameraTransform") or []
        if len(m) == 16 and all(_num(v) for v in m):
            T = np.asarray(m, float).reshape(4, 4).T       # по столбцам
            cams.append(T[:3, 3])
            fwd.append(-T[:3, 2])                          # камера смотрит по −z
    by_id = {}
    for f in obs_frames:
        pts = f.get("featurePoints") or []
        ids = f.get("featurePointIdentifiers") or []
        for j, pid in enumerate(ids[: len(pts) // 3]):
            x, y, z = pts[3 * j: 3 * j + 3]
            if _num(x) and _num(y) and _num(z):
                by_id.setdefault(pid, []).append((x, y, z))
    nobs = np.fromiter((len(v) for v in by_id.values()), int, len(by_id))
    pts = np.array([np.median(np.asarray(v), axis=0) for v in by_id.values()]).reshape(-1, 3)
    min_obs = MIN_OBS if (nobs >= MIN_OBS).sum() >= MIN_POINTS else 1
    keep = nobs >= min_obs
    return {
        "points": pts[keep], "n_ids": int(len(by_id)), "min_obs": min_obs,
        "cams": np.asarray(cams, float).reshape(-1, 3),
        "fwd": np.asarray(fwd, float).reshape(-1, 3),
    }


# ─── геометрия на плоскости XZ ──────────────────────────────────────────────

def convex_hull(P):
    """Выпуклая оболочка [[x, z]…], против часовой."""
    p = sorted(map(tuple, np.asarray(P, float)))
    if len(p) < 3:
        return np.asarray(p, float)
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for q in p:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0:
            lo.pop()
        lo.append(q)
    for q in reversed(p):
        while len(up) >= 2 and cross(up[-2], up[-1], q) <= 0:
            up.pop()
        up.append(q)
    return np.asarray(lo[:-1] + up[:-1], float)


def inside_convex(hull, x, z):
    ok = np.ones(np.shape(x), bool)
    for i in range(len(hull)):
        a, b = hull[i], hull[(i + 1) % len(hull)]
        ok &= (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1e-9
    return ok


def dist_to_path(path, x, z):
    best = np.full(np.shape(x), np.inf)
    for a, b in zip(path[:-1], path[1:]):
        d = b - a
        L = float(d @ d)
        t = np.clip(((x - a[0]) * d[0] + (z - a[1]) * d[1]) / L, 0, 1) if L else 0.0
        best = np.minimum(best, np.hypot(x - a[0] - t * d[0], z - a[1] - t * d[1]))
    return best


def _lsq_plane(P):
    """МНК-плоскость y = a·x + b·z + c."""
    A = np.c_[P[:, 0], P[:, 2], np.ones(len(P))]
    sol, *_ = np.linalg.lstsq(A, P[:, 1], rcond=None)
    return sol


# ─── земля ──────────────────────────────────────────────────────────────────

def _low_layer(vals):
    """Самый плотный слой толщиной 16 см среди нижних 60 % значений."""
    if len(vals) < 8:
        return None
    r = np.sort(vals)
    half = r[: max(6, int(np.ceil(len(r) * 0.6)))]
    n = np.searchsorted(half, half + 0.16, side="right") - np.arange(len(half))
    i = int(np.argmax(n))
    layer = half[i: i + n[i]]
    med = float(np.median(layer))
    return {"med": med, "n": int(len(layer))}


def ground_from_path(P, cams, R):
    """Наклон — плоскость камеры, сдвиг — нижний заметный слой точек у ног."""
    if len(cams) < 12:
        return None
    tilt = _lsq_plane(cams)
    res = cams[:, 1] - (tilt[0] * cams[:, 0] + tilt[1] * cams[:, 2] + tilt[2])
    # телефон гулял по высоте больше 25 см или земля круче ~10° — не верим
    if np.sqrt(np.mean(res ** 2)) > 0.25 or np.hypot(tilt[0], tilt[1]) > 0.18:
        return None
    D = float(np.clip(0.3 * R, 1, 3))
    near = dist_to_path(cams[:, [0, 2]], P[:, 0], P[:, 2]) < D
    r = P[near, 1] - (tilt[0] * P[near, 0] + tilt[1] * P[near, 2] + tilt[2])
    # земля — самый НИЖНИЙ заметный слой на правдоподобной высоте телефона
    # 0.8–2.2 м. Не самый плотный: в помещении самый плотный — столешница.
    cand = np.sort(r[(r <= -0.8) & (r >= -2.2)])
    if len(cand) < 5:
        return None
    win = np.searchsorted(cand, cand + 0.16, side="right") - np.arange(len(cand))
    need = max(5, 0.03 * len(cand))
    hit = np.nonzero(win >= need)[0]
    if not len(hit):
        return None
    i0 = int(hit[0])
    i = i0 + 1
    while i < len(cand) and cand[i] - cand[i0] <= 0.16:
        if win[i] > win[i0]:
            i0 = i
        i += 1
    layer = cand[i0: i0 + win[i0]]
    off = float(np.median(layer))
    sigma = float(np.median(np.abs(layer - off))) * 1.4826
    return {"a": float(tilt[0]), "b": float(tilt[1]), "c": float(tilt[2] + off),
            "source": "path", "hold": -off, "sigma": sigma}


def ground_from_points(P, cell=0.5, thr=0.06, max_tilt_deg=12):
    """Запасной путь: RANSAC по нижней огибающей (нет нормальной траектории)."""
    flat = {"a": 0.0, "b": 0.0, "c": float(np.quantile(P[:, 1], 0.04)), "source": "flat", "sigma": 0.1}
    key = np.floor(P[:, 0] / cell).astype(np.int64) * 1_000_003 + np.floor(P[:, 2] / cell).astype(np.int64)
    order = np.lexsort((P[:, 1], key))
    k, start, cnt = np.unique(key[order], return_index=True, return_counts=True)
    samples = np.array([P[order[s + int(0.1 * (c - 1))]] for s, c in zip(start, cnt) if c >= 2])
    if len(samples) < 6:
        return flat
    rng = np.random.default_rng(12345)
    max_slope = np.tan(np.radians(max_tilt_deg))
    best = None
    for _ in range(400):
        tri = samples[rng.choice(len(samples), 3, replace=False)]
        try:
            m = np.linalg.solve(np.c_[tri[:, 0], tri[:, 2], np.ones(3)], tri[:, 1])
        except np.linalg.LinAlgError:
            continue
        if np.hypot(m[0], m[1]) > max_slope:
            continue
        r = samples[:, 1] - (m[0] * samples[:, 0] + m[1] * samples[:, 2] + m[2])
        score = int((np.abs(r) < thr).sum()) - 2 * int((r < -thr).sum())
        if best is None or score > best[0] or (score == best[0] and m[2] < best[1][2]):
            best = (score, m)
    if best is None:
        return flat
    m = best[1]
    inl = samples[np.abs(samples[:, 1] - (m[0] * samples[:, 0] + m[1] * samples[:, 2] + m[2])) < thr]
    if len(inl) >= 3:
        ls = _lsq_plane(inl)
        if np.hypot(ls[0], ls[1]) <= max_slope:
            m = ls
    r = P[:, 1] - (m[0] * P[:, 0] + m[1] * P[:, 2] + m[2])
    r = r[np.abs(r) < thr]
    off = float(np.median(r)) if len(r) > 20 else 0.0
    return {"a": float(m[0]), "b": float(m[1]), "c": float(m[2] + off), "source": "points", "sigma": 0.08}


# ─── операции на сетке ──────────────────────────────────────────────────────

N4 = ((0, 1), (0, -1), (1, 0), (-1, 0))
N8 = N4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))


def _shift(A, dz, dx, fill):
    """B[z, x] = A[z + dz, x + dx]; за краем — fill."""
    B = np.full_like(A, fill)
    nz, nx = A.shape
    B[max(0, -dz): nz - max(0, dz), max(0, -dx): nx - max(0, dx)] = \
        A[max(0, dz): nz - max(0, -dz), max(0, dx): nx - max(0, -dx)]
    return B


def _dilate(M, it=1):
    for _ in range(it):
        out = M.copy()
        for dz, dx in N8:
            out |= _shift(M, dz, dx, False)
        M = out
    return M


def _erode(M, it=1):
    for _ in range(it):
        out = M.copy()
        for dz, dx in N8:
            out &= _shift(M, dz, dx, False)
        M = out
    return M


def _component(M, seed):
    """Связная (8 соседей) область маски M, содержащая клетку seed."""
    out = np.zeros_like(M)
    if not M[seed]:
        return out
    nz, nx = M.shape
    q = deque([seed])
    out[seed] = True
    while q:
        z, x = q.popleft()
        for dz, dx in N8:
            zz, xx = z + dz, x + dx
            if 0 <= zz < nz and 0 <= xx < nx and M[zz, xx] and not out[zz, xx]:
                out[zz, xx] = True
                q.append((zz, xx))
    return out


def _fill_holes(M):
    nz, nx = M.shape
    outside = np.zeros_like(M)
    q = deque()
    for z in range(nz):
        for x in (0, nx - 1):
            if not M[z, x] and not outside[z, x]:
                outside[z, x] = True
                q.append((z, x))
    for x in range(nx):
        for z in (0, nz - 1):
            if not M[z, x] and not outside[z, x]:
                outside[z, x] = True
                q.append((z, x))
    while q:
        z, x = q.popleft()
        for dz, dx in N4:
            zz, xx = z + dz, x + dx
            if 0 <= zz < nz and 0 <= xx < nx and not M[zz, xx] and not outside[zz, xx]:
                outside[zz, xx] = True
                q.append((zz, xx))
    return ~outside


def _masked_blur(H, M, sigma):
    """Нормированная свёртка внутри маски: размывает, не затягивая землю за краем."""
    r = max(1, int(np.ceil(sigma * 2.5)))
    k = np.exp(-np.arange(-r, r + 1) ** 2 / (2 * sigma * sigma))
    v, w = np.where(M, H, 0.0), M.astype(float)
    for ax in (0, 1):
        v = np.apply_along_axis(lambda a: np.convolve(a, k, "same"), ax, v)
        w = np.apply_along_axis(lambda a: np.convolve(a, k, "same"), ax, w)
    return np.where(M & (w > 1e-9), v / np.maximum(w, 1e-9), 0.0)


def _harmonic_fill(H, known, M, iters=400):
    """Пустые клетки маски — гармоническая интерполяция (мембрана) по известным."""
    H = np.where(known, H, 0.0)
    have = known.copy()
    # старт — ближайшие известные (иначе мембрана сходится сотни итераций)
    while True:
        todo = M & ~have
        if not todo.any():
            break
        s, w = np.zeros_like(H), np.zeros_like(H)
        for dz, dx in N8:
            hv = _shift(have, dz, dx, False)
            s += np.where(hv, _shift(H, dz, dx, 0.0), 0.0)
            w += hv
        grow = todo & (w > 0)
        if not grow.any():
            break
        H[grow] = s[grow] / w[grow]
        have |= grow
    free = M & ~known
    for _ in range(iters):
        s, w = np.zeros_like(H), np.zeros_like(H)
        for dz, dx in N4:
            mv = _shift(M, dz, dx, False)
            s += np.where(mv, _shift(H, dz, dx, 0.0), 0.0)
            w += mv
        Hn = np.where(w > 0, s / np.maximum(w, 1), H)
        H = np.where(free, Hn, H)
    return H


def _repose_clamp(H, cell):
    """Обрезка снизу конусом откоса: H ≤ min(соседа + tg·расстояние)."""
    t = np.tan(np.radians(REPOSE_DEG))
    H = H.copy()
    for _ in range(400):
        Hn = H
        for dz, dx in N8:
            Hn = np.minimum(Hn, _shift(H, dz, dx, np.inf) + t * cell * np.hypot(dz, dx))
        if np.max(H - Hn) < 1e-4:
            return Hn
        H = Hn
    return H


def _chamfer(M, cell):
    """Расстояние (м) до ближайшей клетки маски M — два прохода по 8 соседям."""
    D = np.where(M, 0.0, np.inf)
    nz, nx = M.shape
    d1, d2 = cell, cell * np.sqrt(2)
    for z in range(nz):
        for x in range(nx):
            v = D[z, x]
            if z > 0:
                v = min(v, D[z - 1, x] + d1, D[z - 1, x - 1] + d2 if x > 0 else np.inf,
                        D[z - 1, x + 1] + d2 if x < nx - 1 else np.inf)
            if x > 0:
                v = min(v, D[z, x - 1] + d1)
            D[z, x] = v
    for z in range(nz - 1, -1, -1):
        for x in range(nx - 1, -1, -1):
            v = D[z, x]
            if z < nz - 1:
                v = min(v, D[z + 1, x] + d1, D[z + 1, x + 1] + d2 if x < nx - 1 else np.inf,
                        D[z + 1, x - 1] + d2 if x > 0 else np.inf)
            if x < nx - 1:
                v = min(v, D[z, x + 1] + d1)
            D[z, x] = v
    return D


# ─── бугры ──────────────────────────────────────────────────────────────────

def mounds(Hs, M, s_min):
    """Бугры заливкой сверху вниз. Возвращает метки клеток (−1 — земля)."""
    nz, nx = Hs.shape
    flat = Hs.ravel()
    cand = np.nonzero((M & (Hs > GROUND_EPS_M)).ravel())[0]
    order = cand[np.argsort(-flat[cand], kind="stable")]
    parent = np.full(nz * nx, -1, np.int64)
    peak = np.zeros(nz * nx)

    def find(q):
        while parent[q] != q:
            parent[q] = parent[parent[q]]
            q = parent[q]
        return q

    for q in order:
        z, x = divmod(int(q), nx)
        h = flat[q]
        nbs = [zz * nx + xx for dz, dx in N8
               for zz, xx in ((z + dz, x + dx),)
               if 0 <= zz < nz and 0 <= xx < nx and parent[zz * nx + xx] >= 0]
        if not nbs:
            parent[q] = q
            peak[q] = h
            continue
        roots = sorted({find(n) for n in nbs}, key=lambda r: -peak[r])
        for r in roots[1:]:
            # седловина высокая — одна куча; бугорок ниже шума — тоже
            if h >= s_min or peak[r] - h < PERSIST_MIN_M:
                parent[r] = roots[0]
        # клетка — к бугру самого высокого соседа (подъём по склону)
        parent[q] = find(max(nbs, key=lambda n: flat[n]))
    lab = np.full(nz * nx, -1, np.int64)
    for q in order:
        lab[q] = find(q)
    return lab.reshape(nz, nx)


def gaze_point(cams, fwd):
    """Точка, ближайшая ко всем оптическим осям: туда смотрел человек."""
    if len(cams) < 3:
        return None
    A, b = np.zeros((3, 3)), np.zeros(3)
    for c, f in zip(cams, fwd):
        f = f / (np.linalg.norm(f) or 1)
        P = np.eye(3) - np.outer(f, f)
        A += P
        b += P @ c
    if np.linalg.cond(A) > 1e6:
        return None
    return np.linalg.solve(A, b)


# ─── сборка ─────────────────────────────────────────────────────────────────

def _grid(P, plane, hull, cell, R):
    """Сетка высот над плоскостью plane внутри петли, срезанная по углу откоса.

    Там, где сглаженная поверхность круче откоса, точки, торчащие над
    срезом больше чем на ABOVE_TOL_M (крона, столб, человек), выбрасываются,
    и сетка строится заново: под ними высоту дают точки кучи или соседние
    клетки (иначе под кроной остался бы конус 50°)."""
    lo, hi = hull.min(0) - cell, hull.max(0) + cell
    nx = int(np.ceil((hi[0] - lo[0]) / cell)) + 1
    nz = int(np.ceil((hi[1] - lo[1]) / cell)) + 1
    xc = lo[0] + (np.arange(nx) + 0.5) * cell
    zc = lo[1] + (np.arange(nz) + 0.5) * cell
    X, Z = np.meshgrid(xc, zc)
    M = inside_convex(hull, X, Z)
    h = P[:, 1] - (plane["a"] * P[:, 0] + plane["b"] * P[:, 2] + plane["c"])
    ix = np.floor((P[:, 0] - lo[0]) / cell).astype(np.int64)
    iz = np.floor((P[:, 2] - lo[1]) / cell).astype(np.int64)
    ok = (ix >= 0) & (ix < nx) & (iz >= 0) & (iz < nz)
    ok[ok] = M[iz[ok], ix[ok]]
    ok &= h >= -0.3                                     # глубоко под землёй — шум

    def heights(use):
        key = iz[use] * nx + ix[use]
        hv = h[use]
        order = np.lexsort((hv, key))
        k, start, cnt = np.unique(key[order], return_index=True, return_counts=True)
        hs = hv[order]
        H = np.full(nz * nx, np.nan)
        H[k] = 0.5 * (hs[start + (cnt - 1) // 2] + hs[start + cnt // 2])
        H = H.reshape(nz, nx)
        data = ~np.isnan(H)
        ring = M & ~_erode(M)                           # под ногами — земля
        fill = lambda d: _harmonic_fill(np.where(d, H, 0.0), d | (ring & ~d), M)
        Hf = fill(data)
        # одиночные вылеты — по ЗАПОЛНЕННОЙ сетке: у пика из одной точки
        # соседи часто без точек, и сравнить с ними до заполнения нечем
        stack = np.stack([_shift(np.where(M, Hf, np.nan), dz, dx, np.nan) for dz, dx in N8])
        with warnings.catch_warnings():                 # клетки без соседей — NaN
            warnings.simplefilter("ignore", RuntimeWarning)
            nb_med = np.nanmedian(stack, axis=0)
        bad = data & ~ring & (np.abs(Hf - nb_med) > max(0.25, 0.05 * R))
        if bad.any():
            data &= ~bad
            Hf = fill(data)
        return np.where(M, np.maximum(Hf, 0.0), 0.0), data

    H_raw, data = heights(ok)
    # Крутизну меряем по СГЛАЖЕННОЙ поверхности: соседние клетки по 15 см
    # от шума точек расходятся на 5–10 см, и на честном склоне 35–40° срез по
    # сырой сетке сбривал каждую такую ступеньку (−8…10 % у куч без деревьев).
    # Дерево и столб круты и после сглаживания — режем только там.
    Hs = _masked_blur(H_raw, M, max(1.0, 0.25 / cell))
    Hc = _repose_clamp(Hs, cell)
    cut = _dilate(Hs - Hc > ABOVE_TOL_M, 2)
    H = H_raw
    above = np.zeros(len(P), bool)
    if cut.any():
        above[ok] = cut[iz[ok], ix[ok]] & (h[ok] > Hc[iz[ok], ix[ok]] + ABOVE_TOL_M)
        H2, data = heights(ok & ~above)
        H = np.where(cut, np.minimum(H2, _repose_clamp(H2, cell)), H2)
    return {"H": H, "H_raw": H_raw, "M": M, "x0": float(xc[0]), "z0": float(zc[0]),
            "nx": nx, "nz": nz, "h": h, "ix": ix, "iz": iz, "data": data, "above": above}


def _isolate(g, cell, R, gaze):
    """Бугры → куча у точки взгляда → подошва (срез по откосу — уже в _grid)."""
    M, H = g["M"], g["H"]
    Hs = _masked_blur(H, M, max(1.0, 0.2 / cell))
    hmax = float(Hs[M].max()) if M.any() else 0.0
    st = {"hmax_m": round(hmax, 3), "repose_cut_m3": round(float((g["H_raw"] - H)[M].sum()) * cell ** 2, 3),
          "above_pts": int(g["above"].sum())}
    if hmax < 0.10:
        st["why"] = "куча ниже 10 см"
        return H, Hs, M & (H > GROUND_EPS_M), st
    s_min = max(SADDLE_ABS_M, SADDLE_REL * hmax)
    lab = mounds(Hs, M, s_min)
    roots = [r for r in np.unique(lab) if r >= 0]
    vol = {r: float(H[lab == r].sum()) * cell ** 2 for r in roots}
    nz, nx = H.shape
    Zc, Xc = np.mgrid[0:nz, 0:nx]
    def centre(r):
        w = np.where(lab == r, H, 0.0)
        s = w.sum() or 1.0
        return np.array([g["x0"] + (Xc * w).sum() / s * cell, g["z0"] + (Zc * w).sum() / s * cell])
    near = [r for r in roots if gaze is not None and np.hypot(*(centre(r) - gaze)) <= GAZE_NEAR_R * R]
    main = max(near or roots, key=lambda r: vol[r])
    pile = lab == main
    st.update({"mounds": len(roots), "saddle_m": round(s_min, 3), "main_by_gaze": bool(near),
               "other_mounds_m3": round(sum(v for r, v in vol.items() if r != main), 3)})
    # подошва по излому склона
    peak_h = float(Hs[pile].max())
    peak = np.unravel_index(int(np.argmax(np.where(pile, Hs, -1))), Hs.shape)
    gz, gx = np.gradient(Hs, cell)
    slope = np.degrees(np.arctan(np.hypot(gz, gx)))
    core = pile & ((slope >= TOE_SLOPE_DEG) | (Hs >= TOE_CORE_REL * peak_h))
    core = _dilate(_erode(core)) | (pile & (Hs >= 0.5 * peak_h))
    core = _fill_holes(_component(core, peak)) & pile
    toe = _dilate(core) & pile
    keep = float(H[toe].sum()) / max(float(H[pile].sum()), 1e-9)
    st["toe_keep"] = round(keep, 3)
    if keep >= TOE_KEEP_MIN:
        pile = toe
        st["toe"] = True
    else:
        st["toe"] = False
    return H, Hs, pile, st


def _toe_ground(P, g, pile, cell, plane, hmax):
    """Плоскость земли по точкам в полосе за краем кучи; None — не годится."""
    D = _chamfer(pile, cell)
    band = g["M"] & (D > BAND_M[0]) & (D <= BAND_M[1])
    ix, iz = g["ix"], g["iz"]
    ok = (ix >= 0) & (ix < g["nx"]) & (iz >= 0) & (iz < g["nz"])
    ok[ok] = band[iz[ok], ix[ok]]
    B = P[ok]
    st = {"band_pts": int(len(B))}
    if len(B) < BAND_MIN_PTS:
        st["why"] = f"у подошвы мало точек земли ({len(B)})"
        return None, st
    keep = np.ones(len(B), bool)
    sol, sigma = None, 0.0
    for _ in range(5):
        sol = _lsq_plane(B[keep])
        r = B[:, 1] - (sol[0] * B[:, 0] + sol[1] * B[:, 2] + sol[2])
        sigma = 1.4826 * float(np.median(np.abs(r[keep])))
        keep = np.abs(r) < max(2.5 * sigma, 0.01)
    Zc, Xc = np.nonzero(pile)
    pc = np.array([g["x0"] + Xc.mean() * cell, g["z0"] + Zc.mean() * cell])
    ang = np.arctan2(B[keep, 2] - pc[1], B[keep, 0] - pc[0])
    sectors = int((np.bincount(((ang + np.pi) / (2 * np.pi) * 8).astype(int) % 8, minlength=8)
                   >= BAND_SECTOR_PTS).sum())
    tilt = float(np.degrees(np.arctan(np.hypot(sol[0], sol[1]))))
    shift = float(sol[0] * pc[0] + sol[1] * pc[1] + sol[2]
                  - (plane["a"] * pc[0] + plane["b"] * pc[1] + plane["c"]))
    st.update({"sectors": sectors, "sigma_m": round(sigma, 3), "tilt_deg": round(tilt, 1),
               "shift_m": round(shift, 3)})
    if sectors < BAND_MIN_SECTORS:
        st["why"] = f"земля у подошвы видна с {sectors} сторон из 8"
    elif sigma > BAND_MAX_SIGMA_M:
        st["why"] = f"земля у подошвы неровная ({sigma * 100:.0f} см)"
    elif tilt > BAND_MAX_TILT_DEG:
        st["why"] = f"земля у подошвы наклонена на {tilt:.0f}°"
    elif abs(shift) > 0.5 * hmax:
        st["why"] = f"земля у подошвы на {shift * 100:+.0f} см от земли по траектории"
    if "why" in st:
        return None, st
    return {"a": float(sol[0]), "b": float(sol[1]), "c": float(sol[2]), "source": "toe",
            "hold": plane.get("hold"), "sigma": sigma}, st


def _vol(H, pile, cell, shift=0.0):
    v = H - shift
    return float(v[pile & (v > GROUND_EPS_M)].sum()) * cell * cell


def _upsample2(A):
    """Билинейное удвоение сетки (для вида: мелкая сетка рисуется глаже)."""
    nz, nx = A.shape
    out = np.zeros((2 * nz - 1, 2 * nx - 1))
    out[::2, ::2] = A
    out[1::2, ::2] = 0.5 * (A[:-1] + A[1:])
    out[::2, 1::2] = 0.5 * (A[:, :-1] + A[:, 1:])
    out[1::2, 1::2] = 0.25 * (A[:-1, :-1] + A[1:, :-1] + A[:-1, 1:] + A[1:, 1:])
    return out


def build_surface(P, cams, fwd):
    """Поверхность и объём кучи. P — медианные точки ARKit (м). None — не из чего."""
    if len(P) < 30:
        return None
    hull, closed, coverage = None, False, 0.0
    if len(cams) >= 8:
        hull = convex_hull(cams[:, [0, 2]])
        c0 = hull.mean(0)
        ang = np.sort(np.arctan2(cams[:, 2] - c0[1], cams[:, 0] - c0[0]))
        gap = max(2 * np.pi - (ang[-1] - ang[0]), float(np.max(np.diff(ang))) if len(ang) > 1 else 0)
        coverage = 360 - np.degrees(gap)
        closed = coverage >= 300
    if hull is None or len(hull) < 3 or not closed:
        # петля не замкнута: оболочка камер + центральные 90 % точек
        q = np.quantile(P[:, [0, 2]], [0.05, 0.95], axis=0)
        core = P[np.all((P[:, [0, 2]] >= q[0]) & (P[:, [0, 2]] <= q[1]), axis=1)][:, [0, 2]]
        hull = convex_hull(np.r_[core, cams[:, [0, 2]]] if len(cams) else core)
    if len(hull) < 3:
        return None
    centre = hull.mean(0)
    R = float(np.median(np.hypot(*(hull - centre).T))) or 1.0
    plane = ground_from_path(P, cams, R) or ground_from_points(P)
    inside = inside_convex(hull, P[:, 0], P[:, 2])
    area = 0.5 * abs(float(np.dot(hull[:, 0], np.roll(hull[:, 1], -1)) - np.dot(hull[:, 1], np.roll(hull[:, 0], -1))))
    cell = float(np.clip(np.sqrt(area * PTS_PER_CELL / max(int(inside.sum()), 1)), CELL_MIN_M, CELL_MAX_M))
    gz = gaze_point(cams, fwd)
    gaze = gz[[0, 2]] if gz is not None else None

    g = _grid(P, plane, hull, cell, R)
    H, Hs, pile, iso = _isolate(g, cell, R, gaze)
    ground = {"applied": False}
    if iso.get("why") is None and pile.any():
        tp, gst = _toe_ground(P, g, pile, cell, plane, float(H[pile].max()))
        ground.update(gst)
        if tp is not None:
            g2 = _grid(P, tp, hull, cell, R)
            H2, Hs2, pile2, iso2 = _isolate(g2, cell, R, gaze)
            if pile2.any():
                plane, g, H, Hs, pile, iso = tp, g2, H2, Hs2, pile2, iso2
                ground["applied"] = True

    volume = _vol(H, pile, cell)
    delta = float(np.clip(plane.get("sigma") or 0.08, 0.03, 0.2))
    vs = [volume, _vol(Hs, pile, cell), _vol(H, pile, cell, delta), _vol(H, pile, cell, -delta)]
    top = float(H[pile].max()) if pile.any() else 0.0
    # Вторая гипотеза земли, если земля у подошвы не нашлась: плотный нижний
    # слой МЕЖДУ ногами и кучей. Куча на подсыпке — это земля; растёкшийся
    # материал — нет. По точкам не различить — показываем оба числа.
    foot = None
    if not ground["applied"] and plane["source"] == "path" and len(cams) >= 12:
        d = dist_to_path(cams[:, [0, 2]], P[:, 0], P[:, 2])
        sel = inside & (d >= 1.5) & (d <= max(2, 0.45 * R))
        hb = P[sel, 1] - (plane["a"] * P[sel, 0] + plane["b"] * P[sel, 2] + plane["c"])
        L = _low_layer(hb)
        if L and max(0.12, 2 * delta) < L["med"] < 0.4 * top:
            foot = {"lift": round(L["med"], 3), "volume": round(_vol(H, pile, cell, L["med"]), 3), "n": L["n"]}
            vs.append(foot["volume"])
    # размеры подошвы по главным осям
    size = [0.0, 0.0]
    Zi, Xi = np.nonzero(pile & (H > GROUND_EPS_M))
    if len(Xi) > 3:
        fx, fz = g["x0"] + Xi * cell, g["z0"] + Zi * cell
        dx, dz = fx - fx.mean(), fz - fz.mean()
        th = 0.5 * np.arctan2(2 * (dx * dz).sum(), (dx * dx).sum() - (dz * dz).sum())
        u = dx * np.cos(th) + dz * np.sin(th)
        w = -dx * np.sin(th) + dz * np.cos(th)
        size = sorted([float(np.quantile(u, 0.99) - np.quantile(u, 0.01)),
                       float(np.quantile(w, 0.99) - np.quantile(w, 0.01))], reverse=True)
    # для вида: только куча, остальное в петле — ровная земля
    Hr = _masked_blur(H, pile, max(1.0, 0.025 * R / cell))
    Hr = np.where(pile & (Hr > GROUND_EPS_M), Hr, 0.0)
    Mr, rc = g["M"], cell
    if max(g["nx"], g["nz"]) < RENDER_MIN_CELLS:
        Hr, Mr, rc = _upsample2(Hr), _upsample2(Mr.astype(float)) > 0.99, cell / 2
    # точки кучи — по клетке
    ix, iz = g["ix"], g["iz"]
    on = (ix >= 0) & (ix < g["nx"]) & (iz >= 0) & (iz < g["nz"])
    in_pile = np.zeros(len(P), bool)
    # на куче — точки не ниже земли и не выше поверхности (крона над кучей — нет)
    in_pile[on] = (pile[iz[on], ix[on]] & (g["h"][on] > GROUND_EPS_M)
                   & (g["h"][on] <= H[iz[on], ix[on]] + ABOVE_TOL_M))
    return {
        "plane": {k: (round(v, 5) if isinstance(v, float) else v) for k, v in plane.items()},
        "hull": np.round(hull, 3).tolist(), "center": np.round(centre, 3).tolist(), "R": round(R, 3),
        "grid": {"nx": int(Hr.shape[1]), "nz": int(Hr.shape[0]), "cell": round(rc, 4),
                 "x0": round(g["x0"], 4), "z0": round(g["z0"], 4),
                 # см; −1 — вне петли обхода
                 "h": np.where(Mr, np.round(Hr * 100), -1).astype(int).ravel().tolist()},
        "volume": round(volume, 3), "range": [round(min(vs), 3), round(max(vs), 3)],
        "area": round(float((pile & (H > GROUND_EPS_M)).sum()) * cell * cell, 2),
        "top": round(top, 3), "size": [round(s, 2) for s in size],
        "closed": bool(closed), "coverage": round(float(coverage), 1), "foot": foot,
        "points_used": int(inside.sum()), "points_pile": int(in_pile.sum()),
        "_in_pile": in_pile,
        "debug": {"cell_m": round(cell, 3), "isolate": iso, "toe_ground": ground,
                  "gaze": None if gaze is None else np.round(gaze, 2).tolist()},
    }


def build_cloud(scan, max_points=6000):
    """Ответ GET /scans/{id}/cloud: точки для вида (не больше max_points),
    позиции камеры, флаг «точка кучи» и поверхность с объёмом."""
    c = collect(scan)
    P = c["points"]
    surface = None
    try:
        surface = build_surface(P, c["cams"], c["fwd"])
    except Exception:                                   # вид без объёма лучше, чем 500
        logger.exception("Поверхность кучи не построена")
    pile = surface.pop("_in_pile") if surface else np.zeros(len(P), bool)
    idx = np.arange(len(P))
    if len(P) > max_points:
        idx = np.floor(np.arange(max_points) * (len(P) / max_points)).astype(int)
    return {
        "points": np.round(P[idx], 2).tolist(),
        "pile": pile[idx].astype(int).tolist(),
        "cameras": np.round(c["cams"], 2).tolist(),
        "points_total": int(len(P)), "ids_total": c["n_ids"], "min_obs": c["min_obs"],
        "surface": surface,
    }
