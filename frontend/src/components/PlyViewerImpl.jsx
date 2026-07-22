import React, { Suspense, useState, useRef, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Html, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import * as THREE from 'three';
import { levelGeometry, levelObject } from './plyAlign';

// ============================================================
// PlyViewerImpl — реализация 3D-просмотра (бывший PlyViewer.jsx).
// ТЯЖЁЛЫЙ модуль: тянет весь three-стек. Импортируется ТОЛЬКО
// через React.lazy из PlyViewer.jsx — не импортируй напрямую!
// ============================================================

// === 1. АВТО-ПОЗИЦИОНИРОВАНИЕ КАМЕРЫ ПО BOUNDING BOX ===
const CameraFit = ({ target, size }) => {
  const { camera, controls } = useThree();
  React.useEffect(() => {
    if (!target || !size) return;
    const maxDim  = Math.max(size.x, size.y, size.z);
    const dist    = maxDim * 1.8;
    const fov     = (camera.fov * Math.PI) / 180;
    const camDist = dist / (2 * Math.tan(fov / 2));

    camera.position.set(
      target.x + camDist * 0.7,
      target.y + camDist * 0.7,
      target.z + camDist * 0.7
    );
    camera.near = camDist * 0.001;
    camera.far  = camDist * 20;
    camera.updateProjectionMatrix();
    camera.lookAt(target.x, target.y, target.z);

    if (controls) {
      controls.target.set(target.x, target.y, target.z);
      controls.minDistance = camDist * 0.05;
      controls.maxDistance = camDist * 8;
      controls.update();
    }
  }, [target, size, camera, controls]);
  return null;
};

// === 2А. ОБЛАКО ТОЧЕК (PLY) ===
const PlyModel = ({ url, up, onReady }) => {
  const geometry = useLoader(PLYLoader, url);

  React.useEffect(() => {
    if (!geometry) return;
    // Выравниваем «вверх» → +Y ДО расчёта bbox, чтобы центрирование,
    // размеры и грид-пол были в исправленной системе. up из пайплайна;
    // если его нет — фолбэк по доминирующей плоскости (только крен).
    levelGeometry(geometry, up);
    geometry.computeBoundingBox();
    const box    = geometry.boundingBox;
    const center = new THREE.Vector3();
    const size   = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    geometry.translate(-center.x, -center.y, -center.z);
    onReady({ center: new THREE.Vector3(0, 0, 0), size });
  }, [geometry, up, onReady]);

  const hasColors = geometry.attributes.color != null;

  return (
    <points geometry={geometry}>
      <pointsMaterial
        size={0.006}
        vertexColors={hasColors}
        color={hasColors ? undefined : '#4a9e6b'}
        sizeAttenuation
        transparent
        opacity={0.92}
      />
    </points>
  );
};

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

    const box    = new THREE.Box3().setFromObject(gltf.scene);
    const center = new THREE.Vector3();
    const size   = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    gltf.scene.position.set(-center.x, -center.y, -center.z);

    onReady({ center: new THREE.Vector3(0, 0, 0), size });
  }, [gltf, url, up, onReady]);

  return <primitive object={gltf.scene} />;
};

// === 3. ЛОАДЕР ===
const StyledLoader = () => (
  <Html center>
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
      background: 'rgba(30,30,30,0.85)', padding: '14px 20px', borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        width: '22px', height: '22px',
        border: '2px solid rgba(255,255,255,0.15)',
        borderTopColor: '#6fcf97',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <span style={{ fontFamily: 'system-ui', fontSize: '12px', color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap' }}>
        Загрузка 3D модели...
      </span>
    </div>
  </Html>
);

// === 4. СЦЕНА (внутри Canvas) ===
const Scene = ({ url, mode, up, upGlb, onLoaded }) => {
  // PLY и GLB экспортируются пайплайном в РАЗНЫХ системах координат
  // (меш дополнительно повёрнут), поэтому up-вектор у них свой. Если
  // отдельного up для GLB нет — используем общий (лучше, чем ничего).
  const activeUp = mode === 'glb' ? (upGlb || up) : up;

  const [modelInfo, setModelInfo] = useState(null);
  const controlsRef = useRef();

  const handleReady = useCallback((info) => {
    setModelInfo(info);
    onLoaded();
  }, [onLoaded]);

  return (
    <>
      <ambientLight intensity={mode === 'ply' ? 1.5 : 0.2} />

      <Suspense fallback={<StyledLoader />}>
        {mode === 'glb'
          ? <GlbModel url={url} up={activeUp} onReady={handleReady} />
          : <PlyModel url={url} up={activeUp} onReady={handleReady} />
        }
        {modelInfo && <CameraFit target={modelInfo.center} size={modelInfo.size} />}
      </Suspense>

      {modelInfo && (
        <Grid
          position={[0, -(modelInfo.size.y / 2) - 0.01, 0]}
          args={[modelInfo.size.x * 6, modelInfo.size.z * 6]}
          cellSize={modelInfo.size.x * 0.15}
          cellColor="rgba(255,255,255,0.06)"
          sectionSize={modelInfo.size.x * 0.6}
          sectionColor="rgba(255,255,255,0.12)"
          fadeDistance={modelInfo.size.x * 8}
          fadeStrength={2}
          infiniteGrid
        />
      )}

      <GizmoHelper alignment="bottom-left" margin={[40, 40]}>
        <GizmoViewport axisColors={['#e05252', '#6fcf97', '#c09b3a']} labelColor="white" />
      </GizmoHelper>

      <OrbitControls
        ref={controlsRef}
        makeDefault
        autoRotate={!!modelInfo}
        autoRotateSpeed={0.4}
        enableDamping
        dampingFactor={0.07}
        maxPolarAngle={Math.PI * 0.85}
      />
    </>
  );
};

// === 5. ГЛАВНЫЙ КОМПОНЕНТ ===
// Принимает plyUrl и glbUrl отдельно, показывает свитч если есть оба.
// height — настраиваемая высота контейнера (по умолчанию 480px).
const PlyViewerImpl = ({ plyUrl, glbUrl, up = null, upGlb = null, height = '480px' }) => {
  const hasGlb = !!glbUrl;
  const hasPly = !!plyUrl;

  const [mode, setMode] = useState(hasGlb ? 'glb' : 'ply');
  const [loaded, setLoaded] = useState(false);

  const activeUrl = mode === 'glb' ? glbUrl : plyUrl;

  const handleModeSwitch = (newMode) => {
    if (newMode === mode) return;
    setLoaded(false);
    setMode(newMode);
  };

  if (!activeUrl) return null;

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height,
      backgroundColor: '#1a1a1a',
      borderRadius: '12px',
      overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.07)',
    }}>

      {/* СВИТЧ GLB / PLY */}
      {hasGlb && hasPly && (
        <div style={{
          position: 'absolute', top: '12px', left: '12px', zIndex: 20,
          display: 'flex', gap: '4px',
          background: 'rgba(0,0,0,0.6)', padding: '4px', borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)',
        }}>
          {[
            { key: 'glb', label: '🧊 Меш' },
            { key: 'ply', label: '✦ Облако' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleModeSwitch(key)}
              style={{
                padding: '4px 12px',
                borderRadius: '5px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
                fontFamily: 'system-ui',
                background: mode === key ? 'rgba(111,207,151,0.25)' : 'transparent',
                color: mode === key ? '#6fcf97' : 'rgba(255,255,255,0.4)',
                transition: 'all 0.15s ease',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Подсказка управления */}
      {loaded && (
        <div style={{
          position: 'absolute', top: '12px', right: '12px', zIndex: 10,
          background: 'rgba(0,0,0,0.5)', padding: '4px 10px', borderRadius: '6px',
          fontSize: '11px', color: 'rgba(255,255,255,0.5)',
          backdropFilter: 'blur(4px)', pointerEvents: 'none',
          border: '1px solid rgba(255,255,255,0.06)',
          fontFamily: 'system-ui',
        }}>
          ЛКМ — вращение · Колесико — зум
        </div>
      )}

      {/* Плашка загрузки */}
      {!loaded && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 5,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#1a1a1a',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '28px', height: '28px',
              border: '2px solid rgba(255,255,255,0.1)',
              borderTopColor: '#6fcf97',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', fontFamily: 'system-ui' }}>
              Построение 3D модели...
            </span>
          </div>
        </div>
      )}

      <Canvas
        key={activeUrl}
        gl={{ antialias: true, alpha: false }}
        camera={{ fov: 45, near: 0.01, far: 10000 }}
        style={{ background: '#1a1a1a' }}
      >
        <Scene url={activeUrl} mode={mode} up={up} upGlb={upGlb} onLoaded={() => setLoaded(true)} />
      </Canvas>
    </div>
  );
};

export default PlyViewerImpl;
