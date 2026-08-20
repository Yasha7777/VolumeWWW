import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../diagnostics.css'

/* ============================================================
   ДИАГНОСТИКА ЗАМЕРА — 4 PNG из пайплайна
   ------------------------------------------------------------
   Колонки `analyses`: heatmap_top_url, heatmap_side_url,
   cloud_top_url, cloud_side_url. Все NULLABLE — у старых замеров
   пусто, тогда блока просто нет (никаких скелетонов и рамок).
   Возможен и частичный набор: любая из четырёх может быть NULL.

   Что на картинках:
   • КАРТА ВЫСОТ — та самая сетка, из которой посчитан объём.
     Палитра синий→красный = высота; пурпурный = затянутая дыра
     (высота взята у соседа, не измерена); красный = обрыв края
     (недосъём, часть объёма потеряна); серый = пустая кайма.
   • ОБЛАКО ТОЧЕК — то же облако, что в 3D-вьюере, с ТОЙ ЖЕ
     камерой и в ТОМ ЖЕ масштабе, что парная карта высот.
   Смысл пары: карта кладётся на облако, и видно, что дырка в
   съёмке на карте закрыта достройкой. Отсюда шторка.

   ДВА ЖЁСТКИХ ТРЕБОВАНИЯ К ПОКАЗУ (не «оформительские»):
   1. НИКАКОГО object-fit: cover / обрезки — в нижние ~96 px кадра
      вшиты подписи и шкала, кроп их срежет. Только contain.
   2. Пометки (затяжка, обрыв) занимают от ОДНОЙ ячейки = 1 px.
      В превью они физически исчезают, и картинка начинает врать →
      обязателен просмотр 1:1, а при увеличении image-rendering:
      pixelated (сглаживание размазывает пурпурную ячейку в фон).
   ============================================================ */

const W = 960
const H = 720

const LABELS = {
  heat: {
    top:  'Карта высот · сверху',
    side: 'Карта высот · сбоку',
  },
  cloud: {
    top:  'Облако точек · сверху',
    side: 'Облако точек · сбоку',
  },
}

/* Подписи в самих PNG — латиницей, поэтому смысл дублируем по-русски. */
const ALTS = {
  heat: {
    top:  'Карта высот, вид сверху: сетка высот, по которой посчитан объём',
    side: 'Карта высот, вид сбоку с наклоном 12°: сетка высот, по которой посчитан объём',
  },
  cloud: {
    top:  'Облако точек, вид сверху: то же облако, что в 3D-вьюере, в тех же осях и масштабе, что карта высот',
    side: 'Облако точек, вид сбоку с наклоном 12°: то же облако, что в 3D-вьюере, в тех же осях и масштабе, что карта высот',
  },
}

const VIEW_NAME = { top: 'Сверху', side: 'Сбоку' }
const VIEW_HINT = { top: 'вид сверху', side: 'вид сбоку, наклон 12°' }

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * Достаёт диагностику из строки анализа.
 * @returns {{views: Array<{key,heat,cloud}>, items: Array<{id,url,kind,view,label,alt}>}|null}
 *          null — если нет НИ ОДНОЙ картинки (старый замер).
 */
export function pickDiagnostics(row) {
  if (!row || typeof row !== 'object') return null

  const src = {
    top:  { heat: str(row.heatmap_top_url),  cloud: str(row.cloud_top_url)  },
    side: { heat: str(row.heatmap_side_url), cloud: str(row.cloud_side_url) },
  }

  const views = []
  const items = []
  for (const key of ['top', 'side']) {
    const { heat, cloud } = src[key]
    if (!heat && !cloud) continue
    views.push({ key, heat, cloud })
    // Порядок в items = порядок стрелок в лайтбоксе: сначала пара одного
    // ракурса (карта ↔ облако), потом второй ракурс. Так «←/→» листает
    // именно пару, ради которой всё и затевалось.
    for (const kind of ['heat', 'cloud']) {
      const url = src[key][kind]
      if (url) items.push({ id: `${kind}-${key}`, url, kind, view: key, label: LABELS[kind][key], alt: ALTS[kind][key] })
    }
  }

  return views.length ? { views, items } : null
}

/* ─── иконки ──────────────────────────────────────────────── */
const ExpandIcon = ({ s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
)

/* ============================================================
   Легенда — цвета вшиты в PNG, но без расшифровки картинка
   читается как «красивый рендер». Она диагностическая.
   ============================================================ */
function Legend() {
  return (
    <dl className="kd-legend">
      <div className="kd-legend__row">
        <dt><span className="kd-sw kd-sw--ramp" aria-hidden="true" /></dt>
        <dd><b>Высота над землёй</b> — шкала с цифрами в правом нижнем углу кадра</dd>
      </div>
      <div className="kd-legend__row">
        <dt><span className="kd-sw" style={{ background: '#EC00C8' }} aria-hidden="true" /></dt>
        <dd><b>Затянутая дыра</b> — поверхность не отснята, высота взята у соседней ячейки, а не измерена</dd>
      </div>
      <div className="kd-legend__row">
        <dt><span className="kd-sw" style={{ background: '#F02D2D' }} aria-hidden="true" /></dt>
        <dd><b>Обрыв края</b> — куча срезана вертикальной стенкой, а не сходит на нет: признак недосъёма, часть объёма потеряна</dd>
      </div>
      <div className="kd-legend__row">
        <dt><span className="kd-sw" style={{ background: '#48485A' }} aria-hidden="true" /></dt>
        <dd><b>Пустая кайма контура</b> — площадь без объёма</dd>
      </div>
    </dl>
  )
}

/* ============================================================
   Полный просмотр: 1:1 и увеличение с pixelated.
   Панорама — прокруткой контейнера (проще и надёжнее transform-
   математики), плюс перетаскивание мышью.
   Листание ←/→ НЕ сбрасывает зум и позицию: тот же <img>, меняем
   только src. В этом весь фокус — карта и облако сняты одной
   камерой, и переключение на месте показывает, где облако пустое.
   ============================================================ */
function DiagLightbox({ items, index, onIndex, onClose }) {
  const [zoom, setZoom] = useState('fit')   // 'fit' | 1 | 2 | 4
  const scrollRef = useRef(null)
  const prevZoom = useRef('fit')
  const it = items[index]

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowRight') { onIndex((index + 1) % items.length); return }
      if (e.key === 'ArrowLeft')  { onIndex((index - 1 + items.length) % items.length); return }
      if (e.key === '+' || e.key === '=') setZoom((z) => (z === 'fit' ? 1 : Math.min(4, z * 2)))
      if (e.key === '-') setZoom((z) => (z === 'fit' || z === 1 ? 'fit' : z / 2))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, items.length, onIndex, onClose])

  // Вход в зум из «вписать» — центрируем кадр, иначе окажемся в левом верхнем
  // углу и покажется, что картинка пустая.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prevZoom.current === 'fit' && zoom !== 'fit') {
      el.scrollLeft = (el.scrollWidth  - el.clientWidth)  / 2
      el.scrollTop  = (el.scrollHeight - el.clientHeight) / 2
    }
    prevZoom.current = zoom
  }, [zoom])

  // Перетаскивание для панорамы (кроме режима «вписать» — там некуда).
  const drag = useRef(null)
  const onPointerDown = (e) => {
    if (zoom === 'fit') return
    const el = scrollRef.current
    drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop }
    el.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const el = scrollRef.current
    el.scrollLeft = d.l - (e.clientX - d.x)
    el.scrollTop  = d.t - (e.clientY - d.y)
  }
  const endDrag = (e) => {
    if (!drag.current) return
    drag.current = null
    scrollRef.current?.releasePointerCapture?.(e.pointerId)
  }

  const zoomed = zoom !== 'fit'

  return createPortal(
    <div className="kd-lb" role="dialog" aria-modal="true" aria-label={`Диагностика замера: ${it.label}`}>
      <div className="kd-lb__bar">
        <div className="kd-lb__tabs" role="tablist" aria-label="Изображения диагностики">
          {items.map((x, i) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={`kd-lb__tab${i === index ? ' is-on' : ''}`}
              onClick={() => onIndex(i)}
            >
              {x.label}
            </button>
          ))}
        </div>

        <div className="kd-lb__zoom" role="group" aria-label="Масштаб">
          {[['fit', 'Вписать'], [1, '1:1'], [2, '2×'], [4, '4×']].map(([z, label]) => (
            <button
              key={String(z)}
              type="button"
              className={`kd-lb__zbtn${zoom === z ? ' is-on' : ''}`}
              aria-pressed={zoom === z}
              onClick={() => setZoom(z)}
            >
              {label}
            </button>
          ))}
        </div>

        <button type="button" className="kd-lb__close" onClick={onClose} aria-label="Закрыть просмотр">×</button>
      </div>

      <div
        ref={scrollRef}
        className={`kd-lb__stage${zoomed ? ' is-zoomed' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          className="kd-lb__img"
          src={it.url}
          alt={it.alt}
          draggable={false}
          /* Явные размеры при зуме → прокрутка контейнера; при «вписать» —
             contain, чтобы вшитые в нижние 96 px подписи не срезались. */
          style={zoomed ? { width: W * zoom, height: H * zoom } : undefined}
        />
      </div>

      <p className="kd-lb__cap">
        {it.label}
        <span className="kd-lb__hint">
          {zoomed
            ? ' · без сглаживания, одиночные ячейки видны как есть — тяните кадр, чтобы осмотреть его целиком'
            : ' · включите 1:1 или больше: пометки в одну ячейку при уменьшении исчезают'}
        </span>
      </p>

      {items.length > 1 && (
        <>
          <button type="button" className="kd-lb__nav kd-lb__nav--l" onClick={() => onIndex((index - 1 + items.length) % items.length)} aria-label="Предыдущее изображение">‹</button>
          <button type="button" className="kd-lb__nav kd-lb__nav--r" onClick={() => onIndex((index + 1) % items.length)} aria-label="Следующее изображение">›</button>
        </>
      )}
    </div>,
    document.body,
  )
}

/* ============================================================
   Основной блок: пара «карта высот ↔ облако точек» под шторкой.
   Один и тот же кадр, одна камера — поэтому шторка, а не две
   картинки рядом: связь между ними должна быть очевидна.
   ============================================================ */
export function DiagnosticsBlock({ diag }) {
  // Хуки — ДО любого раннего выхода: diag прилетает асинхронно (поллинг на
  // Analyze), и порядок хуков не должен зависеть от того, приехал он уже или нет.
  const [viewKey, setViewKey] = useState(null)
  // 'curtain' | 'heat' | 'cloud'. Без пары шторки нет — показываем то, что есть.
  const [mode, setMode] = useState('curtain')
  const [pos, setPos] = useState(50)
  const [dragging, setDragging] = useState(false)
  const [lbIndex, setLbIndex] = useState(null)

  const stageRef = useRef(null)
  const dragRef = useRef(false)

  const setFromEvent = useCallback((e) => {
    const el = stageRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const p = ((e.clientX - r.left) / r.width) * 100
    setPos(Math.max(0, Math.min(100, p)))
  }, [])

  const views = diag?.views || []
  const items = diag?.items || []
  const view = views.find((v) => v.key === viewKey) || views[0] || null
  if (!view) return null

  const pair = !!(view.heat && view.cloud)
  const effMode = pair ? mode : (view.heat ? 'heat' : 'cloud')
  // Одна переменная рулит и шторкой, и переключателем слоёв: 100 — только
  // карта, 0 — только облако, между — граница шторки.
  const clipX = effMode === 'heat' ? 100 : effMode === 'cloud' ? 0 : pos

  const onDown = (e) => {
    if (effMode !== 'curtain') return
    dragRef.current = true
    setDragging(true)
    stageRef.current?.setPointerCapture?.(e.pointerId)
    setFromEvent(e)
  }
  const onMove = (e) => { if (dragRef.current) setFromEvent(e) }
  const onUp = (e) => {
    if (!dragRef.current) return
    dragRef.current = false
    setDragging(false)
    stageRef.current?.releasePointerCapture?.(e.pointerId)
  }

  const onHandleKey = (e) => {
    const step = e.shiftKey ? 10 : 2
    if (e.key === 'ArrowLeft')  { setPos((p) => Math.max(0, p - step)); e.preventDefault() }
    if (e.key === 'ArrowRight') { setPos((p) => Math.min(100, p + step)); e.preventDefault() }
    if (e.key === 'Home') { setPos(0); e.preventDefault() }
    if (e.key === 'End')  { setPos(100); e.preventDefault() }
  }

  const openFull = (kind) => {
    const want = `${kind}-${view.key}`
    const i = items.findIndex((x) => x.id === want)
    setLbIndex(i >= 0 ? i : 0)
  }

  const heatItem  = items.find((x) => x.id === `heat-${view.key}`)
  const cloudItem = items.find((x) => x.id === `cloud-${view.key}`)

  return (
    <section className="kd" aria-label="Диагностика съёмки">
      <div className="kd__hd">
        <div>
          <p className="kd__eyebrow">Диагностика съёмки</p>
          <p className="kd__lede">
            Сетка высот, из которой посчитан объём, и то же облако точек в тех же осях.
            Видно, где съёмка полная, а где модель достраивали.
          </p>
        </div>

        {views.length > 1 && (
          <div className="kd__seg" role="group" aria-label="Ракурс">
            {views.map((v) => (
              <button
                key={v.key}
                type="button"
                className={`kd__seg-btn${v.key === view.key ? ' is-on' : ''}`}
                aria-pressed={v.key === view.key}
                onClick={() => setViewKey(v.key)}
              >
                {VIEW_NAME[v.key]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        ref={stageRef}
        className={`kd__stage${effMode === 'curtain' ? ' is-curtain' : ''}${dragging ? ' is-dragging' : ''}`}
        style={{ '--kd-x': `${clipX}%` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        /* Без шторки тянуть нечего — клик по кадру открывает полный размер. */
        onClick={effMode === 'curtain' ? undefined : () => openFull(effMode)}
      >
        {/* Нижний слой — облако. Верхний — карта высот, подрезанная по --kd-x. */}
        {cloudItem && (
          <img
            className="kd__layer kd__layer--cloud"
            src={cloudItem.url}
            alt={pair ? '' : cloudItem.alt}
            aria-hidden={pair ? 'true' : undefined}
            loading="lazy"
            decoding="async"
            draggable={false}
            width={W}
            height={H}
          />
        )}
        {heatItem && (
          <img
            className="kd__layer kd__layer--heat"
            src={heatItem.url}
            alt={pair ? '' : heatItem.alt}
            aria-hidden={pair ? 'true' : undefined}
            loading="lazy"
            decoding="async"
            draggable={false}
            width={W}
            height={H}
          />
        )}

        {/* В паре обе картинки — один слоёный виджет, поэтому сами <img>
            декоративные, а состояние описываем словами для скринридера. */}
        {pair && (
          <p className="kd__sr">
            {effMode === 'heat'  ? ALTS.heat[view.key]
              : effMode === 'cloud' ? ALTS.cloud[view.key]
              : `Наложение: ${ALTS.heat[view.key]}. Под ней — ${ALTS.cloud[view.key]}. Границу можно двигать.`}
          </p>
        )}

        {pair && effMode === 'curtain' && (
          <>
            <div className="kd__seam" aria-hidden="true" />
            <button
              type="button"
              className="kd__handle"
              role="slider"
              tabIndex={0}
              aria-label="Граница шторки: слева карта высот, справа облако точек"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pos)}
              aria-valuetext={`Карта высот занимает ${Math.round(pos)}% кадра`}
              onKeyDown={onHandleKey}
              onClick={(e) => e.stopPropagation()}
            >
              <span aria-hidden="true">⇄</span>
            </button>
            <span className="kd__tag kd__tag--l" aria-hidden="true">карта высот</span>
            <span className="kd__tag kd__tag--r" aria-hidden="true">облако точек</span>
          </>
        )}
      </div>

      <div className="kd__bar">
        {pair && (
          <div className="kd__seg kd__seg--modes" role="group" aria-label="Что показывать">
            {[['heat', 'Карта'], ['curtain', 'Шторка'], ['cloud', 'Облако']].map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={`kd__seg-btn${mode === m ? ' is-on' : ''}`}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <p className="kd__note">
          {VIEW_HINT[view.key]}
          {effMode === 'curtain'
            ? ' · тяните границу — карта и облако сняты одной камерой в одном масштабе'
            : pair ? ' · тот же кадр и масштаб, что у парного изображения' : ''}
        </p>

        {/* Не «посмотреть покрупнее», а обязательный режим: затяжка и обрыв
            занимают от одной ячейки = 1 px и в уменьшенном кадре пропадают. */}
        <button
          type="button"
          className="kd__full"
          onClick={() => openFull(effMode === 'cloud' ? 'cloud' : 'heat')}
          title="Пометки в одну ячейку видны только в полном размере"
        >
          <ExpandIcon /> Полный размер
        </button>
      </div>

      <Legend />

      {lbIndex != null && (
        <DiagLightbox
          items={items}
          index={lbIndex}
          onIndex={setLbIndex}
          onClose={() => setLbIndex(null)}
        />
      )}
    </section>
  )
}

/* ============================================================
   Компактное превью для карточки истории: одна картинка (карта
   высот сверху), клик — полный просмотр всего набора.
   Состояние лайтбокса держит внутри себя, чтобы History ничего
   не проводил через себя.
   ============================================================ */
export function DiagThumb({ diag }) {
  const [lbIndex, setLbIndex] = useState(null)
  if (!diag) return null

  // Порядок предпочтения: карта сверху → карта сбоку → облако.
  const first = diag.items.find((x) => x.id === 'heat-top') || diag.items[0]
  const startAt = diag.items.indexOf(first)

  return (
    <>
      <button
        type="button"
        className="kd-thumb"
        onClick={(e) => { e.stopPropagation(); setLbIndex(startAt) }}
        title="Диагностика съёмки — открыть в полном размере"
        aria-label={`Диагностика съёмки: ${first.alt}. Открыть в полном размере`}
      >
        <img src={first.url} alt="" loading="lazy" decoding="async" width={W} height={H} />
        <span className="kd-thumb__cap" aria-hidden="true">карта</span>
      </button>

      {lbIndex != null && (
        <DiagLightbox
          items={diag.items}
          index={lbIndex}
          onIndex={setLbIndex}
          onClose={() => setLbIndex(null)}
        />
      )}
    </>
  )
}

export default DiagnosticsBlock
