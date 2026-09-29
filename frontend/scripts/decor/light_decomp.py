# Светлая тема из пикселей макета: каждый камень и камешек — отдельный спрайт
# (RGBA, края «размешаны» с бумагой), на своём месте холста 1536×1024.
# Тень у спрайтов не запекаем — её рисует страница и двигает от курсора.
# Бумага — бесшовный тайл из чистых участков того же макета (quilting).
import json
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi

OUT = '/home/claude/repo/frontend/src/components/obhod/img/'
a = np.asarray(Image.open('ref/light_1536.png').convert('RGB')).astype(np.float32)
H, W = a.shape[:2]
L = a @ np.array([.299, .587, .114], np.float32)

# бумага: закрытие убирает тёмное (камни, тени), размытие — зерно
K = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))
pap = np.dstack([cv2.GaussianBlur(cv2.morphologyEx(cv2.GaussianBlur(a[..., c], (0, 0), 2), cv2.MORPH_CLOSE, K), (0, 0), 10) for c in range(3)])
papL = pap @ np.array([.299, .587, .114], np.float32)
d = papL - cv2.GaussianBlur(L, (0, 0), 1.0)
# закрытие берёт светлые зёрна — бумага выходит светлее настоящей; снимаем смещение,
# иначе у камней светлый ореол
cl0 = (d < 4) & (np.abs(cv2.GaussianBlur(L, (0, 0), 3) - papL) < 6)
bias = np.median((pap - cv2.GaussianBlur(a, (0, 0), 2))[cl0], axis=0)
print('paper bias', bias.round(2))
pap = pap - bias
papL = pap @ np.array([.299, .587, .114], np.float32)
d = papL - cv2.GaussianBlur(L, (0, 0), 1.0)

UI = [(0, 0, W, 68), (436, 74, 1108, 352), (92, 362, 1448, 958), (30, 120, 160, 165), (200, 210, 345, 262),
      (1380, 200, 1515, 262), (28, 962, 234, 1004), (1304, 968, 1520, 1004), (1466, 968, 1506, 1004)]
ui = np.zeros((H, W), bool)
for x0, y0, x1, y1 in UI:
    ui[y0:y1, x0:x1] = True

m = (d > 7) & ~ui
m = ndi.binary_opening(m, iterations=1)
m = ndi.binary_fill_holes(ndi.binary_closing(m, iterations=3))
lab, n = ndi.label(m)
sizes = ndi.sum(m, lab, range(1, n + 1))

# ядро камня (без мягкой тени): темнее бумаги заметно; дырки (светлые блики) заливаем
# бледный гранит почти как бумага по яркости, но у него есть зерно: берём и локальный разброс
mu = cv2.GaussianBlur(L, (0, 0), 2.5); sd = np.sqrt(np.maximum(cv2.GaussianBlur(L * L, (0, 0), 2.5) - mu * mu, 0))
core_all = ((d > 13) | ((sd > 7) & (d > 2))) & ~ui
core_all = ndi.binary_opening(core_all, iterations=1)
core_all = ndi.binary_fill_holes(ndi.binary_closing(core_all, iterations=3))
# кромка бумаги у камня (разброс там высокий из-за перепада) — выкидываем: гладкое и светлое
mu1 = cv2.GaussianBlur(L, (0, 0), 1.0); sd1 = np.sqrt(np.maximum(cv2.GaussianBlur(L * L, (0, 0), 1.0) - mu1 * mu1, 0))
paperish = (papL - L) < 7
core_loose = core_all.copy()
core_all &= ~paperish
core_all = ndi.binary_opening(core_all, iterations=1)
core_all = ndi.binary_fill_holes(core_all)
alpha_edge = np.clip((d - 2.5) / 9, 0, 1)             # мягкий край там, где ядро кончается

sprites = []
k = 0
for i, sl in enumerate(ndi.find_objects(lab)):
    if sizes[i] < 40:
        continue
    comp = lab == i + 1
    core = core_all & ndi.binary_dilation(comp, iterations=2)
    if core.sum() < 25:
        core = comp & (d > 9)
        if core.sum() < 20:
            continue
    core = ndi.binary_fill_holes(core)
    # бледный гранит строгий порог «съедает» — берём мягкое ядро, чуть подрезав край
    loose = ndi.binary_fill_holes(core_loose & ndi.binary_dilation(comp, iterations=2))
    if core.sum() < .8 * loose.sum():
        core = ndi.binary_erosion(loose, iterations=2) | core
        core = ndi.binary_fill_holes(ndi.binary_closing(core, iterations=2))
    soft = cv2.GaussianBlur(ndi.binary_dilation(core, iterations=1).astype(np.float32), (0, 0), .9)
    # альфа — только само тело камня (мягкий край 1 px), без запечённой тени и ореола бумаги
    alpha = np.clip(cv2.GaussianBlur(core.astype(np.float32), (0, 0), .75) * 1.15 - .08, 0, 1)
    # у края кадра макета камни обрезаны — гасим, чтобы на широком экране не было среза
    xx = np.arange(W)[None, :]; yy = np.arange(H)[:, None]
    edge = np.clip(np.minimum(np.minimum(xx - 3, W - 1 - xx), np.minimum(yy - 68, H - 1 - yy)) / 18, 0, 1) if False else \
        np.clip(np.minimum(xx - 3, W - 4 - xx) / 20, 0, 1) * np.ones((H, 1))
    alpha = alpha * edge
    ys, xs = np.where(alpha > .03)
    if len(xs) == 0:
        continue
    x0, x1, y0, y1 = max(0, xs.min() - 1), min(W, xs.max() + 2), max(0, ys.min() - 1), min(H, ys.max() + 2)
    A = alpha[y0:y1, x0:x1][..., None]
    P = pap[y0:y1, x0:x1]
    col = (a[y0:y1, x0:x1] - P * (1 - A)) / np.maximum(A, .08)
    # почти прозрачные пиксели — цвет бумаги (иначе мусор даёт ореол при ресайзе)
    t = np.clip((A - .03) / .2, 0, 1)
    col = P + (col - P) * t
    col = col.clip(0, 255)
    # 2× для ретины: ресайз в premultiplied, чтобы края не светлели/не темнели
    pm = np.dstack([col * A, A * 255]).astype(np.float32)
    big = np.dstack([np.asarray(Image.fromarray(pm[..., c]).resize(((x1 - x0) * 2, (y1 - y0) * 2), Image.LANCZOS)) for c in range(4)])
    Ab = np.clip(big[..., 3:4] / 255, 0, 1)
    colb = np.where(Ab > 1e-3, big[..., :3] / np.maximum(Ab, 1e-3), 0)
    rgba2 = np.dstack([colb.clip(0, 255), Ab[..., 0] * 255]).astype(np.uint8)
    rgba = np.dstack([col, (A[..., 0] * 255)]).astype(np.uint8)
    k += 1
    name = f'peb-m-{k:02d}' if (x1 - x0) < 34 else f'rock-lm-{k:02d}'
    Image.fromarray(rgba2, 'RGBA').save(OUT + name + '.webp', quality=88, method=6)
    sprites.append({'s': name, 'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0)})

json.dump(sprites, open('work/sprites_light.json', 'w'))
print(len(sprites), 'sprites')

# проверка вырезки: на пурпуре
chk = np.zeros((H, W, 3), np.float32) + [180, 40, 160]
for sp in sprites:
    im = np.asarray(Image.open(OUT + sp['s'] + '.webp').resize((sp['w'], sp['h']), Image.LANCZOS)).astype(np.float32)
    A = im[..., 3:4] / 255
    reg = chk[sp['y']:sp['y'] + sp['h'], sp['x']:sp['x'] + sp['w']]
    reg[:] = reg * (1 - A) + im[..., :3] * A
Image.fromarray(chk.astype(np.uint8)).save('work/light_sprites_check.png')

# бумага: тайл из чистых участков (детали) + цвет бумаги макета
clean = (d < 2.5) & ~ui & ~ndi.binary_dilation(m, iterations=10)
np.save('work/clean_light.npy', clean)
print('paper mean', a[clean].mean(0).round(1))
