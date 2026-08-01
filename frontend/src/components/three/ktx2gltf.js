import { useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

/* ════════════════════════════════════════════════════════════════════════
   Загрузка сжатых GLB для лендинга: geometry = meshopt (drei-встроенный
   декодер, БЕЗ прореживания полигонов), textures = KTX2/Basis (транскодер
   локально в /basis/, БЕЗ сети и без draco-CDN). Модели пожаты gltf-transform
   (meshopt + ktx2 4K), полигональность не тронута.
   ════════════════════════════════════════════════════════════════════════ */

let _ktx2 = null
function getKTX2(gl) {
  if (!_ktx2) _ktx2 = new KTX2Loader().setTranscoderPath('/basis/')
  _ktx2.detectSupport(gl)
  return _ktx2
}

// useGLTF: draco off (нет CDN), meshopt on (bundled), + KTX2 через extendLoader
export function useModel(url) {
  const gl = useThree((s) => s.gl)
  return useGLTF(url, false, true, (loader) => {
    loader.setKTX2Loader(getKTX2(gl))
  })
}
