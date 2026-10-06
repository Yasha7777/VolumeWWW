import { lazy, Suspense } from 'react'

/* ============================================================
   PlyViewer — тонкая обёртка над 3D-просмотром.
   ------------------------------------------------------------
   Путь и API прежние, страницы менять не надо:
     <PlyViewer plyUrl={...} glbUrl={...} height="480px" />

   ВАЖНО (производительность): three / @react-three/fiber / drei
   здесь больше НЕ импортируются статически. Вся тяжесть живёт в
   PlyViewerImpl.jsx и подгружается лениво (vendor-three чанк),
   только когда реально есть модель для показа.
   ============================================================ */

const PlyViewerImpl = lazy(() => import('./PlyViewerImpl'))

/* Заглушка на время загрузки чанка с three — тот же блок .pv, что и у
   самого обозревателя (styles.css), чтобы картинка не прыгала. */
const Placeholder = ({ height }) => (
  <div className="pv" style={{ height }}>
    <div className="pv__busy pv__busy--cover">
      <div className="pv__spin" />
      <span>Загрузка 3D-просмотра...</span>
    </div>
  </div>
)

export default function PlyViewer({ plyUrl, glbUrl, up = null, upGlb = null, yaw180 = false, height = '480px' }) {
  // без модели чанк с three даже не запрашиваем
  if (!plyUrl && !glbUrl) return null

  return (
    <Suspense fallback={<Placeholder height={height} />}>
      <PlyViewerImpl plyUrl={plyUrl} glbUrl={glbUrl} up={up} upGlb={upGlb} yaw180={yaw180} height={height} />
    </Suspense>
  )
}
