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
  НАПРАВЛЕНИЕ (direction contract · impeccable new-work, бриф закреплён)
  THESIS: лендинг — это ПОКАЗАНИЕ ПРИБОРА, а не SaaS-hero. Он доказывает, что
    телефон + фотограмметрия = измерительный инструмент (объём/масса). Отказ:
    кремово-готический вид основного сайта, gradient-hero, карточки-сетки.
  OWN-WORLD: графитовый near-black (#08090A), liquid-glass хром (реальный
    материал: навигация, CTA, панель отчёта), ОДИН сигнал — survey-оранжевый
    #ff6a2b (заливки/линии скана/фокус). Тип: Archivo (гротеск) + JetBrains
    Mono ТОЛЬКО для реальных измерений. Свет — прохладный графит, не серый.
  STORY: гость понимает «фото → 3D → объём/масса», верит в точность прибора,
    жмёт «Начать» → /register (или /app, если вошёл).
  FIRST VIEWPORT: огромный дисплей-заголовок, HUD мono-показания по углам,
    процедурное облако точек СОБИРАЕТСЯ на скролле, primary-CTA слева.
  FORM: закреплённый бриф (motionsites liquid-glass + инженерность). Roll не
    запускаем — brief-pinned direction beats the roll. Focal-motion: одна
    оркестрированная реконструкция (облако→насыпь + scan-wipe), не fade на
    каждой секции. FINISH: unreviewed — детектор impeccable прогнан, сборка зелёная.
  ─────────────────────────────────────────────────────────────────────────
*/

const EASE = [0.16, 1, 0.3, 1]

// облако точек грузим лениво (three тяжёлый) — не блокирует первый paint hero
const PointCloud = lazy(() => import('../components/three/PointCloudLandingImpl'))

/* ── заголовок героя: слова проявляются из размытия (авторский вход) ─────── */
function BlurText({ text, className = '' }) {
  const reduce = useReducedMotion()
  return (
    <span className={className} style={{ display: 'inline' }}>
      {text.split(' ').map((w, i) => (
        <motion.span
          key={i}
          initial={reduce ? false : { filter: 'blur(12px)', opacity: 0, y: '0.35em' }}
          animate={reduce ? {} : { filter: 'blur(0px)', opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.15 + i * 0.085, ease: EASE }}
          style={{ display: 'inline-block', marginRight: '0.26em', willChange: 'filter, transform' }}
        >
          {w}
        </motion.span>
      ))}
    </span>
  )
}

/* ── scan-wipe: контент открывается «сканирующей линией» (clip-path), не fade ─ */
function ScanReveal({ children, className = '', delay = 0, as = 'div' }) {
  const reduce = useReducedMotion()
  const M = motion[as] || motion.div
  return (
    <M
      className={className}
      initial={reduce ? false : { clipPath: 'inset(0 100% 0 0)', opacity: 0.35 }}
      whileInView={reduce ? {} : { clipPath: 'inset(0 0% 0 0)', opacity: 1 }}
      viewport={{ once: true, margin: '-12% 0px' }}
      transition={{ duration: 0.85, delay, ease: EASE }}
    >
      {children}
    </M>
  )
}

/* ── магнитная CTA: вся «пилюля» тянется к курсору (десктоп) ──────────────── */
function MagneticCta({ to, href, onClick, children, className = '' }) {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
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

/* ── измерение: докручивается от 0 при появлении; моно, tabular ──────────── */
function Metric({ to, decimals = 0, unit = '', className = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  useEffect(() => {
    if (!inView || !ref.current) return
    const node = ref.current
    const controls = animate(0, to, {
      duration: 1.4,
      ease: EASE,
      onUpdate(v) {
        const n = decimals ? v.toFixed(decimals) : Math.round(v)
        node.firstChild.textContent = n.toLocaleString('ru-RU')
      },
    })
    return () => controls.stop()
  }, [inView, to, decimals])
  return (
    <span className={className}>
      <span ref={ref}>0</span>{unit && <span className="kb-l-unit">{unit}</span>}
    </span>
  )
}

const scrollTo = (id) => (e) => {
  e.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/* контурная марка прибора (не эмодзи) — концентрические кольца замера */
const Mark = () => (
  <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.3" opacity=".55" />
    <circle cx="16" cy="16" r="7.5" stroke="currentColor" strokeWidth="1.3" opacity=".8" />
    <circle cx="16" cy="16" r="2" fill="currentColor" />
    <path d="M16 1v6M16 25v6M1 16h6M25 16h6" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

/* ═══════════════════════════════ НАВИГАЦИЯ ═════════════════════════════════ */
function LiquidNav({ user }) {
  const [solid, setSolid] = useState(false)
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 32)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <motion.header
      className={`kb-l-nav${solid ? ' is-solid' : ''}`}
      initial={{ y: -70, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.1 }}
    >
      <Link to="/" className="kb-l-mark">
        <span className="kb-l-mark__icon"><Mark /></span>
        <span className="kb-l-mark__name">karelia<span className="kb-l-mark__slash">/</span>volume</span>
      </Link>

      <nav className="kb-l-nav__center lg">
        <a href="#how" onClick={scrollTo('how')}>Процесс</a>
        <a href="#precision" onClick={scrollTo('precision')}>Отчёт</a>
        <a href="#specs" onClick={scrollTo('specs')}>Характеристики</a>
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
function Hero({ user }) {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -90])
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])

  return (
    <section ref={ref} className="kb-l-hero">
      {/* генерируемый backdrop (облако-скан) под процедурным WebGL */}
      <div className="kb-l-hero__bg" aria-hidden="true" />
      <Suspense fallback={null}><PointCloud /></Suspense>
      <div className="kb-l-hero__scan" aria-hidden="true" />

      {/* HUD — mono-показания прибора по углам (не eyebrow, а инструментальный слой) */}
      <div className="kb-l-hud kb-l-hud--tl">KARELIA · VOLUME ENGINE</div>
      <div className="kb-l-hud kb-l-hud--tr">SCAN&nbsp;04 · 5.2M&nbsp;pts · Δ&nbsp;±1.8%</div>

      <motion.div className="kb-l-hero__inner" style={{ y, opacity }}>
        <h1 className="kb-l-hero__title">
          <BlurText text="Объём и масса" />
          <span className="kb-l-hero__title-2"><BlurText text="из обычных фотографий" /></span>
        </h1>

        <motion.p
          className="kb-l-hero__sub"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={reduce ? {} : { opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.75 }}
        >
          Снимите объект на телефон с разных сторон. Фотограмметрия соберёт точную
          3D-модель, посчитает объём и массу материала и подготовит отчёт.
        </motion.p>

        <motion.div
          className="kb-l-hero__cta"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={reduce ? {} : { opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.9 }}
        >
          <MagneticCta to={user ? '/app' : '/register'} className="kb-l-btn kb-l-btn--hero lg-strong">
            {user ? 'Перейти в сервис' : 'Начать'}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </MagneticCta>
          <a href="#how" onClick={scrollTo('how')} className="kb-l-btn kb-l-btn--ghost">Как это работает</a>
        </motion.div>
      </motion.div>

      {/* шкала масштаба — инструментальная деталь внизу */}
      <div className="kb-l-scalebar" aria-hidden="true">
        <span className="kb-l-scalebar__tick" />
        <span className="kb-l-scalebar__label">0</span>
        <span className="kb-l-scalebar__line" />
        <span className="kb-l-scalebar__label">2&nbsp;м</span>
        <span className="kb-l-scalebar__tick" />
      </div>
    </section>
  )
}

/* ═══════════════════════════ ПРОЦЕСС (focal-секвенция) ═════════════════════ */
const STAGES = [
  { k: '01', t: 'Снимки', d: 'Серия кадров объекта со всех сторон. Обычная камера телефона, без спецоборудования.' },
  { k: '02', t: 'Облако точек', d: 'DUSt3R восстанавливает геометрию сцены — плотное облако из миллионов точек.' },
  { k: '03', t: 'Меш', d: 'Точки сшиваются в полигональную поверхность и выравниваются по опорной плоскости.' },
  { k: '04', t: 'Объём', d: 'Считаем объём насыпи над землёй и массу — по плотности материала.' },
]
function StageGlyph({ i }) {
  // 4 разных состояния реконструкции — не иконки-костыли, а стадии одного объекта
  return (
    <svg viewBox="0 0 80 56" className="kb-l-stage__glyph" fill="none" aria-hidden="true">
      {i === 0 && <>
        <rect x="10" y="8" width="34" height="26" rx="2" stroke="currentColor" strokeWidth="1.4" />
        <rect x="22" y="18" width="34" height="26" rx="2" stroke="currentColor" strokeWidth="1.4" opacity=".6" />
        <rect x="34" y="26" width="34" height="24" rx="2" stroke="currentColor" strokeWidth="1.4" opacity=".35" />
      </>}
      {i === 1 && Array.from({ length: 42 }).map((_, n) => {
        const cx = 12 + (n % 14) * 4.2 + (n % 3) * 1.5
        const cy = 46 - Math.floor(n / 14) * 6 - ((n * 7) % 5)
        return <circle key={n} cx={cx} cy={cy} r="1" fill="currentColor" opacity={0.4 + (n % 5) * 0.12} />
      })}
      {i === 2 && <>
        <path d="M40 8 L68 44 L12 44 Z" stroke="currentColor" strokeWidth="1.4" />
        <path d="M40 8 L40 44M26 44 L40 26 L54 44M20 44 L40 18 L60 44" stroke="currentColor" strokeWidth="1" opacity=".5" />
      </>}
      {i === 3 && <>
        <path d="M40 10 L66 44 L14 44 Z" stroke="currentColor" strokeWidth="1.4" />
        <path d="M14 44 H66" stroke="#ff6a2b" strokeWidth="1.6" />
        <path d="M40 14 V44" stroke="#ff6a2b" strokeWidth="1" strokeDasharray="2 3" opacity=".8" />
      </>}
    </svg>
  )
}
function Pipeline() {
  return (
    <section id="how" className="kb-l-sec kb-l-pipeline">
      <div className="kb-l-sec__head">
        <h2 className="kb-l-h2">От снимков до кубометров</h2>
        <p className="kb-l-sec__lead">Один проход реконструкции. Каждая стадия — состояние одного объекта, не отдельная услуга.</p>
      </div>
      <ol className="kb-l-stages">
        {STAGES.map((s, i) => (
          <motion.li
            key={s.k}
            className="kb-l-stage lg"
            initial={{ opacity: 0, y: 26, filter: 'blur(6px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.6, ease: EASE, delay: i * 0.12 }}
          >
            <span className="kb-l-stage__k">{s.k}<span className="kb-l-stage__of">/04</span></span>
            <StageGlyph i={i} />
            <h3 className="kb-l-stage__t">{s.t}</h3>
            <p className="kb-l-stage__d">{s.d}</p>
          </motion.li>
        ))}
      </ol>
    </section>
  )
}

/* ═══════════════════════════ ОТЧЁТ (proof, не hero-metric) ═════════════════ */
const REPORT = [
  { l: 'Объём', to: 1428.6, dec: 1, u: 'м³', hi: true },
  { l: 'Масса', to: 2271, dec: 0, u: 'т', hi: true },
  { l: 'Плотность', to: 1.59, dec: 2, u: 'т/м³' },
  { l: 'Погрешность', to: 1.8, dec: 1, u: '%' },
  { l: 'Точек', to: 5214880, dec: 0, u: '' },
  { l: 'Расчёт', to: 160, dec: 0, u: 'с' },
]
function Report() {
  return (
    <section id="precision" className="kb-l-sec kb-l-precision">
      <div className="kb-l-precision__grid">
        <ScanReveal className="kb-l-sec__head kb-l-precision__intro">
          <h2 className="kb-l-h2">Отчёт, а не картинка</h2>
          <p className="kb-l-sec__lead">
            На выходе — измеримый документ: объём, масса и погрешность, PDF с формулами
            и 3D-модель, которую можно вращать прямо в браузере.
          </p>
        </ScanReveal>

        <motion.div
          className="kb-l-readout lg"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15% 0px' }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <div className="kb-l-readout__bar">
            <span>ОТЧЁТ · ПРИМЕР</span>
            <span className="kb-l-readout__id">#A-0417</span>
          </div>
          <dl className="kb-l-readout__rows">
            {REPORT.map((r) => (
              <div key={r.l} className={`kb-l-readout__row${r.hi ? ' is-hi' : ''}`}>
                <dt>{r.l}</dt>
                <dd><Metric to={r.to} decimals={r.dec} unit={r.u} /></dd>
              </div>
            ))}
          </dl>
        </motion.div>
      </div>
    </section>
  )
}

/* ═══════════════════════════ ХАРАКТЕРИСТИКИ (spec-sheet, не карточки) ══════ */
const SPECS = [
  ['Вход', 'JPG · серия снимков с телефона'],
  ['Движок', 'DUSt3R · CLIP · Ollama'],
  ['Выход', '3D-меш · облако точек · отчёт'],
  ['Форматы', 'GLB · PLY · PDF'],
  ['Просмотр', 'интерактивный 3D в браузере (Three.js)'],
  ['Загрузка', 'офлайн-очередь, отправка при появлении сети'],
  ['Точность', '± 1–2 % на типовых насыпях (пример)'],
]
function SpecSheet() {
  return (
    <section id="specs" className="kb-l-sec kb-l-specs">
      <div className="kb-l-sec__head">
        <h2 className="kb-l-h2">Характеристики</h2>
        <p className="kb-l-sec__lead">Инженерный конвейер целиком — от кадра до кубометра.</p>
      </div>
      <div className="kb-l-spectable">
        {SPECS.map(([k, v], i) => (
          <motion.div
            key={k}
            className="kb-l-specrow"
            initial={{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
            whileInView={{ opacity: 1, clipPath: 'inset(0 0% 0 0)' }}
            viewport={{ once: true, margin: '-8% 0px' }}
            transition={{ duration: 0.6, ease: EASE, delay: i * 0.06 }}
          >
            <span className="kb-l-specrow__k">{k}</span>
            <span className="kb-l-specrow__dots" aria-hidden="true" />
            <span className="kb-l-specrow__v">{v}</span>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

/* ═══════════════════════════ КИНО-МОМЕНТ (генерируемый ассет) ══════════════ */
function Cinematic() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], ['-8%', '8%'])
  const scale = useTransform(scrollYProgress, [0, 1], [1.12, 1])
  return (
    <section ref={ref} className="kb-l-cine">
      <motion.div className="kb-l-cine__img" style={{ y, scale }} aria-hidden="true" />
      <div className="kb-l-cine__veil" aria-hidden="true" />
      <ScanReveal className="kb-l-cine__copy">
        <h2 className="kb-l-cine__title">Прибор, который<br />помещается в кармане</h2>
        <p className="kb-l-cine__sub">
          Там, где нужна была бригада с тахеометром, теперь — серия фотографий и пара минут.
        </p>
      </ScanReveal>
    </section>
  )
}

/* ═══════════════════════════════ ФИНАЛ ═════════════════════════════════════ */
function FinalCta({ user }) {
  return (
    <section className="kb-l-final">
      <motion.div
        className="kb-l-final__panel lg-strong"
        initial={{ opacity: 0, y: 30, scale: 0.98 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={{ duration: 0.8, ease: EASE }}
      >
        <h2 className="kb-l-final__title">Начните измерять</h2>
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
        <Link to="/" className="kb-l-mark">
          <span className="kb-l-mark__icon"><Mark /></span>
          <span className="kb-l-mark__name">karelia<span className="kb-l-mark__slash">/</span>volume</span>
        </Link>
        <nav className="kb-l-foot__links">
          <Link to="/register">Регистрация</Link>
          <Link to="/login">Вход</Link>
          <Link to="/privacy">Конфиденциальность</Link>
          <button type="button" onClick={copyEmail}>yakov.kachalin@mail.ru</button>
        </nav>
      </div>
      <div className="kb-l-foot__bottom">
        <span>© 2026 Карелия Строй</span>
        <span className="kb-l-foot__coord">ПЕТРОЗАВОДСК · 61.79°N 34.35°E</span>
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
      <Pipeline />
      <Report />
      <SpecSheet />
      <Cinematic />
      <FinalCta user={user} />
      <Footer />
    </div>
  )
}
