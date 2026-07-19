# PROGRESS

<!-- Каждая значимая правка — новой строкой: что изменил и в каком файле. -->

- Hero переведён на scroll-scrubbed сборку кучи (прогресс = scrollY секции, без setTimeout): `frontend/src/components/three/CubesHeroImpl.jsx` — переписан на две текстурированные InstancedMesh (гравий-додекаэдры + песок-икосаэдры), сборка/рассыпание строго по позиции скролла, prefers-reduced-motion → статичная собранная куча.
- Сгенерированы и добавлены текстуры материала (higgsfield nano_banana): `frontend/public/textures/gravel.png`, `frontend/public/textures/sand.png` (карельская палитра: камень/охра/лес).
- Канвас героя сделан fixed во вьюпорте (sticky на время эффекта, гаснет после сборки): `frontend/src/styles.css` (.hero .kb-hero3d → position: fixed).
- Скролл резче: Lenis duration 1.05→0.6, добавлены lerp 0.12 и cubic-out easing: `frontend/src/components/SmoothScroll.jsx`.
- Удалён `frontend/public/models/cube_and_cave.glb` (40 МБ, раздувал деплой).
- Рельеф hero: normal-карта выводится из самих текстур (Sobel по яркости → tangent-space DataTexture, seamless) и наложена на meshStandardMaterial обеих InstancedMesh (normalMap + normalScale): `frontend/src/components/three/CubesHeroImpl.jsx`. Кредиты higgsfield не тратил — derived normal точнее AI-карты.
- Куча плотнее и выше: R/H в buildParticles → компактный вариант (gravel R2.5→2.1, H2.3→2.9; sand R3.1→2.7). Раскидистый вариант оставлен закомментированным рядом: `frontend/src/components/three/CubesHeroImpl.jsx`.
- Гашение канваса мягче: старт fade vh*1.0→vh*1.35, диапазон vh*0.6→vh*0.9 (куча дольше видна собранной): `frontend/src/components/three/CubesHeroImpl.jsx`.
- Читаемость заголовка (композиция hero): `frontend/src/components/three/CubesHeroImpl.jsx` + `frontend/src/styles.css`:
  - text-safe zone — эллипс SAFE по центру кадра; buildParticles пере-бросает точки кучи И рассыпа, чтобы частицы (гравий+песок) не лезли на текст, а обрамляли его (Particles теперь считает count = data.length);
  - скрим `.hero-scrim` — мягкий радиальный vignette var(--bg) поверх канваса и под текстом (внутри .kb-hero3d, гаснет вместе с ним);
  - калибровочные кубы — 7 шт., процедурная ч/б шахматка 4×4 (CanvasTexture, без внешних моделей), крупнее гравия, медленно вращаются, участвуют в scroll-скрабе, расставлены вне safe-zone;
  - контактная тень под кучей (drei ContactShadows, frames=1 при reduced-motion) — куча стоит на земле.
