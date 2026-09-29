import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'motion/react'
import { Camera, Route, Box, ChevronDown, CalendarDays, ArrowRight, X } from 'lucide-react'
import ObhodMap from './ObhodMap'
import ObhodCard from './ObhodCard'
import { plural } from './scans'

function useMedia(q) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q); const on = () => setM(mq.matches)
    mq.addEventListener('change', on); return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

/* Панель выбора обхода: покой → (наведение | фокус) → раскрыта.
   В покое — узкая плашка; при наведении растягивается почти во всю ширину,
   по клику раскрывается в карту и список. На тач-экранах наведения нет —
   тап раскрывает сразу. Esc сворачивает. Выбор хранит родитель (Analyze). */
export default function ObhodPicker({
  items, selected, onToggle, onContinue,
  loading = false, error = null, demo = false,
  track = null, trackLoading = false, cloud = null, theme = 'light',
  period, onPeriod,
  initialState = 'rest',
}) {
  const [state, setState] = useState(initialState)
  const reduce = useReducedMotion()
  const timer = useRef()
  const canHover = useMedia('(hover: hover) and (pointer: fine)')
  const narrow = useMedia('(max-width: 720px)')
  const SIZES = {
    rest: { width: narrow ? '100%' : 640, height: narrow ? 76 : 88 },
    hover: { width: '100%', height: narrow ? 76 : 88 },
    open: { width: '100%', height: 'auto' },
  }

  useEffect(() => {
    if (state !== 'open') return
    const onKey = (e) => { if (e.key === 'Escape') setState('rest') }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state])
  useEffect(() => () => clearTimeout(timer.current), [])

  const intent = (next, delay) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState((s) => (s === 'open' ? s : next)), delay)
  }

  const picked = items.filter((o) => selected.includes(o.id))
  const spring = reduce ? { duration: 0 } : { type: 'spring', stiffness: 210, damping: 30, mass: .9 }
  const open = state === 'open'
  const last = items[0]
  const sub = loading ? 'Загружаем обходы…'
    : error ? 'Не удалось загрузить обходы'
    : items.length ? `${items.length} ${plural(items.length, 'обход', 'обхода', 'обходов')} · последний ${last.dateShort || last.date}`
    : 'Пока нет обходов за период'

  return (
    <div className="ks-stage">
      <LayoutGroup>
        <motion.section
          className={'ks-picker is-' + state}
          initial={false}
          animate={SIZES[state]}
          transition={open ? { ...spring, height: reduce ? { duration: 0 } : { type: 'spring', stiffness: 170, damping: 28 } } : spring}
          onPointerEnter={() => canHover && intent('hover', 60)}
          onPointerLeave={() => canHover && intent('rest', 200)}
          aria-label="Выбор обхода"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {!open ? (
              <motion.button
                key="bar" type="button" className="ks-bar"
                onClick={() => setState('open')}
                onFocus={() => intent('hover', 0)}
                onBlur={() => intent('rest', 0)}
                aria-expanded="false"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: reduce ? 0 : .12 } }}
              >
                <span className="ks-bar__icons" aria-hidden>
                  <span><Camera size={17} strokeWidth={1.6} /></span>
                  <span><Route size={17} strokeWidth={1.6} /></span>
                  <span><Box size={17} strokeWidth={1.6} /></span>
                </span>
                <span className="ks-bar__text">
                  <span className="ks-bar__title">Выберите обход</span>
                  <span className="ks-bar__sub">{sub}</span>
                </span>
                <span className="ks-bar__spacer" />
                <motion.span className="ks-bar__thumbs" animate={{ width: state === 'hover' ? Math.max(1, Math.min(6, items.length)) * 72 - 8 : 104 }} transition={spring}>
                  {items.slice(0, 6).map((o, i) => {
                    const fan = state === 'hover'
                    const rest = i < 3
                    return (
                      <motion.span
                        key={o.id} layoutId={'thumb-' + o.id} className="ks-bar__thumb"
                        initial={false}
                        animate={fan
                          ? { x: i * 72, rotate: 0, opacity: 1, scale: 1 }
                          : { x: rest ? i * 26 : 52, rotate: rest ? [-7, 0, 7][i] : 7, opacity: rest ? 1 : 0, scale: .78 }}
                        transition={{ ...spring, delay: reduce ? 0 : (fan ? i * .035 : (5 - i) * .02) }}
                        style={{ zIndex: 10 - i }}
                      >
                        {o.img && <img src={o.img} alt="" draggable="false" />}
                      </motion.span>
                    )
                  })}
                </motion.span>
                <span className="ks-bar__hint">{state === 'hover' ? 'Нажмите, чтобы раскрыть' : ''}</span>
                <span className="ks-bar__chev" aria-hidden><ChevronDown size={16} strokeWidth={1.8} /></span>
              </motion.button>
            ) : (
              <motion.div
                key="panel" className="ks-panel"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : .25, delay: reduce ? 0 : .08 }}
              >
                <motion.div className="ks-panel__map" initial={reduce ? false : { opacity: 0, scale: .985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .5, delay: .14, ease: [.2, .8, .2, 1] }}>
                  <ObhodMap demo={demo} track={track} loading={trackLoading} cloud={cloud} theme={theme} />
                </motion.div>

                <div className="ks-panel__list">
                  <div className="ks-panel__head">
                    <h2 className="ks-panel__title">Выберите обход</h2>
                    <button className="ks-period" type="button" onClick={onPeriod} title="Сменить период">
                      <CalendarDays size={16} strokeWidth={1.6} />
                      <span className="ks-period__label">Период</span>
                      <span className="ks-period__value">{period?.label}</span>
                      <ChevronDown size={15} strokeWidth={1.8} className="ks-period__chev" />
                    </button>
                  </div>
                  <div className="ks-grid">
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
                      <ObhodCard key={o.id} o={o} index={i} animate={!reduce} selected={selected.includes(o.id)} onToggle={() => onToggle(o.id)} />
                    ))}
                  </div>
                </div>

                <div className="ks-panel__foot">
                  <span className="ks-foot__count">Выбрано: {picked.length} {plural(picked.length, 'обход', 'обхода', 'обходов')}</span>
                  <div className="ks-foot__chips">
                    <AnimatePresence initial={false}>
                      {picked.slice(0, 2).map((o) => (
                        <motion.div key={o.id} className="ks-chip" layout initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .96 }} transition={{ duration: .2 }}>
                          {o.img ? <img src={o.img} alt="" /> : <span className="ks-chip__noimg" />}
                          <span className="ks-chip__text">
                            <span className="ks-chip__date">{o.date}</span>
                            <span className="ks-chip__meta">{o.photos} фото{o.duration ? ` · ${o.duration}` : ''}</span>
                          </span>
                          <button className="ks-chip__x" type="button" aria-label="Убрать" onClick={() => onToggle(o.id)}><X size={13} strokeWidth={1.8} /></button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {picked.length > 2 && <span className="ks-chip ks-chip--more">+{picked.length - 2}</span>}
                  </div>
                  <button className="ks-continue" disabled={!picked.length} type="button" onClick={() => { setState('rest'); onContinue() }}>
                    Продолжить <ArrowRight size={15} strokeWidth={1.8} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>
      </LayoutGroup>
    </div>
  )
}
