import * as THREE from 'three';

// ============================================================
// plyAlign — выравнивание облака/меша по «вверх».
//
// Сырой выход DUSt3R записан в системе координат опорной камеры
// (ось Y — вниз, Z — вперёд), без гравитации. Поскольку пользователь
// снимает под примерно одинаковым наклоном сверху, ВСЕ реконструкции
// получают ОДИН И ТОТ ЖЕ крен — не от сцены к сцене, а от угла съёмки.
//
// ДВА РЕЖИМА:
//  1. up-вектор передан извне (честно посчитан пайплайном при
//     heightfield-интегрировании, СО знаком) — применяем его напрямую,
//     без RANSAC и без угадывания знака. Это надёжно для любого объекта.
//  2. up-вектор недоступен (старые записи) — ФОЛБЭК: RANSAC находит
//     доминирующую плоскость и убирает КРЕН (плоскость → горизонт).
//     Знак «вверх» НЕ угадываем по массе (ломается на симметричных
//     объектах — бочка вставала вверх дном): берём канонический знак,
//     модель может оказаться перевёрнутой, но не лежит на боку.
//
// Применяется ОДИНАКОВО к PLY (points) и GLB (mesh).
// ============================================================

// Квартернион, выравнивающий заданный up-вектор данных в +Y three.js.
// up — [x,y,z] или THREE.Vector3 в системе координат самой геометрии.
function quaternionFromUp(up) {
  // up отсутствует (частый случай: пайплайн не записал up_vector) → null,
  // чтобы вызывающий ушёл в RANSAC-фолбэк. Без этого гварда ветка ниже
  // звала null.clone() и роняла весь three-стек (белый экран на здоровых
  // анализах без up-вектора).
  if (!up) return null;
  const v = Array.isArray(up)
    ? new THREE.Vector3(up[0], up[1], up[2])
    : up.clone();
  if (!(v.lengthSq() > 1e-12)) return null;
  v.normalize();
  return new THREE.Quaternion().setFromUnitVectors(v, new THREE.Vector3(0, 1, 0));
}

// Собираем до maxSamples точек из позиций (Float32Array-подобное).
function samplePoints(positions, count, maxSamples = 20000) {
  const step = Math.max(1, Math.floor(count / maxSamples));
  const pts = [];
  for (let i = 0; i < count; i += step) {
    pts.push(new THREE.Vector3(
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
    ));
  }
  return pts;
}

// RANSAC: доминирующая плоскость (земля, на которой стоит объект).
function fitGroundPlane(pts, iterations = 250) {
  const n = pts.length;
  if (n < 3) return null;

  // Порог инлайера ~1.5% диагонали облака.
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of pts) { min.min(p); max.max(p); }
  const diag = min.distanceTo(max);
  if (!(diag > 0)) return null;
  const thr = diag * 0.015;

  let best = null;
  let bestInliers = -1;
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();

  for (let it = 0; it < iterations; it++) {
    const a = pts[(Math.random() * n) | 0];
    const b = pts[(Math.random() * n) | 0];
    const c = pts[(Math.random() * n) | 0];
    v1.subVectors(b, a);
    v2.subVectors(c, a);
    nrm.crossVectors(v1, v2);
    const len = nrm.length();
    if (len < 1e-9) continue;
    nrm.multiplyScalar(1 / len);

    let inliers = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const d = nrm.x * (p.x - a.x) + nrm.y * (p.y - a.y) + nrm.z * (p.z - a.z);
      if (d < thr && d > -thr) inliers++;
    }
    if (inliers > bestInliers) {
      bestInliers = inliers;
      best = { normal: nrm.clone(), point: a.clone() };
    }
  }
  return best;
}

// ФОЛБЭК-квартернион: убирает только КРЕН по доминирующей плоскости.
// Знак нормали НЕ угадываем по массе объекта — берём канонический
// (компонента Y в системе данных ≥ 0), чтобы результат был
// детерминирован и модель не лежала на боку. Возможная перевёрнутость
// вверх дном — допустимый временный компромисс без up-вектора.
function computeFallbackQuaternion(pts) {
  const plane = fitGroundPlane(pts);
  if (!plane) return null;
  if (plane.normal.y < 0) plane.normal.negate();  // канонический знак
  const up = new THREE.Vector3(0, 1, 0);
  return new THREE.Quaternion().setFromUnitVectors(plane.normal, up);
}

// Выравнивает BufferGeometry (мутирует геометрию один раз). Идемпотентно.
// up — [x,y,z] из пайплайна (предпочтительно). Если не передан — фолбэк.
export function levelGeometry(geometry, up = null) {
  if (!geometry || geometry.userData.__leveled) return;
  const posAttr = geometry.attributes.position;
  if (!posAttr) return;
  const q = quaternionFromUp(up)
    || computeFallbackQuaternion(samplePoints(posAttr.array, posAttr.count));
  if (q) geometry.applyQuaternion(q);
  geometry.userData.__leveled = true;
}

// Выравнивает сцену GLB (разворачивает корень). Идемпотентно.
// up — [x,y,z] из пайплайна (предпочтительно). Если не передан — фолбэк.
export function levelObject(root, up = null) {
  if (!root || root.userData.__leveled) return;
  root.userData.__leveled = true;

  let q = quaternionFromUp(up);
  if (!q) {
    root.updateMatrixWorld(true);
    const pts = [];
    const v = new THREE.Vector3();
    root.traverse((child) => {
      const posAttr = child.isMesh && child.geometry?.attributes?.position;
      if (!posAttr) return;
      const count = posAttr.count;
      const step = Math.max(1, Math.floor(count / 20000));
      for (let i = 0; i < count; i += step) {
        v.fromBufferAttribute(posAttr, i).applyMatrix4(child.matrixWorld);
        pts.push(v.clone());
      }
    });
    q = computeFallbackQuaternion(pts);
  }
  if (q) {
    root.quaternion.premultiply(q);
    root.updateMatrixWorld(true);
  }
}
