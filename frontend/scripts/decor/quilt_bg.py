# Фактура фона тёмной темы — из чистых участков самого макета (image quilting,
# Efros & Freeman) + бесшовность через сдвиг на полтайла с сохранением дисперсии.
import numpy as np, cv2
from PIL import Image

rng = np.random.default_rng(7)
import sys
THEME = sys.argv[1] if len(sys.argv) > 1 else 'dark'
a = np.asarray(Image.open(f'ref/{THEME}_1536.png').convert('RGB')).astype(np.float32)
clean = np.load('work/clean.npy' if THEME == 'dark' else 'work/clean_light.npy')
H, W = clean.shape
P, O = 40, 10
S = P - O
# кандидаты: патч целиком в чистой зоне
ii = cv2.integral(clean.astype(np.uint8))
ys, xs = np.mgrid[0:H - P, 0:W - P]
cnt = ii[ys + P, xs + P] - ii[ys, xs + P] - ii[ys + P, xs] + ii[ys, xs]
cand = np.argwhere(cnt == P * P)
cand = cand[rng.permutation(len(cand))[:2500]]
print('candidates', len(cand))
# только деталь: без крупных пятен (иначе полосы на стыках), без ярких линий разметки
cm = clean.astype(np.float32)[..., None]
num = cv2.GaussianBlur(a * cm, (0, 0), 9); den = cv2.GaussianBlur(cm[..., 0], (0, 0), 9)[..., None]
low_a = num / np.maximum(den, 1e-3)
D = a - low_a
Lg = a @ np.array([.299, .587, .114], np.float32)
ok = np.array([(Lg[y:y + P, x:x + P].max() < 52) if THEME == 'dark' else (Lg[y:y + P, x:x + P].min() > 222) for y, x in cand])
cand = cand[ok]
print('after line filter', len(cand))
patches = np.stack([D[y:y + P, x:x + P] for y, x in cand])

N = 20
out = np.zeros((S * N + O, S * N + O, 3), np.float32)


def mincut(err):  # err: (h, w) — путь сверху вниз
    h, w = err.shape
    E = err.copy()
    for i in range(1, h):
        l = np.r_[np.inf, E[i - 1, :-1]]
        r = np.r_[E[i - 1, 1:], np.inf]
        E[i] += np.minimum(np.minimum(l, E[i - 1]), r)
    path = np.zeros(h, int)
    path[-1] = np.argmin(E[-1])
    for i in range(h - 2, -1, -1):
        j = path[i + 1]
        lo, hi = max(0, j - 1), min(w, j + 2)
        path[i] = lo + np.argmin(E[i, lo:hi])
    m = np.zeros((h, w), bool)
    for i, j in enumerate(path):
        m[i, j:] = True        # True = новый патч
    return m


for r in range(N):
    for c in range(N):
        y, x = r * S, c * S
        if r == 0 and c == 0:
            out[y:y + P, x:x + P] = patches[0]
            continue
        cost = np.zeros(len(patches))
        if c > 0:
            cost += ((patches[:, :, :O] - out[y:y + P, x:x + O]) ** 2).sum((1, 2, 3))
        if r > 0:
            cost += ((patches[:, :O, :] - out[y:y + O, x:x + P]) ** 2).sum((1, 2, 3))
        best = np.argsort(cost)[:6]
        p = patches[rng.choice(best)]
        mask = np.ones((P, P), bool)
        if c > 0:
            e = ((p[:, :O] - out[y:y + P, x:x + O]) ** 2).sum(-1)
            mask[:, :O] &= mincut(e)
        if r > 0:
            e = ((p[:O, :] - out[y:y + O, x:x + P]) ** 2).sum(-1).T
            mask[:O, :] &= mincut(e).T
        region = out[y:y + P, x:x + P]
        region[mask] = p[mask]

T = 512
tex = out[:T, :T]
# бесшовность: края заменяем содержимым, сдвинутым на полтайла
rolled = np.roll(tex, (T // 2, T // 2), (0, 1))
d = np.minimum.outer(np.minimum(np.arange(T), T - 1 - np.arange(T)), np.minimum(np.arange(T), T - 1 - np.arange(T)))
w = np.clip((d - 4) / 44, 0, 1)[..., None]
w = w * w * (3 - 2 * w)
low = lambda im: cv2.GaussianBlur(im, (0, 0), 6)
lt, lr = low(tex), low(rolled)
base = w * lt + (1 - w) * lr
det = w * (tex - lt) + (1 - w) * (rolled - lr)
det /= np.sqrt(w ** 2 + (1 - w) ** 2)
res = base + det
# цвет фона макета + еле заметные крупные пятна (fbm) — без них плоско
BASE = np.array([15.2, 15.6, 14.9] if THEME == 'dark' else [242.0, 237.4, 227.6], np.float32)
def pnoise(sigma_f, seed):  # периодический гладкий шум через спектр
    r = np.random.default_rng(seed).normal(size=(T, T))
    fy = np.fft.fftfreq(T)[:, None]; fx = np.fft.fftfreq(T)[None, :]
    F = np.fft.fft2(r) * np.exp(-(fx ** 2 + fy ** 2) / (2 * sigma_f ** 2))
    n = np.real(np.fft.ifft2(F)); return (n - n.mean()) / n.std()
f = (pnoise(3 / T, 11) + .6 * pnoise(9 / T, 12)).astype(np.float32)
f /= f.std()
res = res + BASE + f[..., None] * (1.6 if THEME == 'dark' else 1.1)
print('mean', res.mean((0, 1)).round(2), 'std', res.std().round(2))
Image.fromarray(res.clip(0, 255).astype(np.uint8)).save(f'work/tex_{THEME}_q.png')
np.save(f'work/tex_{THEME}_q.npy', res)
if THEME == 'light': Image.fromarray(res.clip(0, 255).astype(np.uint8)).save('/home/claude/repo/frontend/src/components/obhod/img/tex-light.webp', quality=88, method=6)
# проверка шва: 2×2
t2 = np.tile(res, (2, 2, 1))
Image.fromarray(((t2 * 2.2) if THEME == 'dark' else (t2 - 200) * 5).clip(0, 255).astype(np.uint8)).save(f'work/tex_{THEME}_q_tile.png')
