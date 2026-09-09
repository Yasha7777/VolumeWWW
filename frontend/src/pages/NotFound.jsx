import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useMotionTemplate,
  useReducedMotion,
} from 'motion/react'
import { ArrowLeft, Ruler, House } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import cheremsha from './cheremsha.webp'
import '../notfound.css'

/*
  ─────────────────────────────────────────────────────────────────────────
  404 · «УТРАЧЕННЫЙ КАДР»

  Страница — один кадр 35-мм плёнки из архива. Отсюда перфорация, краевой
  код и штамп: фактура держится на предмете, а не на настроении. Текст —
  прежняя «Черемша», её никто не трогал: это и есть содержание страницы.

  Мир — тёмный мир лендинга (Cormorant + Onest, охра/лес), см. notfound.css.

  ДВИЖЕНИЕ (skill apple-design):
  • Пружины вместо длительностей. Параметры заданы через физику и
    пересчитаны в «damping ratio / response» Apple — комментарии у констант.
  • Наклон и блик — ОТВЕТ на курсор, 1:1, прерываемые: useSpring всегда
    едет от текущего экранного значения, поэтому курсор можно развернуть
    на полпути без скачка.
  • Единственный «поставленный» момент — приземление штампа с перелётом
    (damping ~0.8): импульс у жеста есть, значит перелёт заслужен. Всё
    остальное критически задемпфировано (damping 1.0), без отскока.
  • Никаких фоновых петель: у прежней версии моргала цифра (резкий скачок
    яркости) и пульсировали глаза раз в 5 с (~0.2 Гц) — ровно то, что
    раздел про reduced-motion велит не делать.
  • prefers-reduced-motion → вход становится кроссфейдом, наклон/блик
    отключаются целиком (не «слабее», а совсем).
  ─────────────────────────────────────────────────────────────────────────
*/

/* Наклон плёнки за курсором: damping ratio ≈ 0.98, response ≈ 0.46 с.
   Apple для «move/reposition» даёт 1.0 / 0.4 — то же самое. */
const TILT = { stiffness: 190, damping: 27, mass: 1 }

/* Материализация при входе: критически задемпфировано, response ≈ 0.55 с. */
const ENTER = { type: 'spring', stiffness: 130, damping: 23, mass: 1 }

/* Штамп: damping ratio ≈ 0.81, response ≈ 0.36 с — перелёт есть, но один. */
const STAMP = { type: 'spring', stiffness: 300, damping: 28, mass: 1 }

const MAX_TILT_Y = 7      /* градусы по вертикальной оси */
const MAX_TILT_X = 5.5

const FACTS = [
  'Черемшу замуровывали в стены хрущёвок живьём — голова снаружи, мурлыкала по вечерам',
  'Уши работали как антенна радио «Маяк». Тело — как приёмник',
  'С 1965 по 1967 г. была генеральным секретарём ЦК КПСС. Указы подписывала пушистой лапой',
  'В 1991-м каждую конфисковали, спрятали в шлакоблок, увезли под 4-й энергоблок ЧАЭС',
  'Выжившие до сих пор мурчат на антресолях заброшенных хрущёвок',
]

const TICKER =
  'В СССР СТРАНИЦ НЕ БЫЛО · ЧЕРЕМША ЗАМЕНЯЛА ВСЁ · СТЕКЛОВАТА · ГУТАЛИН · ' +
  'НИИ ПЕРСПЕКТИВНОГО УТЕПЛЕНИЯ · ШЛАКОБЛОК · ПРИПЯТЬ · ТИХО НЕ СПЕША · ' +
  'ЧЕРЕМША · БЕЗ СУЕТЫ · БЕЗ МОНТАЖА · БЕЗ ЭПАТАЖА · ЧЕРЕМША · '

/* Метка пункта справки — та же геометрия, что у дырки перфорации слева.
   Один мотив на две колонки; нарисована, а не набрана юникодом. */
const Sprocket = () => (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <rect x="0.75" y="4.25" width="12.5" height="5.5" rx="1.75"
      stroke="currentColor" strokeWidth="1.25" />
  </svg>
)

export default function NotFound() {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const reduce = useReducedMotion()
  const reelRef = useRef(null)

  /* Наклон включаем только для точного указателя: на тачскрине «следования
     за курсором» не существует, а лишний слушатель и will-change — да. */
  const [fine, setFine] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(pointer: fine)')
    const sync = () => setFine(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const prev = document.title
    document.title = '404 · страница утеряна — Карелия Строй'
    return () => { document.title = prev }
  }, [])

  const live = fine && !reduce

  /* Нормированная позиция курсора внутри катушки: −0.5…0.5 по каждой оси. */
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const sx = useSpring(px, TILT)
  const sy = useSpring(py, TILT)

  /* Курсор справа → правый край едет НА зрителя (rotateY отрицательный).
     Курсор снизу → нижний край на зрителя (в CSS ось Y смотрит вниз,
     поэтому здесь знак положительный). */
  const rotateY = useTransform(sx, [-0.5, 0.5], [MAX_TILT_Y, -MAX_TILT_Y])
  const rotateX = useTransform(sy, [-0.5, 0.5], [-MAX_TILT_X, MAX_TILT_X])

  /* Снимок сдвигается против наклона — внутри кадра появляется глубина. */
  const photoX = useTransform(sx, [-0.5, 0.5], [11, -11])
  const photoY = useTransform(sy, [-0.5, 0.5], [8, -8])

  /* Блик стоит там, где курсор: направление света совпадает с рукой. */
  const glarePctX = useTransform(sx, [-0.5, 0.5], [14, 86])
  const glarePctY = useTransform(sy, [-0.5, 0.5], [16, 84])
  const glareX = useMotionTemplate`${glarePctX}%`
  const glareY = useMotionTemplate`${glarePctY}%`

  const track = (e) => {
    if (!live) return
    const r = reelRef.current?.getBoundingClientRect()
    if (!r) return
    px.set((e.clientX - r.left) / r.width - 0.5)
    py.set((e.clientY - r.top) / r.height - 0.5)
  }
  const release = () => { px.set(0); py.set(0) }

  const enter = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.25, ease: 'easeOut' } }
    : { initial: { opacity: 0, y: 26, scale: 0.965 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: ENTER }

  /* Ступенчатый вход правой колонки: один и тот же шаг, без «своей» кривой
     у каждого блока. */
  const step = (i) => (reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.25, delay: 0.04 * i } }
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { ...ENTER, delay: 0.06 + 0.05 * i } })

  return (
    <div className="kb-404">
      <div className="kb-404__orb kb-404__orb--gold" aria-hidden="true" />
      <div className="kb-404__orb kb-404__orb--green" aria-hidden="true" />
      <div className="kb-404__vign" aria-hidden="true" />
      <div className="kb-404__grain" aria-hidden="true" />

      <Link to="/" className="kb-404__mark">
        <House strokeWidth={1.75} aria-hidden="true" />
        <span className="kb-404__mark-txt">
          <b>Карелия Строй</b>
          <span>AI · объём и масса</span>
        </span>
      </Link>

      <main className="kb-404__in">

        {/* ═══ КАТУШКА ═══════════════════════════════════════════════════ */}
        <div
          className="kb-404__reel"
          ref={reelRef}
          onPointerMove={track}
          onPointerLeave={release}
        >
          <motion.div className="kb-404__strip" {...enter} style={live ? { rotateX, rotateY } : undefined}>
            <div className="kb-404__perf" aria-hidden="true" />

            <div className="kb-404__frame">
              <motion.div
                className="kb-404__photowrap"
                style={live ? { x: photoX, y: photoY, scale: 1.05 } : { scale: 1.05 }}
                initial={reduce ? false : { filter: 'blur(16px)' }}
                animate={reduce ? undefined : { filter: 'blur(0px)' }}
                transition={{ ...ENTER, delay: 0.05 }}
              >
                <img className="kb-404__photo" src={cheremsha} width="1194" height="794"
                  alt="Архивный снимок черемши: пушистое существо с кошачьей мордой и заячьими ушами" />
              </motion.div>

              <div className="kb-404__grade--warm" aria-hidden="true" />
              <div className="kb-404__grade--dark" aria-hidden="true" />
              {live && (
                <motion.div className="kb-404__glare" aria-hidden="true"
                  style={{ '--gx': glareX, '--gy': glareY }} />
              )}

              <div className="kb-404__plate">
                <i aria-hidden="true" />
                Кадр 404 · негатив утрачен
              </div>
            </div>

            <div className="kb-404__perf" aria-hidden="true" />

            <div className="kb-404__edge">KS-404 · 24A · ЭКСП. 1962</div>

            {/* Штамп висит НАД плёнкой (translateZ), поэтому при наклоне
                отходит от неё — это и читается как «приложен сверху». */}
            <motion.div
              className="kb-404__stamp"
              style={{ z: 34 }}
              /* Наклон −7° остаётся и в reduced-motion: это не движение, а
                 форма предмета — прямой штамп перестаёт читаться как штамп.
                 Гасится именно ДВИЖЕНИЕ (налёт с перелётом), а не поворот. */
              initial={reduce ? { opacity: 0, rotate: -7 } : { opacity: 0, scale: 1.9, rotate: -24 }}
              animate={reduce ? { opacity: 1, rotate: -7 } : { opacity: 1, scale: 1, rotate: -7 }}
              transition={reduce ? { duration: 0.25, delay: 0.3 } : { ...STAMP, delay: 0.55 }}
            >
              <b>Сов. секретно</b>
              <em>фонд №404 · хранить вечно</em>
            </motion.div>
          </motion.div>
        </div>

        {/* ═══ ДЕЛО ══════════════════════════════════════════════════════ */}
        <div className="kb-404__doc">

          <motion.h1 className="kb-404__title" {...step(0)}>
            <span className="kb-404__num">404</span>
            <span className="kb-404__said">Страница утеряна при невыясненных обстоятельствах</span>
          </motion.h1>

          <motion.p className="kb-404__lede" {...step(1)}>
            В советском союзе страниц не было. Была только <b>Черемша</b>.
            Тихо. Не спеша. Без лишней суеты. Страница, которую вы ищете,{' '}
            <b>замурована в шлакоблок</b> и вывезена в Припять.
          </motion.p>

          {/* Выход стоит СРАЗУ после объяснения, до баек. На 404 главное
              действие не имеет права уезжать под сгиб — а справка со стихом
              вместе дают ~330 px и как раз туда его и утаскивали. */}
          <motion.div className="kb-404__acts" {...step(2)}>
            {/* whileTap у motion срабатывает по pointer-DOWN, а не по клику:
                отклик появляется в момент нажатия, как и требует п.1 скилла. */}
            <motion.div className="kb-404__act"
              whileTap={reduce ? undefined : { scale: 0.97 }} transition={{ duration: 0.1 }}>
              <Link to="/" className="kb-404__btn kb-404__btn--solid">
                <ArrowLeft strokeWidth={2} aria-hidden="true" />
                Вернуться. Тихо. Не спеша.
              </Link>
            </motion.div>
            <motion.div className="kb-404__act"
              whileTap={reduce ? undefined : { scale: 0.97 }} transition={{ duration: 0.1 }}>
              <Link to={user ? '/app' : '/login'} className="kb-404__btn kb-404__btn--ghost">
                <Ruler strokeWidth={2} aria-hidden="true" />
                {user ? 'К замерам' : 'Войти'}
              </Link>
            </motion.div>
          </motion.div>

          <motion.section className="kb-404__ref" {...step(3)}>
            <h2 className="kb-404__ref-head">Справка · НИИ «Институт перспективного утепления» · 1962</h2>
            <ul>
              {FACTS.map((f) => (
                <li key={f}><Sprocket />{f}</li>
              ))}
            </ul>
          </motion.section>

          <motion.p className="kb-404__verse" {...step(4)}>
            тихо, не спеша, не дыша —<br />
            ни шиша, ни коврижа —<br />
            без монтажа, без витража —<br />
            эта страница была. Черемша.
          </motion.p>

          <motion.p className="kb-404__case" {...step(5)}>
            <b>Дело №</b> {pathname}
          </motion.p>
        </div>
      </main>

      {/* Бегущая строка: дорожка продублирована ровно дважды и едет на −50% —
          шов не виден, ключевых кадров ровно два. Останавливается по hover. */}
      <div className="kb-404__ticker" aria-hidden="true">
        <div className="kb-404__track">
          <span>{TICKER}</span>
          <span>{TICKER}</span>
        </div>
      </div>
    </div>
  )
}
