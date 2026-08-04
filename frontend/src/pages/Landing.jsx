import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  useMotionValue,
  useInView,
  useReducedMotion,
  animate,
} from 'motion/react'
import { useAuth } from '../context/AuthContext'
import '../landing.css'

/*
  ─────────────────────────────────────────────────────────────────────────
  НАПРАВЛЕНИЕ (impeccable, бриф закреплён)
  THESIS: мир основного сайта (кремовый/лес/охра), поднятый до премиума.
    ХИРО — fullscreen-видео сборки насыпи под тонким скримом; ниже — усиленное
    liquid-glass (карточки/нав/кино-панель) поверх дрейфующих орбов; секция
    «Движок» держит scroll-привязанную 3D-сцену, просвечивающую сквозь стекло.
  OWN-WORLD: кремовый #F4F0E8, лес #1E3D12, охра #B87A18. Cormorant + Onest.
  ─────────────────────────────────────────────────────────────────────────
*/

const EASE = [0.16, 1, 0.3, 1]
const EASE_OUT_CUBIC = [0.33, 1, 0.68, 1]
// 3D-сцена движка — lazy (three.js не в главном бандле), Suspense оборачивает
const EngineScene = lazy(() => import('../components/three/MaterialShowcaseHeroImpl'))

function BlurText({ text, className = '' }) {
  const reduce = useReducedMotion()
  return (
    <span className={className}>
      {text.split(' ').map((w, i) => (
        <motion.span key={i}
          initial={reduce ? false : { filter: 'blur(12px)', opacity: 0, y: '0.3em' }}
          animate={reduce ? {} : { filter: 'blur(0px)', opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 + i * 0.08, ease: EASE }}
          style={{ display: 'inline-block', marginRight: '0.25em', willChange: 'filter, transform' }}
        >{w}</motion.span>
      ))}
    </span>
  )
}

const reveal = {
  initial: { opacity: 0, y: 24, filter: 'blur(8px)' },
  whileInView: { opacity: 1, y: 0, filter: 'blur(0px)' },
  viewport: { once: true, margin: '-12% 0px' },
  transition: { duration: 0.7, ease: EASE },
}

function MagneticCta({ to, href, onClick, children, className = '' }) {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const x = useMotionValue(0); const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 220, damping: 16 })
  const sy = useSpring(y, { stiffness: 220, damping: 16 })
  const move = (e) => {
    if (reduce || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    x.set((e.clientX - (r.left + r.width / 2)) * 0.3)
    y.set((e.clientY - (r.top + r.height / 2)) * 0.3)
  }
  const reset = () => { x.set(0); y.set(0) }
  let inner
  if (to) inner = <Link to={to} className={className}>{children}</Link>
  else if (onClick) inner = <button type="button" className={className} onClick={onClick}>{children}</button>
  else inner = <a href={href} className={className}>{children}</a>
  return (
    <motion.span ref={ref} className="kb-l-mag" style={{ x: sx, y: sy }} onMouseMove={move} onMouseLeave={reset}>
      {inner}
    </motion.span>
  )
}

/* Счётчик: 0 → to за 1.5с (ease-out-cubic), стартует ТОЛЬКО когда карточка
   реально попала в кадр (useInView amount .35, once). reduced-motion → сразу
   финал без анимации. */
function Metric({ to, decimals = 0 }) {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const inView = useInView(ref, { once: true, amount: 0.35 })
  const fmt = (v) => (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('ru-RU'))
  useEffect(() => {
    if (!ref.current) return
    if (reduce) { ref.current.textContent = fmt(to); return }
    if (!inView) return
    const controls = animate(0, to, {
      duration: 1.5, ease: EASE_OUT_CUBIC,
      onUpdate(v) { if (ref.current) ref.current.textContent = fmt(v) },
    })
    return () => controls.stop()
  }, [inView, to, decimals, reduce])
  return <span ref={ref}>{reduce ? fmt(to) : '0'}</span>
}

const scrollTo = (id) => (e) => {
  e.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/* декоративные орбы под стеклом (aria-hidden, не кликаются) */
function Orb({ variant, style, delay }) {
  return <div className={`kb-l-orb kb-l-orb--${variant}`} aria-hidden="true"
    style={{ ...style, animationDelay: delay }} />
}

const HouseMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)
const Mark = () => (
  <Link to="/" className="kb-l-mark">
    <span className="kb-l-mark__icon"><HouseMark /></span>
    <span className="kb-l-mark__text">
      <span className="kb-l-mark__name">Карелия Строй</span>
      <span className="kb-l-mark__sub">AI · объём и масса</span>
    </span>
  </Link>
)

/* ═══════════════════════════════ НАВИГАЦИЯ ═════════════════════════════════ */
function LiquidNav({ user }) {
  const [solid, setSolid] = useState(false)
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 40)
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <motion.header className={`kb-l-nav${solid ? ' is-solid' : ''}`}
      initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.1 }}>
      <Mark />
      <nav className="kb-l-nav__center">
        <a href="#dash" onClick={scrollTo('dash')}>Показания</a>
        <a href="#engine" onClick={scrollTo('engine')}>Движок</a>
        <a href="#proc" onClick={scrollTo('proc')}>Процесс</a>
      </nav>
      <div className="kb-l-nav__right">
        {!user && <Link to="/login" className="kb-l-link">Войти</Link>}
        <MagneticCta to={user ? '/app' : '/register'} className="kb-l-btn kb-l-btn--solid">
          {user ? 'В сервис' : 'Начать'}
        </MagneticCta>
      </div>
    </motion.header>
  )
}

/* ═══════════════════════════════════ HERO ══════════════════════════════════ */
/* Видео вместо 3D. Grid-полосы: pad · center(cq) · CTA · чипы. */
function Hero({ user }) {
  const ref = useRef(null)
  const vidRef = useRef(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -60])
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])

  // видео: играет только пока хиро в кадре; reduced-motion → пауза на постере
  useEffect(() => {
    const v = vidRef.current
    const sec = ref.current
    if (!v) return
    if (reduce) { v.pause(); return }
    if (!sec) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) v.play?.().catch(() => {})
      else v.pause?.()
    }, { threshold: 0.05 })
    io.observe(sec)
    return () => io.disconnect()
  }, [reduce])

  return (
    <section ref={ref} className="kb-l-hero">
      <video ref={vidRef} className="kb-l-hero__video" aria-hidden="true" tabIndex={-1}
        src="/landing/video.mp4" poster="/landing/build-still.webp"
        autoPlay={!reduce} loop muted playsInline preload="auto" />
      <div className="kb-l-hero__scrim" aria-hidden="true" />

      <div className="kb-l-hero__pad" aria-hidden="true" />

      <motion.div className="kb-l-hero__center" style={{ y, opacity }}>
        <motion.div className="kb-l-badge"
          initial={reduce ? false : { opacity: 0, y: 12 }} animate={reduce ? {} : { opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}>
          <span className="kb-l-badge__pill">НОВОЕ</span> Замер по фото прямо на площадке · Карелия
        </motion.div>
        <h1 className="kb-l-hero__title">
          <BlurText text="Объём и масса" />
          <em className="kb-l-hero__em"><BlurText text="из простых фотографий" /></em>
        </h1>
        <motion.p className="kb-l-hero__sub"
          initial={reduce ? false : { opacity: 0, y: 16 }} animate={reduce ? {} : { opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.7 }}>
          Снимите насыпь или материал на телефон со всех сторон. Соберём точную
          3D-модель, посчитаем объём и массу и подготовим отчёт.
        </motion.p>
      </motion.div>

      <motion.div className="kb-l-hero__cta"
        initial={reduce ? false : { opacity: 0, y: 16 }} animate={reduce ? {} : { opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: EASE, delay: 0.85 }}>
        <MagneticCta to={user ? '/app' : '/register'} className="kb-l-btn kb-l-btn--hero">
          {user ? 'Перейти в сервис' : 'Начать'}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </MagneticCta>
        <a href="#dash" onClick={scrollTo('dash')} className="kb-l-btn kb-l-btn--ghost">Смотреть показания</a>
      </motion.div>

      <motion.div className="kb-l-hero__chips"
        initial={reduce ? false : { opacity: 0, y: 14 }} animate={reduce ? {} : { opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE, delay: 1.1 }}>
        <span className="kb-l-hero__chip">Объём&nbsp;<b>~ 1&nbsp;428 м³</b></span>
        <span className="kb-l-hero__chip">Точность&nbsp;<b>±1.8%</b></span>
        <span className="kb-l-hero__chip">Масса&nbsp;<b>~ 2&nbsp;271 т</b></span>
      </motion.div>
    </section>
  )
}

/* ═══════════════════════════════ БЕНТО-ДАШБОРД ═════════════════════════════ */
/* Вложенный флекс (без grid-column:span): не ломается на узких экранах. */
const CONVEYOR = [['Снимки', 1], ['Облако', 0.82], ['Меш', 0.68], ['Объём', 1]]
function Dashboard() {
  const reduce = useReducedMotion()
  return (
    <section id="dash" className="kb-l-sec">
      <Orb variant="green" style={{ width: 420, height: 420, top: -80, left: -120 }} />
      <Orb variant="gold" style={{ width: 460, height: 460, bottom: -140, right: -120 }} delay="-8s" />
      <div className="kb-l-sec__in">
        <motion.div className="kb-l-sec__head" {...reveal}>
          <h2 className="kb-l-h2">Показания <em>как на пульте</em></h2>
          <p className="kb-l-lead">Каждый анализ — измеримый результат: объём, масса, плотность, 3D-модель и PDF-отчёт. Значения ниже — пример.</p>
        </motion.div>

        <div className="kb-l-bento">
          <div className="kb-l-bento__row">
            <motion.div className="kb-l-w--recon" {...reveal}>
              <div className="kb-l-recon-img" style={{ backgroundImage: 'url(/landing/build-still.webp)' }} />
              <div className="kb-l-recon-badge"><span className="kb-l-recon-dot" /> МЕШ ГОТОВ</div>
              <div className="kb-l-recon-cap"><h3>3D-реконструкция</h3><p>облако точек → полигональный меш → объём</p></div>
            </motion.div>

            <div className="kb-l-bento__metrics">
              <motion.div className="kb-l-w kb-l-glass" {...reveal} transition={{ ...reveal.transition, delay: 0.06 }}>
                <span className="kb-l-w__label">Объём</span>
                <span className="kb-l-w__num"><Metric to={1428.6} decimals={1} /><span className="kb-l-unit">м³</span></span>
              </motion.div>
              <motion.div className="kb-l-w kb-l-glass" {...reveal} transition={{ ...reveal.transition, delay: 0.12 }}>
                <span className="kb-l-w__label">Масса</span>
                <span className="kb-l-w__num"><Metric to={2271} /><span className="kb-l-unit">т</span></span>
              </motion.div>
              <motion.div className="kb-l-w kb-l-glass" {...reveal} transition={{ ...reveal.transition, delay: 0.18 }}>
                <span className="kb-l-w__label">Плотность</span>
                <span className="kb-l-w__num"><Metric to={1.59} decimals={2} /><span className="kb-l-unit">т/м³</span></span>
                <span className="kb-l-w__note">по типу материала</span>
              </motion.div>
              <motion.div className="kb-l-w kb-l-glass" {...reveal} transition={{ ...reveal.transition, delay: 0.24 }}>
                <span className="kb-l-w__label">Погрешность</span>
                <span className="kb-l-w__num"><Metric to={1.8} decimals={1} /><span className="kb-l-unit">%</span></span>
                <span className="kb-l-w__note">на типовых насыпях</span>
              </motion.div>
            </div>
          </div>

          <div className="kb-l-bento__row--wide">
            <motion.div className="kb-l-w kb-l-glass" {...reveal} transition={{ ...reveal.transition, delay: 0.14 }}>
              <span className="kb-l-w__label">Конвейер</span>
              <div className="kb-l-mini">
                {CONVEYOR.map(([t, w], i) => (
                  <div key={t} className="kb-l-mini__step">
                    <div className="kb-l-mini__bar">
                      <motion.i initial={reduce ? { scaleX: w } : { scaleX: 0 }} whileInView={{ scaleX: w }}
                        viewport={{ once: true, amount: 0.35 }}
                        transition={{ duration: 0.9, delay: 0.15 + i * 0.1, ease: EASE }} />
                    </div>
                    <span className="kb-l-mini__t">{t}</span>
                  </div>
                ))}
              </div>
            </motion.div>
            <motion.div className="kb-l-w kb-l-glass" {...reveal} transition={{ ...reveal.transition, delay: 0.2 }}>
              <span className="kb-l-w__label">Экспорт</span>
              <div className="kb-l-chips"><span>GLB</span><span>PLY</span><span>PDF-отчёт</span><span>3D в браузере</span></div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════ СЕКЦИЯ «ДВИЖОК» (стекло + сцена) ══════════════ */
const ENGINE = [
  ['Калибровочные кубы 4×4', 'задают масштаб сцены'],
  ['Гравий и песок', 'дают объём и текстуру материала'],
  ['DUSt3R', 'восстанавливает геометрию из кадров'],
  ['Выравнивание по земле', 'объём считается над опорной плоскостью'],
]
function Engine() {
  const secRef = useRef(null)
  const reduce = useReducedMotion()
  const [show3d, setShow3d] = useState(false)
  // МАКС. ОПТИМИЗАЦИЯ: three.js-чанк и тяжёлые GLB грузятся ТОЛЬКО когда секция
  // подъезжает (rootMargin 500px), а не на входе на страницу. На reduced-motion
  // 3D вообще не монтируем — экономим ~17МБ загрузки и весь GPU-бюджет.
  useEffect(() => {
    if (reduce) return
    const el = secRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShow3d(true); io.disconnect() }
    }, { rootMargin: '500px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [reduce])
  return (
    <section id="engine" ref={secRef} className="kb-l-sec kb-l-engine">
      {/* scroll-привязанная 3D-сцена (lazy, KTX2, AdaptiveDpr) — просвечивает сквозь стекло.
          Монтируется по близости (см. show3d) → до подъезда ни байта three/GLB. */}
      <div className="kb-l-engine__scene" aria-hidden="true">
        {show3d && <Suspense fallback={null}><EngineScene /></Suspense>}
      </div>
      <img className="kb-l-engine__flora kb-l-engine__flora--l" src="/decor/flora-left.png" alt="" aria-hidden="true" />
      <img className="kb-l-engine__flora kb-l-engine__flora--r" src="/decor/flora-right.png" alt="" aria-hidden="true" />
      <div className="kb-l-engine__grid">
        <motion.div className="kb-l-engine__copy" {...reveal}>
          <h2 className="kb-l-h2">Тот же движок, <em>что в сервисе</em></h2>
          <p className="kb-l-lead">Объекты вокруг — не декор. Это те же кубы, гравий и песок, из которых сервис собирает измеримую 3D-сцену. Прокрутите — материал облетает площадку и стягивается к замеру.</p>
        </motion.div>
        <motion.ul className="kb-l-engine__panel kb-l-engine__list kb-l-glass" {...reveal} transition={{ ...reveal.transition, delay: 0.1 }}>
          {ENGINE.map(([b, d]) => (
            <li key={b}><span className="kb-l-engine__dot" /><span><b>{b}</b> — {d}</span></li>
          ))}
        </motion.ul>
      </div>
    </section>
  )
}

/* ═══════════════════════════════ ПРОЦЕСС ═══════════════════════════════════ */
const StepGlyph = ({ i }) => (
  <svg viewBox="0 0 76 54" className="kb-l-step__glyph" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {i === 0 && <><rect x="14" y="12" width="34" height="26" rx="2" /><rect x="26" y="20" width="34" height="26" rx="2" opacity=".45" /><circle cx="31" cy="25" r="4.5" /></>}
    {i === 1 && <><path d="M38 8 L64 46 L12 46 Z" /><path d="M38 8 V46 M25 46 L38 26 L51 46" opacity=".5" /></>}
    {i === 2 && <><path d="M20 6 h26 l10 10 v32 a2 2 0 0 1-2 2 H20 a2 2 0 0 1-2-2 V8 a2 2 0 0 1 2-2z" /><path d="M46 6 v10 h10 M26 28 h22 M26 36 h22" opacity=".7" /></>}
  </svg>
)
const STEPS = [
  { k: 'Шаг 1', t: 'Снимки', d: 'Обойдите объект с телефоном и снимите со всех сторон. Спецоборудование не нужно.' },
  { k: 'Шаг 2', t: 'Реконструкция', d: 'DUSt3R собирает облако точек и 3D-меш, выравнивает по опорной плоскости.' },
  { k: 'Шаг 3', t: 'Отчёт', d: 'Объём, масса и PDF-расчёт с 3D-моделью, которую можно вращать в браузере.' },
]
function Process() {
  return (
    <section id="proc" className="kb-l-sec">
      <Orb variant="gold" style={{ width: 380, height: 380, top: -60, right: -100 }} />
      <Orb variant="green" style={{ width: 420, height: 420, bottom: -120, left: -120 }} delay="-6s" />
      <div className="kb-l-sec__in">
        <motion.div className="kb-l-sec__head" {...reveal}>
          <h2 className="kb-l-h2">Как это работает</h2>
          <p className="kb-l-lead">От серии кадров до кубометров — один проход, минуты вместо полевых работ.</p>
        </motion.div>
        <div className="kb-l-steps">
          {STEPS.map((s, i) => (
            <motion.div key={s.k} className="kb-l-step kb-l-glass" {...reveal} transition={{ ...reveal.transition, delay: i * 0.1 }}>
              <span className="kb-l-step__k">{s.k}</span>
              <StepGlyph i={i} />
              <h3 className="kb-l-step__t">{s.t}</h3>
              <p className="kb-l-step__d">{s.d}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════ КИНО-МОМЕНТ ══════════════════════════════ */
function Cinematic() {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], reduce ? ['0%', '0%'] : ['-8%', '8%'])
  const scale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [1.12, 1])
  return (
    <section ref={ref} className="kb-l-cine">
      <motion.div className="kb-l-cine__img" style={{ y, scale }} aria-hidden="true" />
      <div className="kb-l-cine__veil" aria-hidden="true" />
      <motion.div className="kb-l-cine__panel kb-l-glass" {...reveal}>
        <h2 className="kb-l-cine__title">Стройка, измеренная<br /><em>с точностью</em></h2>
        <p className="kb-l-cine__sub">Там, где нужна была бригада с тахеометром, теперь — серия фотографий и пара минут.</p>
      </motion.div>
    </section>
  )
}

/* ═══════════════════════════════ ФИНАЛ ═════════════════════════════════════ */
function FinalCta({ user }) {
  return (
    <section className="kb-l-final">
      <Orb variant="green" style={{ width: 360, height: 360, top: -60, left: -80 }} />
      <Orb variant="gold" style={{ width: 400, height: 400, bottom: -120, right: -100 }} delay="-9s" />
      <motion.div className="kb-l-final__panel"
        initial={{ opacity: 0, y: 30, scale: 0.98 }} whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: '-15% 0px' }} transition={{ duration: 0.8, ease: EASE }}>
        <h2 className="kb-l-final__title">Начните <em>измерять</em></h2>
        <p className="kb-l-final__sub">Регистрация — минута. Первый анализ — бесплатно.</p>
        <div className="kb-l-final__cta">
          <MagneticCta to={user ? '/app' : '/register'} className="kb-l-btn kb-l-btn--hero">
            {user ? 'Перейти в сервис' : 'Создать аккаунт'}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </MagneticCta>
          {!user && <Link to="/login" className="kb-l-btn kb-l-btn--ghost">Войти</Link>}
        </div>
      </motion.div>
    </section>
  )
}

/* ═══════════════════════════════ ПОДВАЛ ════════════════════════════════════ */
function Footer() {
  const copyEmail = () => {
    navigator.clipboard?.writeText('yakov.kachalin@mail.ru')
    alert('Email скопирован: yakov.kachalin@mail.ru')
  }
  return (
    <footer className="kb-l-foot">
      <div className="kb-l-foot__top">
        <Mark />
        <nav className="kb-l-foot__links">
          <Link to="/register">Регистрация</Link>
          <Link to="/login">Вход</Link>
          <Link to="/privacy">Конфиденциальность</Link>
          <button type="button" onClick={copyEmail}>yakov.kachalin@mail.ru</button>
        </nav>
      </div>
      <div className="kb-l-foot__bottom">
        <span>© 2026 Карелия Строй — AI сервис</span>
        <span>Петрозаводск · Карелия</span>
      </div>
    </footer>
  )
}

/* ════════════════════════════════ СТРАНИЦА ═════════════════════════════════ */
export default function Landing() {
  const { user } = useAuth()
  return (
    <div className="kb-landing">
      <LiquidNav user={user} />
      <Hero user={user} />
      <Dashboard />
      <Engine />
      <Process />
      <Cinematic />
      <FinalCta user={user} />
      <Footer />
    </div>
  )
}
