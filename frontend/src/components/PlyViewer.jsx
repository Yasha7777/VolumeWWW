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

const Placeholder = ({ height }) => (
  <div style={{
    position: 'relative',
    width: '100%',
    height,
    backgroundColor: '#1a1a1a',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.07)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
        Загрузка 3D-просмотра...
      </span>
    </div>
  </div>
)

export default function PlyViewer({ plyUrl, glbUrl, height = '480px' }) {
  // без модели чанк с three даже не запрашиваем
  if (!plyUrl && !glbUrl) return null

  return (
    <Suspense fallback={<Placeholder height={height} />}>
      <PlyViewerImpl plyUrl={plyUrl} glbUrl={glbUrl} height={height} />
    </Suspense>
  )
}
