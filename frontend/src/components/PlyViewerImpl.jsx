import React, { Suspense, useState, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Html, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import * as THREE from 'three';
import { levelGeometry, levelObject } from './plyAlign';
import { robustBounds, fitDistance, pointSizeFor, niceStep } from './viewerFit';

// ============================================================
// PlyViewerImpl — реализация 3D-просмотра (бывший PlyViewer.jsx).
// ТЯЖЁЛЫЙ модуль: тянет весь three-стек. Импортируется ТОЛЬКО
// через React.lazy из PlyViewer.jsx — не импортируй напрямую!
//
// Оформление (фон, кнопки, подсказка) — классы .pv* в styles.css.
// ============================================================

// Откуда смотрим по умолчанию: три четверти сверху, ~28° над горизонтом.
const VIEW_DIR = new THREE.Vector3(0.75, 0.56, 0.75).normalize();
// Поля вокруг модели: 1 — впритык к краям кадра.
const FIT_MARGIN = 1.16;

// === 1. КАМЕРА ПО ГРАНИЦАМ ОСНОВНОЙ МАССЫ ТОЧЕК ===
// nonce меняется по кнопке «Сбросить вид» — эффект отрабатывает заново.
const CameraFit = ({ size, radius, nonce }) => {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  React.useEffect(() => {
    if (!size) return;
    const dist = fitDistance(
      radius, size.y, VIEW_DIR.toArray(), camera.fov, camera.aspect,
    ) * FIT_MARGIN;

    camera.position.copy(VIEW_DIR).multiplyScalar(dist);
    camera.near = dist * 0.01;
    camera.far = dist * 60;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);

    if (controls) {
      controls.target.set(0, 0, 0);
      controls.minDistance = dist * 0.08;
      controls.maxDistance = dist * 6;
      controls.update();
    }
  }, [size, radius, nonce, camera, controls]);
  return null;
};

// === 2А. ОБЛАКО ТОЧЕК (PLY) ===
const PlyModel = ({ url, up, onReady }) => {
  const geometry = useLoader(PLYLoader, url);
  const [pointSize, setPointSize] = useState(0.006);

  React.useEffect(() => {
    if (!geometry) return;
    // Выравниваем «вверх» → +Y ДО расчёта границ, чтобы центрирование,
    // размеры и сетка-пол были в исправленной системе. up из пайплайна;
    // если его нет — фолбэк по доминирующей плоскости (только крен).
    levelGeometry(geometry, up);

    const pos = geometry.attributes.position;
    // Границы — по основной массе точек, а не по улётам (см. viewerFit.js).
    const b = robustBounds(pos.array);
    if (!b) return;
    geometry.translate(-b.center[0], -b.center[1], -b.center[2]);
    geometry.computeBoundingSphere();

    setPointSize(pointSizeFor(2 * b.radius, pos.count));
    onReady({ size: new THREE.Vector3(b.size[0], b.size[1], b.size[2]), radius: b.radius });
  }, [geometry, up, onReady]);

  const hasColors = geometry.attributes.color != null;

  return (
    <points geometry={geometry}>
      <pointsMaterial
        size={pointSize}
        vertexColors={hasColors}
        color={hasColors ? undefined : '#9fc7a8'}
        sizeAttenuation
        transparent
        opacity={0.95}
      />
    </points>
  );
};

// Вершины всех мешей сцены в мировых координатах — плоским массивом
// (с прореживанием: для границ хватает нескольких десятков тысяч).
function sampleWorldPositions(root, maxSamples = 40000) {
  root.updateMatrixWorld(true);
  let total = 0;
  root.traverse((c) => { if (c.isMesh && c.geometry?.attributes?.position) total += c.geometry.attributes.position.count; });
  const step = Math.max(1, Math.ceil(total / maxSamples));
  const out = [];
  const v = new THREE.Vector3();
  root.traverse((c) => {
    const pos = c.isMesh && c.geometry?.attributes?.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  });
  return out;
}

// === 2Б. ТВЕРДОТЕЛЬНАЯ МОДЕЛЬ (GLB) ===
// DUSt3R генерирует меш с вертекс-цветами без KHR_materials_unlit.
// Без замены материала Three.js применяет PBR — всё выглядит тёмным.
// Решение: принудительно ставим MeshBasicMaterial с vertexColors.
const GlbModel = ({ url, up, onReady }) => {
  const gltf = useLoader(GLTFLoader, url);

  React.useEffect(() => {
    if (!gltf?.scene) return;

    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        const hasColors = child.geometry?.attributes?.color != null;
        child.material = new THREE.MeshBasicMaterial({
          vertexColors: hasColors,
          color: hasColors ? undefined : new THREE.Color(0xaaaaaa),
          side: THREE.DoubleSide,
        });
        child.material.needsUpdate = true;
      }
    });

    // Выравниваем «вверх» → +Y — тем же способом, что и PLY, чтобы меш
    // и облако были ориентированы согласованно.
    levelObject(gltf.scene, up);

    // Сцена кешируется загрузчиком: при возврате «Облако → Меш» эффект
    // идёт по той же сцене второй раз. Сдвиг сначала обнуляем — иначе
    // второй проход мерил уже сдвинутую модель и возвращал её в исходное
    // место, и меш уезжал из центра.
    gltf.scene.position.set(0, 0, 0);
    const b = robustBounds(sampleWorldPositions(gltf.scene));
    if (!b) return;
    gltf.scene.position.set(-b.center[0], -b.center[1], -b.center[2]);

    onReady({ size: new THREE.Vector3(b.size[0], b.size[1], b.size[2]), radius: b.radius });
  }, [gltf, url, up, onReady]);

  return <primitive object={gltf.scene} />;
};

// === 3. ЛОАДЕР ===
const StyledLoader = () => (
  <Html center>
    <div className="pv__busy pv__busy--chip">
      <div className="pv__spin" />
      <span>Загрузка 3D модели...</span>
    </div>
  </Html>
);

// === 4. СЦЕНА (внутри Canvas) ===
const Scene = ({ url, mode, up, upGlb, yaw180, onLoaded, autoRotate, onInteract, fitNonce }) => {
  // PLY и GLB экспортируются пайплайном в РАЗНЫХ системах координат
  // (меш дополнительно повёрнут), поэтому up-вектор у них свой. Если
  // отдельного up для GLB нет — используем общий (лучше, чем ничего).
  const activeUp = mode === 'glb' ? (upGlb || up) : up;

  const [modelInfo, setModelInfo] = useState(null);

  const handleReady = useCallback((info) => {
    setModelInfo(info);
    onLoaded();
  }, [onLoaded]);

  // Сетка-пол: шаг — «круглое» число около 1/10 поперечника модели.
  const span = modelInfo ? (2 * modelInfo.radius) || 1 : 1;
  const cell = niceStep(span / 10);
  // На узком холсте (телефон) подсказка занимает весь низ — оси поднимаем над ней.
  const narrow = useThree((s) => s.size.width) < 480;

  return (
    <>
      <ambientLight intensity={mode === 'ply' ? 1.5 : 0.2} />

      <Suspense fallback={<StyledLoader />}>
        {/* yaw180 — доворот модели на 180° вокруг Y (по просьбе для истории).
            Модель центрирована в (0,0,0), поэтому поворот вокруг Y-оси на месте. */}
        <group rotation-y={yaw180 ? Math.PI : 0}>
          {mode === 'glb'
            ? <GlbModel url={url} up={activeUp} onReady={handleReady} />
            : <PlyModel url={url} up={activeUp} onReady={handleReady} />
          }
        </group>
        {modelInfo && <CameraFit size={modelInfo.size} radius={modelInfo.radius} nonce={fitNonce} />}
      </Suspense>

      {modelInfo && (
        <Grid
          position={[0, -(modelInfo.size.y / 2) - span * 0.004, 0]}
          args={[span * 10, span * 10]}
          cellSize={cell}
          cellThickness={0.6}
          cellColor="#39413c"
          sectionSize={cell * 5}
          sectionThickness={1}
          sectionColor="#5b665f"
          fadeDistance={span * 5.5}
          fadeStrength={1.8}
          followCamera={false}
          infiniteGrid
        />
      )}

      <GizmoHelper alignment="bottom-left" margin={narrow ? [54, 96] : [58, 58]}>
        <GizmoViewport axisColors={['#d9655f', '#7bc79a', '#c9a24a']} labelColor="#101211" />
      </GizmoHelper>

      <OrbitControls
        makeDefault
        autoRotate={autoRotate && !!modelInfo}
        autoRotateSpeed={0.45}
        enableDamping
        dampingFactor={0.07}
        maxPolarAngle={Math.PI * 0.85}
        onStart={onInteract}
      />
    </>
  );
};

// На телефоне мыши нет — подсказка про пальцы.
const TOUCH = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(pointer: coarse)').matches;

const ResetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
  </svg>
);

// === 5. ГЛАВНЫЙ КОМПОНЕНТ ===
// Принимает plyUrl и glbUrl отдельно, показывает свитч если есть оба.
// height — настраиваемая высота контейнера (по умолчанию 480px).
const PlyViewerImpl = ({ plyUrl, glbUrl, up = null, upGlb = null, yaw180 = false, height = '480px' }) => {
  const hasGlb = !!glbUrl;
  const hasPly = !!plyUrl;

  const [mode, setMode] = useState(hasGlb ? 'glb' : 'ply');
  const [loaded, setLoaded] = useState(false);
  // Модель медленно вращается сама, пока человек её не тронул: дальше
  // вид принадлежит ему. «Сбросить вид» возвращает и ракурс, и вращение.
  const [autoRotate, setAutoRotate] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);

  const activeUrl = mode === 'glb' ? glbUrl : plyUrl;

  const handleModeSwitch = (newMode) => {
    if (newMode === mode) return;
    setLoaded(false);
    setAutoRotate(true);
    setMode(newMode);
  };

  const handleLoaded = useCallback(() => setLoaded(true), []);
  const handleInteract = useCallback(() => setAutoRotate(false), []);
  const resetView = () => { setFitNonce((n) => n + 1); setAutoRotate(true); };

  if (!activeUrl) return null;

  return (
    <div className="pv" style={{ height }}>

      {/* СВИТЧ GLB / PLY */}
      {hasGlb && hasPly && (
        <div className="pv__seg" role="group" aria-label="Вид модели">
          {[
            { key: 'glb', label: 'Меш' },
            { key: 'ply', label: 'Облако' },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={mode === key ? 'is-on' : ''}
              aria-pressed={mode === key}
              onClick={() => handleModeSwitch(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {loaded && (
        <button type="button" className="pv__reset" onClick={resetView} title="Вернуть исходный вид">
          <ResetIcon />
          <span>Сбросить вид</span>
        </button>
      )}

      {/* Подсказка управления */}
      {loaded && (
        <div className="pv__hint">
          {TOUCH ? 'Палец — вращение · Два пальца — масштаб' : 'ЛКМ — вращение · Колесо — масштаб · ПКМ — сдвиг'}
        </div>
      )}

      {/* Плашка загрузки */}
      {!loaded && (
        <div className="pv__busy pv__busy--cover">
          <div className="pv__spin" />
          <span>Построение 3D модели...</span>
        </div>
      )}

      {/* resize.offsetSize: размер холста берём из вёрстки (offsetWidth),
          а не из getBoundingClientRect. Страница «Анализ» на невысоких
          ноутбуках ужата CSS-zoom (obhod/fit.js): прямоугольник приходил
          уже ужатым, холсту ставилась эта ширина в px, и zoom ужимал его
          второй раз — холст занимал 0.8 блока, справа и снизу оставалась
          пустая полоса. */}
      <Canvas
        key={activeUrl}
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: 40, near: 0.01, far: 10000 }}
        resize={{ offsetSize: true }}
      >
        <Scene
          url={activeUrl} mode={mode} up={up} upGlb={upGlb} yaw180={yaw180}
          onLoaded={handleLoaded}
          autoRotate={autoRotate} onInteract={handleInteract} fitNonce={fitNonce}
        />
      </Canvas>
    </div>
  );
};

export default PlyViewerImpl;
