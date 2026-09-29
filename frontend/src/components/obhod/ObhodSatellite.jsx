import { useEffect, useRef, useState } from 'react'

/* Спутниковая подложка Яндекс Карт под карточку «Карта обходов».

   Карта здесь — только картинка: перетаскивание и зум выключены, линии,
   точки съёмки и проигрывание рисует наш SVG поверх. Отсюда наверх уходит
   проекция: (широта, долгота) → пиксели карточки 539×488 и метры на пиксель
   для линейки.

   Спутник есть только в JS API 2.1 (в 3.0 спутникового слоя нет). Ключ —
   VITE_YANDEX_MAPS_KEY, пакет «JavaScript API и HTTP Геокодер»; ограничьте
   его в кабинете разработчика по HTTP Referer своим доменом. Секрет подписи
   запросов сюда не нужен и во фронт попадать не должен. */

export const YMAPS_KEY = import.meta.env.VITE_YANDEX_MAPS_KEY || ''

let loading = null
function loadYmaps(key) {
  if (typeof window === 'undefined') return Promise.reject(new Error('ssr'))
  if (window.ymaps?.ready) return new Promise((resolve) => window.ymaps.ready(() => resolve(window.ymaps)))
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(key)}&lang=ru_RU`
      s.async = true
      s.onload = () => (window.ymaps ? window.ymaps.ready(() => resolve(window.ymaps)) : reject(new Error('ymaps')))
      s.onerror = () => { loading = null; reject(new Error('ymaps')) }
      document.head.appendChild(s)
    })
  }
  return loading
}

const W = 539, H = 488
const MIN_SPAN_M = 40     // минимальная рамка вокруг обхода, м
const MAX_ZOOM = 19       // глубже спутниковые снимки Карелии часто пустые

// метры на восток/север от (lat0, lon0) → широта/долгота
export function enToLatLon(geo, [e, n]) {
  const lat = geo.lat0 + n / 110540
  const lon = geo.lon0 + e / (111320 * Math.cos((geo.lat0 * Math.PI) / 180))
  return [lat, lon]
}

export default function ObhodSatellite({ geo, theme = 'light', onProjection, onError }) {
  const host = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!YMAPS_KEY || !geo?.points_en?.length) return
    let map = null, alive = true
    loadYmaps(YMAPS_KEY).then((ymaps) => {
      if (!alive || !host.current) return
      const pts = geo.points_en.map((p) => enToLatLon(geo, p))
      const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1])
      // рамка не меньше MIN_SPAN_M: у короткого обхода иначе зум уходит за
      // предел спутника (чёрные тайлы), а куча теряет окружение
      const midLat = (Math.min(...lats) + Math.max(...lats)) / 2, midLon = (Math.min(...lons) + Math.max(...lons)) / 2
      const halfLat = Math.max((Math.max(...lats) - Math.min(...lats)) / 2, MIN_SPAN_M / 2 / 110540)
      const halfLon = Math.max((Math.max(...lons) - Math.min(...lons)) / 2, MIN_SPAN_M / 2 / (111320 * Math.cos((midLat * Math.PI) / 180)))
      const bounds = [[midLat - halfLat, midLon - halfLon], [midLat + halfLat, midLon + halfLon]]
      map = new ymaps.Map(host.current, {
        center: [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2],
        zoom: 18, type: 'yandex#satellite', controls: [],
      }, { suppressMapOpenBlock: true, yandexMapDisablePoiInteractivity: true })
      map.behaviors.disable(['drag', 'scrollZoom', 'dblClickZoom', 'multiTouch', 'rightMouseButtonMagnifier', 'leftMouseButtonMagnifier'])
      // поля под заголовок, легенду и линейку, как у SVG-раскладки (fitTrack)
      map.setBounds(bounds, { zoomMargin: [110, 70, 100, 70], checkZoomRange: true }).then(async () => {
        if (!alive) return
        if (map.getZoom() > MAX_ZOOM) await map.setZoom(MAX_ZOOM)
        if (!alive) return
        const zoom = map.getZoom()
        const proj = map.options.get('projection')
        const cg = proj.toGlobalPixels(map.getCenter(), zoom)
        const el = host.current
        const sx = W / (el.clientWidth || W), sy = H / (el.clientHeight || H)
        const toPx = ([lat, lon]) => {
          const g = proj.toGlobalPixels([lat, lon], zoom)
          return [((g[0] - cg[0]) + (el.clientWidth || W) / 2) * sx, ((g[1] - cg[1]) + (el.clientHeight || H) / 2) * sy]
        }
        const mpp = (156543.03392 * Math.cos((map.getCenter()[0] * Math.PI) / 180)) / 2 ** zoom * sx
        setReady(true)
        onProjection?.({ toPx: (en) => toPx(enToLatLon(geo, en)), mpp })
      }, () => onError?.())
    }).catch(() => { if (alive) onError?.() })
    return () => { alive = false; map?.destroy() }
  }, [geo]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className={'ks-sat' + (ready ? ' is-ready' : '') + (theme === 'dark' ? ' is-dark' : '')} aria-hidden />
}
