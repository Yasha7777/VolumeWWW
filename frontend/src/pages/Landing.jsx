import { useEffect, useRef, useState } from 'react'
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
import CubesHero from '../components/CubesHero'
import '../landing.css'

/* ════════════════════════════════════════════════════════════════════════
   ЛЕНДИНГ (публичный, «/») — витрина сервиса для любого гостя интернета.
   Задача: премиум-вид «на десятки тысяч $», карельский вайб (лес/охра/камень),
   контурный мотив + «ебанутые» анимации. Реюзаем фирменную 3D-сцену сборки
   гравия (CubesHero) как hero, поверх — motion-анимации (параллакс, магнитные
   кнопки, tilt-карточки, счётчики, marquee, draw-in линии). CTA ведёт в сервис
   (/app для вошедших) или на регистрацию (/register для гостей).
   ════════════════════════════════════════════════════════════════════════ */

const EASE = [0.22, 1, 0.36, 1]

/* ── универсальный reveal-пресет (появление снизу при въезде в кадр) ──────── */
const rise = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-70px' },
  transition: { duration: 0.75, ease: EASE },
}

/* ── контейнер/слово для построчного «выката» заголовка ───────────────────── */
const wordsWrap = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
}
const wordItem = {
  hidden: { y: '115%' },
  show: { y: 0, transition: { duration: 0.9, ease: EASE } },
}

function Words({ text, className = '' }) {
  return (
    <motion.span
      className={className}
      variants={wordsWrap}
      initial="hidden"
      animate="show"
      style={{ display: 'inline-block' }}
    >
      {text.split(' ').map((w, i) => (
        <span key={i} className="kb-l-mask">
          <motion.span className="kb-l-word" variants={wordItem}>
            {w}&nbsp;
          </motion.span>
        </span>
      ))}
    </motion.span>
  )
}

/* ── магнитная кнопка: слегка тянется к курсору (десктоп) ──────────────────── */
function MagneticButton({ to, children, className = '', onClick }) {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 220, damping: 16 })
  const sy = useSpring(y, { stiffness: 220, damping: 16 })

  const onMove = (e) => {
    if (reduce || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    x.set((e.clientX - (r.left + r.width / 2)) * 0.35)
    y.set((e.clientY - (r.top + r.height / 2)) * 0.35)
  }
  const reset = () => { x.set(0); y.set(0) }

  const content = onClick
    ? <button type="button" className={className} onClick={onClick}>{children}</button>
    : <Link to={to} className={className}>{children}</Link>

  return (
    <motion.span
      ref={ref}
      className="kb-l-magnetic"
      style={{ x: sx, y: sy }}
      onMouseMove={onMove}
      onMouseLeave={reset}
    >
      {content}
    </motion.span>
  )
}

/* ── счётчик: докручивается от 0 при появлении в кадре ─────────────────────── */
function Counter({ to, suffix = '', prefix = '', decimals = 0, duration = 1.8 }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  useEffect(() => {
    if (!inView || !ref.current) return
    const node = ref.current
    const controls = animate(0, to, {
      duration,
      ease: EASE,
      onUpdate(v) {
        const num = decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('ru-RU')
        node.textContent = prefix + num + suffix
      },
    })
    return () => controls.stop()
  }, [inView, to, decimals, duration, prefix, suffix])
  return <span ref={ref}>{prefix}0{suffix}</span>
}

/* ── tilt-карточка: наклон к курсору + бликовое пятно за ним ───────────────── */
function TiltCard({ icon, title, text, index }) {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const rx = useMotionValue(0)
  const ry = useMotionValue(0)
  const srx = useSpring(rx, { stiffness: 160, damping: 15 })
  const sry = useSpring(ry, { stiffness: 160, damping: 15 })

  const onMove = (e) => {
    if (reduce || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    ry.set((px - 0.5) * 14)
    rx.set(-(py - 0.5) * 14)
    ref.current.style.setProperty('--gx', `${px * 100}%`)
    ref.current.style.setProperty('--gy', `${py * 100}%`)
  }
  const reset = () => { rx.set(0); ry.set(0) }

  return (
    <motion.div
      ref={ref}
      className="kb-l-feat"
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ rotateX: srx, rotateY: sry, transformPerspective: 900 }}
      initial={{ opacity: 0, y: 34 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, ease: EASE, delay: (index % 3) * 0.08 }}
    >
      <span className="kb-l-feat__glow" aria-hidden="true" />
      <span className="kb-l-feat__icon">{icon}</span>
      <h3 className="kb-l-feat__title">{title}</h3>
      <p className="kb-l-feat__text">{text}</p>
    </motion.div>
  )
}

/* ── контурные line-иконки (единый фирменный почерк) ──────────────────────── */
const I = {
  camera: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4h-5L7 7H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  ),
  cpu: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  ),
  file: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M9 13h6M9 17h6M9 9h1" />
    </svg>
  ),
  box: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  ),
  scale: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18M4 7h16M7 7l-3 7a3.5 3.5 0 0 0 6 0ZM17 7l-3 7a3.5 3.5 0 0 0 6 0ZM7 21h10" />
    </svg>
  ),
  wifi: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" />
      <circle cx="12" cy="19.5" r="1" />
      <path d="M2 8.8a15 15 0 0 1 20 0" />
    </svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
}

/* ════════════════════════ ВЕРХНЯЯ НАВИГАЦИЯ ═════════════════════════════════ */
function LandingNav({ user }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      className={`kb-l-nav${scrolled ? ' is-solid' : ''}`}
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.1 }}
    >
      <Link to="/" className="kb-l-brand">
        <span className="kb-l-brand__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </span>
        <span className="kb-l-brand__text">
          <span className="kb-l-brand__name">Карелия Строй</span>
          <span className="kb-l-brand__sub">AI Анализ Фото</span>
        </span>
      </Link>

      <nav className="kb-l-nav__links">
        {user ? (
          <MagneticButton to="/app" className="kb-l-btn kb-l-btn--solid">
            Перейти в сервис
          </MagneticButton>
        ) : (
          <>
            <Link to="/login" className="kb-l-btn kb-l-btn--ghost">Войти</Link>
            <MagneticButton to="/register" className="kb-l-btn kb-l-btn--solid">
              Начать
            </MagneticButton>
          </>
        )}
      </nav>
    </motion.header>
  )
}

/* ════════════════════════════════ HERO ═════════════════════════════════════ */
function Hero({ user }) {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start'],
  })
  const y = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -130])
  const opacity = useTransform(scrollYProgress, [0, 0.65], [1, 0])

  const primaryTo = user ? '/app' : '/register'
  const primaryLabel = user ? 'Перейти в сервис' : 'Начать бесплатно'

  return (
    <section ref={ref} className="kb-l-hero">
      {/* фирменная 3D-сцена сборки гравия (fixed-канвас, гаснет за первым экраном) */}
      <CubesHero />

      <motion.div className="kb-l-hero__inner" style={{ y, opacity }}>
        <motion.div
          className="kb-l-badge"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
        >
          <span className="kb-l-badge__dot" />
          AI · Фотограмметрия · Карелия
        </motion.div>

        <h1 className="kb-l-hero__title">
          <Words text="Объём и масса" />
          <em className="kb-l-hero__em">
            <Words text="из простых фотографий" />
          </em>
        </h1>

        <motion.p
          className="kb-l-hero__sub"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.7 }}
        >
          Загрузите серию снимков — нейросеть построит точную 3D-модель объекта,
          рассчитает объём, массу и подготовит PDF-отчёт. Карьеры, насыпи,
          материалы — измерение уровня, которого раньше не было.
        </motion.p>

        <motion.div
          className="kb-l-hero__cta"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.85 }}
        >
          <MagneticButton to={primaryTo} className="kb-l-btn kb-l-btn--hero">
            {primaryLabel}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </MagneticButton>
          {!user && (
            <Link to="/login" className="kb-l-btn kb-l-btn--line">
              У меня есть аккаунт
            </Link>
          )}
        </motion.div>
      </motion.div>

      <motion.div
        className="kb-l-scrollcue"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 1 }}
      >
        <span>Листайте вниз</span>
        <motion.span
          className="kb-l-scrollcue__line"
          animate={reduce ? {} : { scaleY: [0.2, 1, 0.2], originY: 0 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.div>
    </section>
  )
}

/* ═══════════════════════════════ MARQUEE ═══════════════════════════════════ */
const MARQUEE = [
  'ФОТОГРАММЕТРИЯ', 'ОБЪЁМ', 'МАССА', '3D-РЕКОНСТРУКЦИЯ', 'CLIP',
  'OLLAMA', 'DUSt3R', 'ОБЛАКО ТОЧЕК', 'PDF-РАСЧЁТ', 'КАРЕЛИЯ',
]
function Marquee() {
  const row = [...MARQUEE, ...MARQUEE]
  return (
    <div className="kb-l-marquee" aria-hidden="true">
      <div className="kb-l-marquee__track">
        {row.map((t, i) => (
          <span key={i} className="kb-l-marquee__item">
            {t}<span className="kb-l-marquee__dot">◆</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ════════════════════════════════ STATS ════════════════════════════════════ */
const STATS = [
  { to: 99.2, decimals: 1, suffix: '%', label: 'точность реконструкции' },
  { to: 3, prefix: '< ', suffix: ' мин', label: 'на полный анализ' },
  { to: 10000, suffix: '+', label: 'снимков обработано' },
  { to: 24, suffix: '/7', label: 'офлайн-очередь загрузок' },
]
function Stats() {
  return (
    <section className="kb-l-stats">
      <div className="kb-l-stats__grid">
        {STATS.map((s, i) => (
          <motion.div
            key={i}
            className="kb-l-stat"
            {...rise}
            transition={{ ...rise.transition, delay: i * 0.08 }}
          >
            <div className="kb-l-stat__num">
              <Counter to={s.to} decimals={s.decimals} suffix={s.suffix} prefix={s.prefix} />
            </div>
            <div className="kb-l-stat__label">{s.label}</div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

/* ═════════════════════════════ КАК ЭТО РАБОТАЕТ ════════════════════════════ */
const STEPS = [
  { icon: I.camera, n: '01', title: 'Сделайте снимки', text: 'Обойдите объект с телефоном и снимите серию кадров со всех сторон. Никакого спецоборудования.' },
  { icon: I.cpu, n: '02', title: 'AI строит модель', text: 'Пайплайн CLIP + Ollama + DUSt3R собирает облако точек, восстанавливает 3D-меш и вычисляет объём и массу.' },
  { icon: I.file, n: '03', title: 'Получите отчёт', text: 'Интерактивная 3D-модель, точные замеры и готовый PDF-расчёт — за минуты, а не за дни полевых работ.' },
]
function HowItWorks() {
  const ref = useRef(null)
  const lineInView = useInView(ref, { once: true, margin: '-120px' })
  return (
    <section className="kb-l-how" ref={ref}>
      <motion.div className="kb-l-section-head" {...rise}>
        <span className="kb-l-eyebrow">Процесс</span>
        <h2 className="kb-l-h2">Три шага до точного объёма</h2>
      </motion.div>

      <div className="kb-l-steps">
        {/* линия-соединитель, «прорисовывается» при въезде секции в кадр */}
        <motion.span
          className="kb-l-steps__line"
          initial={{ scaleX: 0 }}
          animate={lineInView ? { scaleX: 1 } : {}}
          transition={{ duration: 1.1, ease: EASE, delay: 0.2 }}
        />
        {STEPS.map((s, i) => (
          <motion.div
            key={i}
            className="kb-l-step"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.15 + i * 0.15 }}
          >
            <span className="kb-l-step__n">{s.n}</span>
            <span className="kb-l-step__icon">{s.icon}</span>
            <h3 className="kb-l-step__title">{s.title}</h3>
            <p className="kb-l-step__text">{s.text}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

/* ══════════════════════════════ ВОЗМОЖНОСТИ ════════════════════════════════ */
const FEATURES = [
  { icon: I.box, title: '3D-реконструкция', text: 'Плотное облако точек и полигональный меш из обычных фото — движок DUSt3R.' },
  { icon: I.scale, title: 'Объём и масса', text: 'Автоматический расчёт объёма насыпи и массы по плотности материала.' },
  { icon: I.file, title: 'PDF-отчёты', text: 'Готовый расчётный документ с формулами, замерами и визуализацией — в один клик.' },
  { icon: I.wifi, title: 'Офлайн-очередь', text: 'Снимки уходят на сервер сами, как появится сеть. PWA-очередь на IndexedDB.' },
  { icon: I.layers, title: 'Интерактивный вьювер', text: 'Вращайте модель, меряйте, смотрите облако точек прямо в браузере на Three.js.' },
  { icon: I.shield, title: 'Данные под защитой', text: 'Хранение в Supabase, приватные ссылки, полное соответствие политике конфиденциальности.' },
]
function Features() {
  return (
    <section className="kb-l-features">
      <motion.div className="kb-l-section-head" {...rise}>
        <span className="kb-l-eyebrow">Возможности</span>
        <h2 className="kb-l-h2">Инструмент промышленного уровня</h2>
      </motion.div>
      <div className="kb-l-feat-grid">
        {FEATURES.map((f, i) => (
          <TiltCard key={i} index={i} icon={f.icon} title={f.title} text={f.text} />
        ))}
      </div>
    </section>
  )
}

/* ═══════════════════════════════ ПОКАЗ / ЦИТАТА ════════════════════════════ */
function Showcase() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const yA = useTransform(scrollYProgress, [0, 1], [80, -80])
  const rot = useTransform(scrollYProgress, [0, 1], [-8, 8])
  return (
    <section className="kb-l-showcase" ref={ref}>
      <motion.div className="kb-l-showcase__rings" style={{ y: yA, rotate: rot }} aria-hidden="true">
        <svg viewBox="0 0 520 520" width="520" height="520">
          <g fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M260 165c58 0 100 38 100 92s-46 84-100 84-100-34-100-84 42-92 100-92z" />
            <path d="M262 125c88 0 152 56 152 138s-70 128-154 128-150-50-150-130 64-136 152-136z" />
            <path d="M258 82c118 0 205 74 205 182s-92 174-206 174S52 356 52 250 140 82 258 82z" />
          </g>
        </svg>
      </motion.div>
      <motion.blockquote className="kb-l-showcase__quote" {...rise}>
        <span className="kb-l-eyebrow kb-l-eyebrow--gold">Технология доверия</span>
        <p>
          Мы превращаем&nbsp;<em>телефон в измерительный комплекс</em>. Там, где
          раньше нужна была бригада с тахеометром, теперь достаточно нескольких
          снимков и минуты ожидания.
        </p>
      </motion.blockquote>
    </section>
  )
}

/* ═══════════════════════════════ ФИНАЛЬНЫЙ CTA ═════════════════════════════ */
function FinalCTA({ user }) {
  const primaryTo = user ? '/app' : '/register'
  const primaryLabel = user ? 'Открыть сервис' : 'Создать аккаунт'
  return (
    <section className="kb-l-final">
      <motion.div className="kb-l-final__inner" {...rise}>
        <h2 className="kb-l-final__title">
          Готовы увидеть<br /><em>объём иначе?</em>
        </h2>
        <p className="kb-l-final__sub">
          Регистрация — минута. Первый анализ — бесплатно.
        </p>
        <div className="kb-l-final__cta">
          <MagneticButton to={primaryTo} className="kb-l-btn kb-l-btn--hero">
            {primaryLabel}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </MagneticButton>
          {!user && (
            <Link to="/login" className="kb-l-btn kb-l-btn--line kb-l-btn--line-light">
              Войти
            </Link>
          )}
        </div>
      </motion.div>
    </section>
  )
}

/* ═══════════════════════════════ ПОДВАЛ ════════════════════════════════════ */
function LandingFooter() {
  const copyEmail = () => {
    navigator.clipboard?.writeText('yakov.kachalin@mail.ru')
    alert('Email скопирован: yakov.kachalin@mail.ru')
  }
  return (
    <footer className="kb-l-footer">
      <div className="kb-l-footer__top">
        <Link to="/" className="kb-l-brand">
          <span className="kb-l-brand__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </span>
          <span className="kb-l-brand__text">
            <span className="kb-l-brand__name">Карелия Строй</span>
            <span className="kb-l-brand__sub">AI Анализ Фото</span>
          </span>
        </Link>
        <nav className="kb-l-footer__links">
          <Link to="/register">Регистрация</Link>
          <Link to="/login">Вход</Link>
          <Link to="/privacy">Конфиденциальность</Link>
          <button type="button" onClick={copyEmail}>yakov.kachalin@mail.ru</button>
        </nav>
      </div>
      <div className="kb-l-footer__bottom">
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
      <LandingNav user={user} />
      <Hero user={user} />
      <Marquee />
      <Stats />
      <HowItWorks />
      <Features />
      <Showcase />
      <FinalCTA user={user} />
      <LandingFooter />
    </div>
  )
}
