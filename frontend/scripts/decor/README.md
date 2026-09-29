# Декор страницы «Анализ» — откуда картинки

Скрипты, которыми собраны картинки в `src/components/obhod/img/`. Запускались из
рабочей папки с макетами (`ref/dark_1536.png`, `ref/light_1536.png` — макеты 1536×1024)
и `gen/aerial_quarry.png` (аэрофото карьера).

- `quilt_bg.py dark|light` — бесшовная фактура фона (`tex-dark.webp`, `tex-light.webp`)
  из чистых участков макета (image quilting).
- `dark_plate3.py` — `plate-dark.webp`: подложка тёмной темы прямо из пикселей макета,
  интерфейс стёрт и заполнен фактурой; мелкие камни вырезаны в `rock-m-*.webp`.
- `light_decomp.py` — светлая тема: каждый камень и камешек макета — отдельный спрайт
  (`rock-lm-*.webp`, `peb-m-*.webp`), тень рисует страница.
- `aerial.py` — `map-terrain-light/dark.webp`: подложка карты из аэрофото карьера.

Раскладка спрайтов — `src/components/obhod/decor.js` (координаты холста 1536×1024).
