# Облако DUSt3R → компактный бинарник для 3D-вида в панели выбора обхода.
# Формат 'KSPC' v1: uint32 magic, uint32 count, float32 scale, float32 height,
# затем count×int16[3] (x,y,z · 32767/scale), затем count×uint8[3] цвета.
import sys, struct, numpy as np
from scipy.spatial import cKDTree
src, dst, target = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 45000
f = open(src, 'rb'); hdr = b''
while True:
    l = f.readline(); hdr += l
    if l.strip() == b'end_header': break
n = int([l for l in hdr.split(b'\n') if l.startswith(b'element vertex')][0].split()[-1])
dt = np.dtype([('x', '<f4'), ('y', '<f4'), ('z', '<f4'), ('r', 'u1'), ('g', 'u1'), ('b', 'u1')])
a = np.frombuffer(f.read(n * dt.itemsize), dtype=dt, count=n)
P = np.stack([a['x'], a['y'], a['z']], 1).astype(np.float64)
C = np.stack([a['r'], a['g'], a['b']], 1).astype(np.float64)

# 1. Служебная разметка пайплайна (маджента) — перекрашиваем по соседям.
mag = (C[:, 0] > 170) & (C[:, 2] > 170) & (C[:, 1] < 110)
print('magenta', mag.sum())
if mag.any():
    t = cKDTree(P[~mag]); _, j = t.query(P[mag], k=6)
    C[mag] = C[~mag][j].mean(1)

# 2. Плоскость земли RANSAC → «вверх» так, чтобы куча была над землёй.
rng = np.random.default_rng(1)
best = (0, None)
S = P[rng.choice(len(P), min(len(P), 40000), replace=False)]
scale0 = np.ptp(P, 0).max()
for _ in range(400):
    i = rng.choice(len(S), 3, replace=False)
    nrm = np.cross(S[i[1]] - S[i[0]], S[i[2]] - S[i[0]]); L = np.linalg.norm(nrm)
    if L < 1e-12: continue
    nrm /= L; d = -nrm @ S[i[0]]
    inl = np.abs(S @ nrm + d) < 0.006 * scale0
    if inl.sum() > best[0]: best = (inl.sum(), (nrm, d))
nrm, d = best[1]
h = P @ nrm + d
if np.percentile(h, 95) < -np.percentile(h, 5): nrm, d, h = -nrm, -d, -h
print('ground inliers', best[0] / len(S))
# базис: up = nrm, e1/e2 — главные оси подошвы
Q = P - np.outer(h, nrm)
c = Q.mean(0)
Qc = Q - c
u, s, vt = np.linalg.svd(Qc[::7] - 0, full_matrices=False)
e1 = vt[0] - (vt[0] @ nrm) * nrm; e1 /= np.linalg.norm(e1); e2 = np.cross(nrm, e1)
X = (P - c) @ e1; Z = (P - c) @ e2; Y = np.clip(h, -0.02 * scale0, None)
R = np.percentile(np.hypot(X, Z), 98)
X, Y, Z = X / R, Y / R, Z / R
keep = np.hypot(X, Z) < 1.25
X, Y, Z, C = X[keep], Y[keep], Z[keep], C[keep]
print('height (radius units)', np.percentile(Y, 99.5))

# 3. Равномерное прореживание по вокселям.
V = np.stack([X, Y, Z], 1)
for vox in np.linspace(0.004, 0.05, 60):
    key = np.floor(V / vox).astype(np.int64)
    _, first = np.unique(key[:, 0] * 1_000_003 ** 2 + key[:, 1] * 1_000_003 + key[:, 2], return_index=True)
    if len(first) <= target: break
V, C = V[first], C[first]
V = V + rng.uniform(-0.5, 0.5, V.shape) * vox * 0.9   # ломаем сетку вокселей (муар)
# лёгкая тонировка: без розового оттенка, чуть контраста
lum = C @ [0.299, 0.587, 0.114]
C = lum[:, None] + (C - lum[:, None]) * 0.55
C = np.clip((C - 128) * 1.12 + 128, 0, 255).astype(np.uint8)
lim = float(np.abs(V).max()) * 1.001
q = np.round(V / lim * 32767).astype(np.int16)
height = float(np.percentile(V[:, 1], 99.5))
with open(dst, 'wb') as o:
    o.write(struct.pack('<4sIff', b'KSPC', len(V), lim, height))
    o.write(q.tobytes()); o.write(C.tobytes())
print('points', len(V), 'bytes', 16 + len(V) * 9, 'lim', lim, 'height', height)
np.save(dst + '.npy', np.hstack([V, C]))
