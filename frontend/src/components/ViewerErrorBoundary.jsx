import { Component } from 'react'

/* ============================================================
   ViewerErrorBoundary — локальная страховка вокруг 3D-вьювера.
   ------------------------------------------------------------
   Suspense ловит только загрузку чанка/ресурса, НЕ исключения
   рендера. Краш three.js (битая модель, WebGL context lost)
   без boundary роняет всю страницу в белый экран.

   СОЗНАТЕЛЬНО простой: только внутренний fallback, никаких
   onError-колбэков наружу и никакого дёрганья родительских
   loading-состояний — та связка раньше давала вечный спиннер.
   ============================================================ */
export default class ViewerErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    // Только лог — наружу ничего не пробрасываем.
    console.warn('[PlyViewer] 3D-рендер упал:', error)
  }

  render() {
    if (this.state.failed) {
      const height = this.props.height || '480px'
      return (
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
          color: 'rgba(255,255,255,0.45)',
          fontSize: '13px',
          fontFamily: 'system-ui',
          textAlign: 'center',
          padding: '0 16px',
        }}>
          3D-модель недоступна
        </div>
      )
    }
    return this.props.children
  }
}
