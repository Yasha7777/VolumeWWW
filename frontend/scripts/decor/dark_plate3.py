# Тёмная подложка прямо из пикселей макета (1536×1024):
#  • интерфейс (шапка, заголовок, панель, подписи, кресты) и кубы — стёрты и
#    заполнены фактурой фона, снятой с того же макета (tools/quilt_bg.py);
#  • мелкие «летающие» камни вырезаны в отдельные спрайты (для параллакса),
#    под ними — тоже фактура;
#  • крупные груды по краям остаются в подложке как есть;
#  • по бокам подложка продолжена отражением (2048 px) для широких экранов,
#    низ растворяется в фактуре — стык со страницей не виден.
import json
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi

OUT = '/home/claude/repo/frontend/src/components/obhod/img/'
a = np.asarray(Image.open('ref/dark_1536.png').convert('RGB')).astype(np.float32)
H, W = a.shape[:2]
L = a @ np.array([.299, .587, .114], np.float32)
tile = np.load('work/tex_dark_q.npy').astype(np.float32)          # 512×512
T = tile.shape[0]
EXT = 256                                                          # поля отражения
PW = W + 2 * EXT

# фактура в координатах подложки: x=0 подложки = центр страницы − 1024 px,
# фон страницы — тот же тайл с background-position: 50% −64px → сдвиг на полтайла
def texture(w, h, x0=0, y0=0):
    reps = (h // T + 2, w // T + 2, 1)
    big = np.tile(tile, reps)
    ox = (x0 + T // 2) % T
    return big[y0 % T:y0 % T + h, ox:ox + w]

tex = texture(W, H, EXT, 0)


def box(x0, y0, x1, y1, feather):
    m = np.zeros((H, W), np.float32)
    m[max(0, y0):y1, max(0, x0):x1] = 1
    if feather:
        m = cv2.GaussianBlur(m, (0, 0), feather)
        m = np.clip(m * 2, 0, 1)            # край остаётся на месте, растушёвка — наружу
    return m


fill = np.zeros((H, W), np.float32)
fill = np.maximum(fill, box(0, 0, W, 62, 0))                   # шапка (её перекрывает шапка сайта)
fill = np.maximum(fill, box(436, 74, 1108, 352, 14))           # заголовок, подзаголовок, шаги
PANEL = (92, 362, 1448, 958)                                    # панель вместе со свечением рамки
pm = box(PANEL[0] + 4, PANEL[1] + 4, PANEL[2] - 4, PANEL[3] - 4, 0)
pm = cv2.GaussianBlur(ndi.binary_dilation(pm > 0, iterations=6).astype(np.float32), (0, 0), 5)
fill = np.maximum(fill, pm)

# кубы макета — рисуем своими спрайтами
CUBES = [
    [(64, 185), (135, 221), (116, 267), (98, 271), (59, 257), (46, 220)],
    [(1195, 295), (1245, 272), (1284, 287), (1280, 347), (1245, 365), (1198, 347)],
    [(0, 809), (75, 787), (100, 812), (100, 887), (36, 900), (0, 884)],
]
cm = np.zeros((H, W), np.uint8)
for poly in CUBES:
    cv2.fillPoly(cm, [np.array(poly, np.int32)], 1)
cmf = cv2.GaussianBlur(ndi.binary_dilation(cm, iterations=4).astype(np.float32), (0, 0), 2.5)
fill = np.maximum(fill, np.clip(cmf * 1.6, 0, 1))

# летающие камни → спрайты
rock = np.load('work/rockmask.npy')
lab, n = ndi.label(rock)
SPR = {3: 'rock-m-01', 4: 'rock-m-02', 5: 'rock-m-03', 7: 'rock-m-04', 13: 'rock-m-05',
       6: 'rock-m-06', 9: 'rock-m-07', 10: 'rock-m-08', 14: 'rock-m-09'}
sprites = []
for cid, name in SPR.items():
    m = lab == cid
    m &= ~(cm.astype(bool))
    alpha = cv2.GaussianBlur(ndi.binary_dilation(m, iterations=3).astype(np.float32), (0, 0), 1.3)
    ys, xs = np.where(alpha > .02)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    rgba = np.dstack([a[y0:y1, x0:x1], alpha[y0:y1, x0:x1] * 255]).clip(0, 255).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    # 2× для ретины: камни мелкие, апскейл Lanczos + лёгкая резкость
    im2 = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
    im2.save(OUT + name + '.webp', quality=90, method=6)
    sprites.append({'s': name, 'x': int(x0), 'y': int(y0), 'w': int(x1 - x0)})
    under = cv2.GaussianBlur(ndi.binary_dilation(m, iterations=9).astype(np.float32), (0, 0), 2.5)
    fill = np.maximum(fill, np.clip(under * 1.5, 0, 1))

plate = a * (1 - fill[..., None]) + tex * fill[..., None]

# подписи и кресты: только штрихи (яркие тонкие детали), cv2.inpaint по маске
LABELS = [(30, 106, 162, 154), (190, 226, 362, 290), (1376, 202, 1526, 270), (1266, 230, 1304, 268),
          (1484, 476, 1522, 514), (26, 966, 234, 1010), (1304, 964, 1526, 1006)]
g = cv2.GaussianBlur(L, (0, 0), 1.0)
bgl = cv2.medianBlur(L.astype(np.uint8), 9).astype(np.float32)
strokes = np.zeros((H, W), np.uint8)
for x0, y0, x1, y1 in LABELS:
    s = (g[y0:y1, x0:x1] - bgl[y0:y1, x0:x1]) > 7
    strokes[y0:y1, x0:x1] = s
strokes = ndi.binary_dilation(strokes, iterations=2).astype(np.uint8)
pl8 = plate.clip(0, 255).astype(np.uint8)
inp = cv2.inpaint(pl8, strokes, 5, cv2.INPAINT_TELEA).astype(np.float32)
# inpaint гладкий — возвращаем зерно фактуры
k = cv2.GaussianBlur(strokes.astype(np.float32), (0, 0), 1.2)[..., None]
plate = inp + k * (tex - cv2.GaussianBlur(tex, (0, 0), 3))

# поля по бокам (для экранов шире 1536) — просто фактура; край кадра макета
# на широком экране гасит CSS-маска (камни у рамки уходят в темноту)
P = np.zeros((H, PW, 3), np.float32)
P[:, EXT:EXT + W] = plate
full_tex = texture(PW, H, 0, 0)
wx = np.zeros(PW, np.float32)
wx[EXT:EXT + W] = 1
# низ → фактура
wy = np.ones(H, np.float32)
wy[H - 90:] = np.linspace(1, 0, 90) ** 1.3
w2 = np.minimum.outer(wy, wx) if False else (wy[:, None] * wx[None, :])
P = P * w2[..., None] + full_tex * (1 - w2[..., None])

out = Image.fromarray(P.clip(0, 255).astype(np.uint8))
out.save(OUT + 'plate-dark.webp', quality=82, method=6)
Image.fromarray(tile.clip(0, 255).astype(np.uint8)).save(OUT + 'tex-dark.webp', quality=86, method=6)
out.crop((EXT, 0, EXT + W, H)).save('work/plate3_view.png')
json.dump(sprites, open('work/sprites_dark.json', 'w'))
print(json.dumps(sprites))
