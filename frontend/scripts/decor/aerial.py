# Аэрофото карьера (генерация ChatGPT) → подложки карты 539×488 @2x, светлая и тёмная.
import numpy as np
from PIL import Image, ImageFilter
src = Image.open('gen/aerial_quarry.png').convert('RGB')
S = 1.24 * 2 / 2            # масштаб под карточку @2x: карьер ≈ линии выбранного обхода
W, H = 1078, 976
K = 1.16                     # кольцо карьера ≈ петля выбранного обхода (как на макете)
big = src.resize((round(1024 * K), round(1024 * K)), Image.LANCZOS)
PAD = 120                    # края отражаем: сдвиг под геометрию маршрутов уводит кадр за границу
big = Image.fromarray(np.pad(np.asarray(big), ((PAD, PAD), (PAD, PAD), (0, 0)), mode='reflect'))
pit = (550 * K + PAD, 480 * K + PAD)          # центр карьера в исходнике ≈ (550, 480)
loop = (329 * 2, 277 * 2)                     # центр петли выбранного обхода, карточка @2x
ox, oy = round(pit[0] - loop[0]), round(pit[1] - loop[1])
crop = big.crop((ox, oy, ox + W, oy + H))
a = np.asarray(crop).astype(np.float32) / 255
lum = (a * [0.299, 0.587, 0.114]).sum(-1, keepdims=True)
yy, xx = np.mgrid[0:H, 0:W]
d = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)[..., None]

# светлая: бледный спутник, как в светлом макете — зелёно-бежевый, мало контраста
L = lum + (a - lum) * 0.55
L = L * np.array([0.98, 1.0, 0.94])
paper = np.array([0.905, 0.9, 0.845])
L = paper * 0.44 + L * 0.56
L = (L - 0.66) * 1.0 + 0.73
L = L * (1 - 0.06 * np.clip(d - 0.6, 0, 1))
Image.fromarray((np.clip(L, 0, 1) * 255).astype(np.uint8)).save('/home/claude/repo/frontend/src/components/obhod/img/map-terrain-light.webp', quality=82, method=6)

# тёмная: почти чёрный спутник с серыми деталями, как в тёмном макете
D = lum + (a - lum) * 0.28
D = np.clip(D, 0, 1) ** 1.75 * 0.5
D = D * np.array([0.95, 1.0, 0.96])
D = D * (1 - 0.35 * np.clip(d - 0.55, 0, 1))
Image.fromarray((np.clip(D, 0, 1) * 255).astype(np.uint8)).save('/home/claude/repo/frontend/src/components/obhod/img/map-terrain-dark.webp', quality=82, method=6)
print('ok')
