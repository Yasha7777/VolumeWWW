import * as THREE from 'three';

// ============================================================
// plyAlign — выравнивание облака/меша по «земле».
//
// Сырой выход DUSt3R записан в системе координат опорной камеры
// (ось Y — вниз, Z — вперёд), без гравитации. Поскольку пользователь
// снимает под примерно одинаковым наклоном сверху, ВСЕ реконструкции
// получают ОДИН И ТОТ ЖЕ крен (~45°) — не от сцены к сцене, а от
// фиксированного угла съёмки. Правильный фикс — не хардкод-поворот,
// а восстановление «вверх» из самих данных: находим доминирующую
// плоскость земли (RANSAC) и разворачиваем её нормаль в +Y three.js.
//
// Применяется ОДИНАКОВО к PLY (points) и GLB (mesh), чтобы бочка
// стояла вертикально, а куча щебня лежала основанием на грид-полу.
// ============================================================

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

// Квартернион, выравнивающий геометрию «землёй вниз»: нормаль → +Y.
// Возвращает null, если плоскость земли не найдена уверенно.
function computeUpQuaternion(pts) {
  const plane = fitGroundPlane(pts);
  if (!plane) return null;

  // Нормаль должна смотреть В сторону массы объекта (вверх), а не в пол.
  const centroid = new THREE.Vector3();
  for (const p of pts) centroid.add(p);
  centroid.multiplyScalar(1 / pts.length);

  const toMass = centroid.clone().sub(plane.point);
  if (plane.normal.dot(toMass) < 0) plane.normal.negate();

  const up = new THREE.Vector3(0, 1, 0);
  return new THREE.Quaternion().setFromUnitVectors(plane.normal, up);
}

// Выравнивает BufferGeometry по земле (мутирует геометрию один раз).
// Идемпотентно: повторный вызов (StrictMode) не даёт двойного поворота.
export function levelGeometry(geometry) {
  if (!geometry || geometry.userData.__leveled) return;
  const posAttr = geometry.attributes.position;
  if (!posAttr) return;
  const q = computeUpQuaternion(samplePoints(posAttr.array, posAttr.count));
  if (q) geometry.applyQuaternion(q);
  geometry.userData.__leveled = true;
}

// Выравнивает целую сцену GLB: собирает мировые вершины всех мешей,
// оценивает «вверх» и разворачивает корень сцены. Идемпотентно.
export function levelObject(root) {
  if (!root || root.userData.__leveled) return;
  root.userData.__leveled = true;

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

  const q = computeUpQuaternion(pts);
  if (q) {
    root.quaternion.premultiply(q);
    root.updateMatrixWorld(true);
  }
}
