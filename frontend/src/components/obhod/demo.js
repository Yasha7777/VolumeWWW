/* Демо-набор страницы выбора обхода — ровно данные мокапа (тексты карточек,
   геометрия маршрутов на карте). Включается только явно: ?demo=1 в адресе или
   VITE_OBHOD_DEMO=1 при сборке. В обычном режиме страница берёт /api/scans/.
   Фото карточек — настоящие кучи из наборов Analyz/НаборыФото (Пухта, Ладва,
   промплощадки Петрозаводска), одинаково затонированы под макет. */
import img1 from './img/demo/obhod-1.webp'
import img2 from './img/demo/obhod-2.webp'
import img3 from './img/demo/obhod-3.webp'
import img4 from './img/demo/obhod-4.webp'
import img5 from './img/demo/obhod-5.webp'
import img6 from './img/demo/obhod-6.webp'
import pile178 from './img/demo/pile-178.bin?url'

// Кадры настоящего обхода кучи отсева 178 м³ (Пухта) — для проигрывания.
const WALK = import.meta.glob('./img/demo/walk/walk-*.webp', { eager: true, query: '?url', import: 'default' })
const walkUrls = Object.keys(WALK).sort().map((k) => WALK[k])

export const DEMO_OBHODS = [
  { id: 'o1', title: 'Отсев у склада №3', date: '28 сен 2026, 14:32', photos: 96, duration: '03:48', author: 'Яков Качалин', place: 'Петрозаводск', device: 'ARKit · iPhone 12', status: 'Готов', img: img1, ready: true, statusKey: 'ready' },
  { id: 'o2', title: 'Гравий, карьер №3', date: '26 сен 2026, 11:17', photos: 74, duration: '02:21', author: 'Яков Качалин', place: 'Петрозаводск', device: 'ARKit · iPhone 12', status: 'Готов', img: img2, ready: true, statusKey: 'ready' },
  { id: 'o3', title: 'Щебень, участок В-12', date: '26 сен 2026, 11:17', photos: 112, duration: '04:12', author: 'Рустам Ильясов', place: 'Кондопога', device: 'ARKit · iPhone 12 mini', status: 'Готов', img: img3, ready: true, statusKey: 'ready' },
  { id: 'o4', title: 'Отсев, отвал №1', date: '22 сен 2026, 13:26', photos: 58, duration: '02:37', author: 'Артём Смирнов', place: 'Петрозаводск', device: 'ARCore · Android', status: 'Готов', img: img4, ready: true, statusKey: 'ready' },
  { id: 'o5', title: 'Песок, карьер №1', date: '22 сен 2026, 13:26', photos: 83, duration: '02:37', author: 'Сергей Васильев', place: 'Петрозаводск', device: 'ARKit · iPhone 12', status: 'Готов', img: img5, ready: true, statusKey: 'ready' },
  { id: 'o6', title: 'Щебень 5–20, карьер №1', date: '18 сен 2026, 15:08', photos: 67, duration: '02:52', author: 'Рустам Ильясов', place: 'Кондопога', device: 'ARKit · iPhone 12 mini', status: 'Готов', img: img6, ready: true, statusKey: 'ready' },
]


// Геометрия маршрутов мокапа в координатах карточки карты (539×488).
export const DEMO_MAP = {
  otherRoute: [[267.5,118],[218,127],[179,142],[163,177.5],[173,190],[181.5,220],[144.5,242.5],[113,267.5],[109,305],[139,330],[172.5,336.5],[172.5,353.5],[203,353.5],[214,365],[259,374]],
  otherLink: [[181.5,220],[218,201]],
  otherRoute2: [[272.5,159.5],[311,173],[327.5,185],[325.5,199],[362,216],[391.5,231],[414,237.5]],
  otherSpur: [[181.5,220],[176,262],[169,289]],
  selectedRoute: [[259,374],[300,360],[346.5,357],[381.5,337.5],[405,315.5],[437.5,294.5],[440,250],[426,222],[391,202],[326,199],[300,187],[279,181],[239,181],[218,201],[220,269],[229,337.5],[259,374]],
  selectedInner: [[326,199],[346.5,239],[335.5,277.5],[309,312.5],[281,345],[259,374]],
  otherNodes: [[267.5,118],[218,127],[179,142],[144.5,242.5],[113,267.5],[139,330],[203,353.5],[214,365],[272.5,159.5],[311,173],[327.5,185],[362,216],[391.5,231],[169,289]],
  selNodes: [[300,360],[346.5,357],[381.5,337.5],[405,315.5],[437.5,294.5],[440,250],[391,202],[300,187],[279,181],[239,181],[220,269],[229,337.5],[346.5,239],[335.5,277.5],[309,312.5]],
  cameras: [
    { at: [163,177.5], muted: true },
    { at: [325.5,199] },
    { at: [221.5,230.5] },
    { at: [414,237.5] },
    { at: [172.5,353.5] },
  ],
  whiteNodes: [[181.5,220],[109,305],[172.5,336.5],[218,201]],
  start: [259,374],
}

// 10 кадров обхода, разложенных по линии выбранного обхода (карточка «Отсев у склада №3»:
// 96 фото, 03:48). n — номер кадра в обходе, frac — доля времени.
const WALK_AT = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14].map((i) => DEMO_MAP.selectedRoute[i])
DEMO_MAP.walkTotal = 96
DEMO_MAP.walkDuration = 3 * 60 + 48
DEMO_MAP.walk = walkUrls.map((thumb, k) => {
  const n = Math.round(((k + 0.5) * 96) / walkUrls.length)
  return { thumb, at: WALK_AT[k % WALK_AT.length], n, frac: (n - 1) / 95 }
})

// 3D: настоящее облако реконструкции кучи отсева 178 м³ (Пухта), прорежено до 44 тыс. точек.
export const DEMO_CLOUDS = {
  o1: { src: pile178, title: 'Отсев, эталон 178 м³', meta: '44 тыс. из 361 тыс. точек' },
}
