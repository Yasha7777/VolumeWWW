import { useEffect, useId, useRef, useState } from 'react'
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'motion/react'
import { Link } from 'react-router-dom'
import { Camera, Route, Box, ChevronDown, CalendarDays, ArrowRight, X, Check, Map as MapIcon, ListPlus, Loader2 } from 'lucide-react'
import ObhodMap from './ObhodMap'
import ObhodCard from './ObhodCard'
import CubeSettings from '../CubeSettings'
import { plural } from './scans'
import { zoomOf } from './fit'
import { useLiquid } from './liquid'

function useMedia(q) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q); const on = () => setM(mq.matches)
    mq.addEventListener('change', on); return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

const pad = (n) => String(n).padStart(2, '0')
// этапы по времени — ориентир для глаз, настоящий статус приходит с сервера
const stageOf = (s) => (s < 25 ? 'Скачиваем кадры обхода' : s < 150 ? '3D-реконструкция кучи' : s < 330 ? 'Считаем объём' : 'Определяем материал и вес')

function RunClock({ startTime }) {
  const [s, setS] = useState(0)
  useEffect(() => {
    const tick = () => setS(Math.max(0, Math.floor((Date.now() - startTime) / 1000)))
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [startTime])
  return (
    <>
      <span className="ks-run__stage">{stageOf(s)}…</span>
      <span className="ks-run__clock">{pad(Math.floor(s / 60))}:{pad(s % 60)}</span>
    </>
  )
}

// мягкий старт, быстрая середина, долгое торможение: быстро, но не рывком
const EASE = [0.5, 0, 0.2, 1]

/* Панель выбора обхода: покой → (наведение | фокус) → раскрыта.
   В покое — узкая плашка; при наведении плавно растягивается, а края стекают
   вниз каплями; по клику раскрывается в карту, список и запуск анализа.
   Обход выбирается один. Внизу панели — режим TEST/PROD, куб, «В очередь»
   и «Запустить анализ»; пока анализ считается, панель показывает ход и таймер.
   На тач-экранах наведения нет — тап раскрывает сразу. Esc и клик мимо —
   сворачивают (кроме времени, пока идёт анализ). */
export default function ObhodPicker({
  items, selected, onToggle,
  loading = false, error = null, demo = false,
  track = null, trackLoading = false, cloud = null, theme = 'light',
  period, onPeriod,
  initialState = 'rest', zoomed = false,
  run = {}, collapseSignal = 0,
}) {
  const [state, setState] = useState(initialState)
  const reduce = useReducedMotion()
  const timer = useRef()
  const box = useRef(null)
  const fillRef = useRef(null), glowRef = useRef(null), rimRef = useRef(null)
  const glowGrad = useRef(null), rimGrad = useRef(null)
  const uid = useId().replace(/:/g, '')
  const canHover = useMedia('(hover: hover) and (pointer: fine)')
  const narrow = useMedia('(max-width: 720px)')
  const locked = !!(run.busy || run.waiting)
  const SIZES = {
    rest: { width: narrow ? '100%' : 640, height: narrow ? 76 : 88 },
    hover: { width: '100%', height: narrow ? 76 : 88 },
    open: { width: '100%', height: 'auto' },
  }

  useLiquid({ box, paths: [fillRef, glowRef, rimRef], state, enabled: canHover && !narrow, reduce })

  // раскрыта: Esc или клик мимо панели сворачивают — но не посреди анализа
  useEffect(() => {
    if (state !== 'open' || locked) return
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) setState('rest') }
    const onDown = (e) => {
      if (e.button > 0 || !box.current || box.current.contains(e.target)) return
      if (e.target.closest?.('header, [role="dialog"], .ks-result, .rp-panel, .cube-panel')) return
      setState('rest')
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown, true) }
  }, [state, locked])
  // анализ закончился — сворачиваемся, чтобы результат оказался прямо под плашкой
  useEffect(() => { if (collapseSignal) setState('rest') }, [collapseSignal])
  // состояние панели — для декора страницы (камни расступаются, витрина прячется)
  useEffect(() => {
    const scope = box.current?.closest('.ks-scope')
    if (!scope) return
    scope.dataset.picker = state
    return () => { delete scope.dataset.picker }
  }, [state])
  // свет под курсором: координаты — в градиенты SVG, без перерисовки React
  const glow = (e) => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect(), z = zoomOf(el)
    const x = ((e.clientX - r.left) / z).toFixed(0), y = ((e.clientY - r.top) / z).toFixed(0)
    for (const g of [glowGrad.current, rimGrad.current]) { g?.setAttribute('cx', x); g?.setAttribute('cy', y) }
    el.style.setProperty('--gx', `${x}px`)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  const intent = (next, delay) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState((s) => (s === 'open' ? s : next)), delay)
  }

  const picked = items.find((o) => selected.includes(o.id)) || null
  const tween = reduce ? { duration: 0 } : { duration: 0.48, ease: EASE }
  const spring = reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 }
  const open = state === 'open'
  const last = items[0]
  const sub = loading ? 'Загружаем обходы…'
    : error ? 'Не удалось загрузить обходы'
    : items.length ? `${items.length} ${plural(items.length, 'обход', 'обхода', 'обходов')} · последний ${last.dateShort || last.date}`
    : 'Пока нет обходов за период'
  const nThumbs = Math.max(1, Math.min(6, items.length))

  return (
    <div className="ks-stage">
      <LayoutGroup>
        <motion.section
          ref={box}
          className={'ks-picker is-' + state + (locked ? ' is-locked' : '')}
          initial={false}
          animate={SIZES[state]}
          transition={open ? { ...tween, height: reduce ? { duration: 0 } : { duration: 0.56, ease: EASE } } : tween}
          onPointerEnter={() => canHover && intent('hover', 0)}
          onPointerLeave={() => canHover && intent('rest', 140)}
          onPointerMove={canHover ? glow : undefined}
          aria-label="Выбор обхода"
        >
          {/* контур плашки с каплями по краям (в покое и при наведении) */}
          <svg className="ks-picker__shape" aria-hidden>
            <defs>
              <radialGradient id={'kg' + uid} ref={glowGrad} gradientUnits="userSpaceOnUse" cx="320" cy="44" r="380">
                <stop offset="0" className="ks-shape__glow-a" />
                <stop offset="1" className="ks-shape__glow-b" />
              </radialGradient>
              <radialGradient id={'kr' + uid} ref={rimGrad} gradientUnits="userSpaceOnUse" cx="320" cy="44" r="240">
                <stop offset="0" className="ks-shape__rim-a" />
                <stop offset="1" className="ks-shape__rim-b" />
              </radialGradient>
            </defs>
            <path ref={fillRef} className="ks-shape__fill" onClick={() => setState('open')} />
            <path ref={glowRef} className="ks-shape__glow" fill={`url(#kg${uid})`} />
            <path ref={rimRef} className="ks-shape__rim" stroke={`url(#kr${uid})`} />
          </svg>
          {/* что в каплях: слева — что внутри (карта, 3D), справа — как раскрыть */}
          {!open && (
            <>
              <button type="button" className="ks-drip ks-drip--l" tabIndex={-1} aria-hidden onClick={() => setState('open')}>
                <MapIcon size={13} strokeWidth={1.8} /><Box size={13} strokeWidth={1.8} />
                <span>карта обходов и 3D-облако</span>
              </button>
              <button type="button" className="ks-drip ks-drip--r" tabIndex={-1} aria-hidden onClick={() => setState('open')}>
                <span>раскрыть</span><ChevronDown size={14} strokeWidth={2} />
              </button>
            </>
          )}
          <span className="ks-picker__sweep" aria-hidden />
          <AnimatePresence initial={false} mode="popLayout">
            {!open ? (
              <motion.button
                key="bar" type="button" className="ks-bar"
                onClick={() => setState('open')}
                onFocus={() => intent('hover', 0)}
                onBlur={() => intent('rest', 0)}
                aria-expanded="false"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.14 } }}
                transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
              >
                <span className="ks-bar__icons" aria-hidden>
                  <span><Camera size={17} strokeWidth={1.6} /></span>
                  <span><Route size={17} strokeWidth={1.6} /></span>
                  <span><Box size={17} strokeWidth={1.6} /></span>
                </span>
                <span className="ks-bar__text">
                  <span className="ks-bar__title">{run.waiting ? 'Идёт анализ обхода' : 'Выберите обход'}</span>
                  <span className="ks-bar__sub">{run.waiting && picked ? `«${picked.title}» · раскройте, чтобы следить` : sub}</span>
                </span>
                <span className="ks-bar__spacer" />
                <motion.span className="ks-bar__thumbs" initial={false} animate={{ width: state === 'hover' ? nThumbs * 72 - 8 : 104 }} transition={tween}>
                  {items.slice(0, 6).map((o, i) => {
                    const fan = state === 'hover'
                    const rest = i < 3
                    return (
                      <motion.span
                        key={o.id} layoutId={zoomed ? undefined : 'thumb-' + o.id} className="ks-bar__thumb"
                        initial={false}
                        animate={fan
                          ? { x: i * 72, y: 0, rotate: [-3, 2, -2, 3, -1, 2][i], opacity: 1, scale: 1 }
                          : { x: rest ? i * 26 : 52, y: 0, rotate: rest ? [-7, 0, 7][i] : 7, opacity: rest ? 1 : 0, scale: 0.78 }}
                        whileHover={fan && !reduce ? { y: -6, rotate: 0, scale: 1.08, transition: spring } : undefined}
                        transition={{ ...spring, delay: reduce ? 0 : (fan ? 0.06 + i * 0.035 : 0) }}
                        style={{ zIndex: 10 - i }}
                      >
                        {o.img && <img src={o.img} alt="" draggable="false" />}
                      </motion.span>
                    )
                  })}
                </motion.span>
                <span className="ks-bar__chev" aria-hidden>
                  {run.waiting ? <Loader2 size={16} strokeWidth={1.8} className="ks-spin" /> : <ChevronDown size={16} strokeWidth={1.8} />}
                </span>
              </motion.button>
            ) : (
              <motion.div
                key="panel" className="ks-panel"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.14 } }}
                transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.1, ease: EASE }}
              >
                <motion.div className="ks-panel__map" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.14, ease: EASE }}>
                  <ObhodMap demo={demo} track={track} loading={trackLoading} cloud={cloud} theme={theme} />
                </motion.div>

                <div className="ks-panel__list">
                  <div className="ks-panel__head">
                    <h2 className="ks-panel__title">Выберите обход</h2>
                    <button className="ks-period" type="button" onClick={onPeriod} title="Сменить период" disabled={locked}>
                      <CalendarDays size={16} strokeWidth={1.6} />
                      <span className="ks-period__label">Период</span>
                      <span className="ks-period__value">{period?.label}</span>
                      <ChevronDown size={15} strokeWidth={1.8} className="ks-period__chev" />
                    </button>
                  </div>
                  <div className="ks-grid" role="radiogroup" aria-label="Обходы">
                    {loading && [0, 1, 2, 3].map((i) => <div key={i} className="ks-skel" />)}
                    {!loading && error && (
                      <div className="ks-empty"><b>Не удалось загрузить обходы</b>{error}</div>
                    )}
                    {!loading && !error && !items.length && (
                      <div className="ks-empty">
                        <b>За этот период обходов нет</b>
                        Снимите обход в приложении VolmetricARKit — после загрузки он появится здесь. Можно сменить период или загрузить фото вручную.
                      </div>
                    )}
                    {!loading && items.map((o, i) => (
                      <ObhodCard key={o.id} o={o} index={i} animate={!reduce} shared={!zoomed} disabled={locked}
                        selected={selected.includes(o.id)} onToggle={() => onToggle(o.id)} />
                    ))}
                  </div>
                </div>

                <div className={'ks-panel__foot' + (run.waiting ? ' is-running' : '')}>
                  <AnimatePresence mode="wait" initial={false}>
                    {run.waiting ? (
                      <motion.div key="run" className="ks-foot__run" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: EASE }}>
                        <span className="ks-run__pulse" aria-hidden />
                        <span className="ks-run__text">
                          <b>Анализируем «{picked?.title || 'обход'}» · {run.isProd ? 'PROD' : 'TEST'}</b>
                          <span className="ks-run__line">{run.startTime ? <RunClock startTime={run.startTime} /> : 'Отправляем…'}</span>
                        </span>
                        <span className="ks-run__hint">Можно не ждать: анализ досчитается на сервере, результат будет в «Истории».</span>
                        <button type="button" className="ks-queue" onClick={run.onDetach}>Не ждать</button>
                      </motion.div>
                    ) : (
                      <motion.div key="setup" className="ks-foot__setup" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: EASE }}>
                        <span className="ks-foot__count">Обход</span>
                        <div className="ks-foot__chips">
                          <AnimatePresence initial={false} mode="popLayout">
                            {picked ? (
                              <motion.div key={picked.id} className="ks-chip" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.25, ease: EASE }}>
                                {picked.img ? <img src={picked.img} alt="" /> : <span className="ks-chip__noimg" />}
                                <span className="ks-chip__text">
                                  <span className="ks-chip__date">{picked.title}</span>
                                  <span className="ks-chip__meta">{picked.photos} фото{picked.duration ? ` · ${picked.duration}` : ''}</span>
                                </span>
                                <button className="ks-chip__x" type="button" aria-label="Снять выбор" onClick={() => onToggle(picked.id)}><X size={13} strokeWidth={1.8} /></button>
                              </motion.div>
                            ) : run.notice ? (
                              <motion.span key="notice" className="ks-chip ks-chip--notice" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>
                                <Check size={14} strokeWidth={2.2} />
                                <span>{run.notice}</span>
                                <Link to="/history">История →</Link>
                              </motion.span>
                            ) : (
                              <motion.span key="none" className="ks-chip ks-chip--empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Выберите обход в списке</motion.span>
                            )}
                          </AnimatePresence>
                        </div>
                        <div className="ks-foot__mode">
                          <span className="ks-foot__label">Режим</span>
                          <div className="ks-mode" role="radiogroup" aria-label="Режим анализа">
                            <button type="button" role="radio" aria-checked={!run.isProd} className={!run.isProd ? 'is-on' : ''} onClick={() => run.setIsProd?.(false)} disabled={run.busy}>TEST</button>
                            <button type="button" role="radio" aria-checked={!!run.isProd} className={run.isProd ? 'is-on' : ''} onClick={() => run.setIsProd?.(true)} disabled={run.busy}>PROD</button>
                          </div>
                          {/* шестерёнка калибровочного куба — тот же компонент, что в ручной загрузке */}
                          <div className="ks-cube">{run.onCube && <CubeSettings onChange={run.onCube} />}</div>
                        </div>
                        <button type="button" className="ks-queue" disabled={!picked || run.busy} onClick={run.onQueue} title="Поставить в очередь и не ждать — результат придёт в «Историю»">
                          <ListPlus size={15} strokeWidth={1.8} /> В очередь
                        </button>
                        <button type="button" className="ks-continue" disabled={!picked || run.busy} onClick={run.onRun}>
                          {run.busy ? <>Отправляем… <Loader2 size={15} strokeWidth={1.8} className="ks-spin" /></> : <>Запустить анализ <ArrowRight size={15} strokeWidth={1.8} /></>}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {run.waiting && <span className="ks-run__bar" aria-hidden />}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>
      </LayoutGroup>
    </div>
  )
}
