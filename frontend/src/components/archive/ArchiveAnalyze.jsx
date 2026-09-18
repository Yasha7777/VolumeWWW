import { useEffect, useMemo, useRef, useState } from 'react'
import PlyViewer from '../PlyViewer'
import ViewerErrorBoundary from '../ViewerErrorBoundary'
import { DiagnosticsBlock } from '../Diagnostics'
import CubeSettings from '../CubeSettings'
import Win from './Win'
import Barcode from './Barcode'
import CalibCube from './CalibCube'
import ArcPlate, { ART } from './ArcPlate'
import { MACHINE } from './ArchiveChrome'
import { EV, onArchive, revealEl } from './bus'
import { analysisNo, cubeResolved, extraMetrics, splitMaterial, DASH } from './archiveData'

/* ============================================================
   ArchiveAnalyze — экран 01 АНАЛИЗ в теме «Архив».
   ------------------------------------------------------------
   ЧИСТО СЛОЙ ПРЕДСТАВЛЕНИЯ. Вся логика (подготовка файлов,
   очередь, отправка, поллинг) осталась в pages/Analyze.jsx и
   приезжает сюда пропсами — здесь нет ни одного вызова api,
   ни одного setState, который что-то отправляет.

   Где тема расходится с макетом — расхождение намеренное и
   подписано в комментарии по месту. Общее правило одно:
   цифру, которой у приложения нет, рисуем прочерком, а не
   правдоподобным числом.
   ============================================================ */

const MAX_PHOTOS = 100

const STAGES = [
  'ЗАГРУЗКА СНИМКОВ',
  'ЧТЕНИЕ МЕТАДАННЫХ',
  'ПОИСК КАЛИБРОВОЧНОГО КУБА',
  'ОЦЕНКА КАМЕР',
  'ПОСТРОЕНИЕ ГЕОМЕТРИИ',
  'ОТДЕЛЕНИЕ ГРУНТА',
  'РАСЧЁТ ОБЪЁМА',
  'КЛАССИФИКАЦИЯ',
]

const REQUIREMENTS = [
  'ХОРОШЕЕ ОСВЕЩЕНИЕ',
  'ОБЪЕКТ ЦЕЛИКОМ В КАДРЕ',
  'КАЛИБРОВОЧНЫЙ КУБ В КАДРЕ',
  'ЧЁТКИЙ ФОКУС, БЕЗ СМАЗА',
]

const pad2 = (n) => String(n).padStart(2, '0')
const mb = (kb) => (kb > 1024 ? `${(kb / 1024).toFixed(1)} МБ` : `${kb} КБ`)

/* фокусное расстояние из EXIF — именно оно решает масштаб,
   поэтому в «ПРОВЕРКЕ ПАРТИИ» это отдельная строка */
const focalOf = (p) => {
  const ex = p?.exifData
  if (!ex) return null
  const f = ex.FocalLength ?? ex.focalLength ?? ex.FocalLengthIn35mmFormat
  const n = Number(f)
  return Number.isFinite(n) && n > 0 ? n : null
}

/* Координаты из EXIF. Разбор идёт через exifr, и у него в зависимости
   от камеры и набора опций координаты приезжают то готовыми числами
   `latitude/longitude`, то сырыми тегами `GPSLatitude` (массив
   градусы/минуты/секунды) с полушарием в `GPSLatitudeRef`. Раньше
   здесь проверялось только `latitude` — и на пачке, где exifr отдал
   сырые теги, счётчик честно писал «ГЕОМЕТКИ 0/32» при живых
   геометках на каждом кадре. Понимаем оба вида. */
const dmsToDeg = (v, ref) => {
  let deg = null
  if (Array.isArray(v)) {
    const [d = 0, m = 0, s = 0] = v.map(Number)
    if (Number.isFinite(d)) deg = Math.abs(d) + (m || 0) / 60 + (s || 0) / 3600
  } else if (Number.isFinite(Number(v))) {
    deg = Math.abs(Number(v))
  }
  if (deg == null) return null
  const neg = typeof ref === 'string' && /^[SW]/i.test(ref.trim())
  return neg ? -deg : deg
}

export const geoOf = (p) => {
  const ex = p?.exifData
  if (!ex) return null
  const lat = Number.isFinite(Number(ex.latitude))
    ? Number(ex.latitude)
    : dmsToDeg(ex.GPSLatitude ?? ex.gps?.latitude, ex.GPSLatitudeRef)
  const lon = Number.isFinite(Number(ex.longitude))
    ? Number(ex.longitude)
    : dmsToDeg(ex.GPSLongitude ?? ex.gps?.longitude, ex.GPSLongitudeRef)
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  // 0,0 — это «Остров Ноль» в Гвинейском заливе: у камеры так выглядит
  // ненайденный фикс, а не съёмка в Атлантике.
  if (lat === 0 && lon === 0) return null
  return [lat, lon]
}

/* ── секундомер расчёта ──────────────────────────────────────────
   Общий components/Timer сюда не годится: он подписывает этапы
   латиницей («CLIP строит эмбеддинги…», «AI анализирует…»), а в
   этой теме латиница запрещена целиком. Показываем то, что знаем
   точно, — сколько идёт расчёт. */
function ArcTimer({ startTime }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const s = Math.max(0, Math.floor((now - startTime) / 1000))
  const clock = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map(pad2).join(':')
  return (
    <div className="arc-timer">
      <span>ВРЕМЯ РАСЧЁТА</span>
      <b>{clock}</b>
      <i>ПРЕДЕЛ 60:00</i>
    </div>
  )
}

/* ── строка состояния ─────────────────────────────────────────
   Три ячейки: снимки, метаданные, состояние. Ячейка калибровочного
   куба отсюда убрана — до ответа пайплайна сказать про куб нечего,
   и строка вечно висела с «ПО РАСЧЁТУ». Куб остался там, где он
   проверяем: в «ПРОВЕРКЕ ПАРТИИ» и в досье результата. */
function StateStrip({ photos, withExif, phase }) {
  return (
    <div className="arc-state">
      <div className="arc-state__cell">
        <span className="arc-state__k">СНИМКИ</span>
        <span className="arc-state__v">{pad2(photos)}</span>
      </div>
      <div className="arc-state__cell">
        <span className="arc-state__k">МЕТАДАННЫЕ</span>
        <span className={`arc-state__v${photos && withExif < photos ? ' is-bad' : ''}`}>
          {!photos ? DASH : withExif === photos ? '✓ ЕСТЬ' : `${photos - withExif} НЕТ`}
        </span>
      </div>
      <div className="arc-state__cell arc-state__cell--final">
        <span className="arc-state__k">СОСТОЯНИЕ</span>
        <span className="arc-state__v">
          {phase}
          <i className="arc-caret" aria-hidden="true">_</i>
        </span>
      </div>
    </div>
  )
}

/* ── диалог «проверка партии» ────────────────────────────────── */
function BatchDialog({ text, hint, onNext, onStop }) {
  return (
    <div className="arc-dlg" role="alertdialog" aria-label="ПРОВЕРКА ПАРТИИ">
      <div className="arc-dlg__hd">
        <span>ПРОВЕРКА_ПАРТИИ</span>
        <span className="arc-dlg__x" aria-hidden="true">[×]</span>
      </div>
      <div className="arc-dlg__body">
        <span className="arc-dlg__bang" aria-hidden="true">!</span>
        <p className="arc-dlg__txt">{text}</p>
      </div>
      {hint && <p className="arc-dlg__hint">{hint}</p>}
      <div className="arc-dlg__btns">
        <button type="button" className="arc-btn arc-btn--chip" onClick={onNext}>ДАЛЕЕ</button>
        <button type="button" className="arc-btn arc-btn--chip" onClick={onStop}>СТОП</button>
      </div>
    </div>
  )
}

/* ── журнал ВОССТАНОВЛЕНИЕ_ГЕОМЕТРИИ.ПРГ ─────────────────────── */
function Journal({ busy, finished, upProg }) {
  /* Состояния этапов выводятся из РЕАЛЬНОЙ работы:
     [01] — настоящие проценты отправки (XHR upload.onprogress),
     [02] — метаданные читаются на клиенте до отправки, значит к
            моменту ухода байтов они уже прочитаны,
     [03]–[08] — считает сервер, и он НЕ транслирует этапы. Поэтому
            здесь «РАБОТА» и полосатая неопределённая полоса, а не
            выдуманные проценты: полоса, уезжающая вперёд работы,
            уже ломала доверие к этой странице (см. CLAUDE.md). */
  const value = (i) => {
    if (finished) return { text: 'ДА', kind: 'ok' }
    if (!busy) return { text: 'ЖДЁТ', kind: 'wait' }
    if (i === 0) {
      if (upProg?.phase === 'upload') return { text: `${upProg.pct}%`, kind: 'run' }
      return { text: 'ДА', kind: 'ok' }
    }
    if (i === 1) {
      if (upProg?.phase === 'upload') return { text: 'ЖДЁТ', kind: 'wait' }
      return { text: 'ДА', kind: 'ok' }
    }
    if (upProg) return { text: 'ЖДЁТ', kind: 'wait' }
    return { text: 'РАБОТА', kind: 'run' }
  }

  return (
    <Win name="ВОССТАНОВЛЕНИЕ_ГЕОМЕТРИИ.ПРГ" dark className="arc-win--log">
      <div className="arc-log">
        <ol className="arc-log__rows">
          {STAGES.map((s, i) => {
            const v = value(i)
            return (
              <li key={s} className={`arc-log__row is-${v.kind}`}>
                <span className="arc-log__n">[{pad2(i + 1)}]</span>
                <span className="arc-log__name">{s}</span>
                <span className="arc-log__dots" aria-hidden="true" />
                <span className="arc-log__val">{v.text}</span>
              </li>
            )
          })}
        </ol>

        <aside className="arc-log__side">
          <div className="arc-log__ttl">ВЫЧИСЛИТЕЛЬНЫЙ УЗЕЛ</div>
          <div className="arc-log__line">ВИДЕОКАРТА {MACHINE.gpu}</div>
          <div className="arc-log__line">ПАМЯТЬ {MACHINE.ramGb} ГБ</div>

          <div className="arc-log__ttl">КОНВЕЙЕР</div>
          <div className="arc-log__line">ГЕОМЕТРИЯ → ГРУНТ → ОБЪЁМ</div>
          <div className="arc-log__line">МОДЕЛЬ МАТЕРИАЛА · НЕЙРО-1.6</div>

          <div className={`arc-log__bar${finished ? '' : ' is-run'}`}>
            <span style={finished ? { width: '100%' } : undefined} />
          </div>
          <div className="arc-log__line arc-log__done">
            {finished
              ? 'ВЫПОЛНЕНО 100%'
              : busy
                ? 'ЭТАП НЕ ТРАНСЛИРУЕТСЯ · ЖДЁМ ОТВЕТ УЗЛА'
                : 'УЗЕЛ СВОБОДЕН'}
          </div>
        </aside>
      </div>
    </Win>
  )
}

/* ── досье результата ────────────────────────────────────────── */
function Dossier({
  parsed, result, title, docNo, photos, plyUrl, glbUrl, upVec, upGlbVec, diag, onReport,
}) {
  const extra = useMemo(() => extraMetrics(result), [result])
  const mat   = useMemo(() => splitMaterial(parsed?.material), [parsed?.material])
  const has3d = !!(plyUrl || glbUrl)

  const stamp = new Date().toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).replace(',', ' /')

  const row = (k, v, cls = '') => (
    <div className="arc-dos__row">
      <span>{k}</span>
      <b className={cls}>{v ?? DASH}</b>
    </div>
  )

  return (
    <section className="arc-dos">
      <div className="arc-dos__hd">
        <span>РЕЗУЛЬТАТ_АНАЛИЗА / ОБЪЕКТ {(title || 'БЕЗ НАЗВАНИЯ').toUpperCase()}</span>
        <span className="arc-dos__stamp">{stamp}</span>
      </div>

      <div className="arc-dos__grid">
        {/* ── объём ── */}
        <div className="arc-dos__col">
          <div className="arc-dos__k">ИЗМЕРЕННЫЙ ОБЪЁМ</div>
          <div className="arc-dos__big">{parsed?.volume ?? DASH}</div>
          <div className="arc-dos__unit">м³</div>
          <div className="arc-dos__rows">
            {row('ПЛОЩАДЬ ОСНОВАНИЯ', extra.baseArea != null ? `${extra.baseArea.toFixed(1)} м²` : null)}
            {row('ВЫСОТА', extra.height != null ? `${extra.height.toFixed(2)} м` : null)}
            {row('Д · Ш · В', extra.dims ? extra.dims.map((n) => n.toFixed(2)).join(' · ') : null)}
          </div>
        </div>

        {/* ── масса ── */}
        <div className="arc-dos__col">
          <div className="arc-dos__k">ОЦЕНКА МАССЫ</div>
          <div className="arc-dos__big arc-dos__big--green">{parsed?.mass ?? DASH}</div>
          <div className="arc-dos__unit">т</div>
          <div className="arc-dos__rows">
            {row('МАТЕРИАЛ', mat.name ? mat.name.toUpperCase() : null)}
            {row('ФРАКЦИЯ', mat.fraction)}
            {row('ПЛОТНОСТЬ', parsed?.density ? `${parsed.density} кг/м³` : null)}
            {row('ДОСТОВЕРНОСТЬ', extra.confidence != null ? extra.confidence.toFixed(2) : null, 'arc-blue')}
          </div>
        </div>

        {/* ── восстановленная геометрия ── */}
        <div className="arc-dos__view">
          <div className="arc-dos__viewhd">ВОССТАНОВЛЕННАЯ ГЕОМЕТРИЯ</div>

          <div className="arc-blueprint">
            {has3d ? (
              <ViewerErrorBoundary>
                <PlyViewer plyUrl={plyUrl} glbUrl={glbUrl} up={upVec} upGlb={upGlbVec} />
              </ViewerErrorBoundary>
            ) : (
              <ArcPlate kind="mesh" src={ART.mesh} caption="ОБЛАКО ТОЧЕК / ТРЁХМЕРНАЯ МОДЕЛЬ" />
            )}
            <span className="arc-blueprint__tag">[ВРАЩАТЬ]</span>
            <span className="arc-blueprint__grid">СЕТКА 22 ММ</span>
          </div>

          <div className="arc-dos__rows arc-dos__rows--tight">
            {row('СНИМКОВ', `${pad2(parsed?.framesUsed ?? photos.length)} / ${pad2(photos.length)}`)}
            {row('КАЛИБРОВОЧНЫЙ КУБ', parsed?._volumeNum != null ? '01 ✓' : null)}
            {row(
              'ИНТЕРВАЛ 95 %',
              extra.interval ? `${extra.interval[0].toFixed(1)} — ${extra.interval[1].toFixed(1)} т` : null,
              'arc-amber',
            )}
            {row('НОМЕР АНАЛИЗА', docNo, 'arc-amber')}
          </div>

          <Barcode caption={docNo ? `${docNo} · 2026` : 'КОД ХРАНИЛИЩА · 88 БИТ'} />

          <button type="button" className="arc-btn arc-btn--chip arc-dos__report" onClick={onReport}>
            ОТКРЫТЬ ОТЧЁТ
          </button>
        </div>
      </div>

      <div className="arc-ticker" aria-hidden="true">
        <div className="arc-ticker__run">
          {Array.from({ length: 2 }, (_, k) => (
            <span key={k}>
              ████ СКАН ЗАВЕРШЁН ████ ОБЪЁМ РАССЧИТАН ████ МАССА ОЦЕНЕНА ████ ОТЧЁТ ГОТОВ&nbsp;
            </span>
          ))}
        </div>
      </div>

      {diag && (
        <div className="arc-dos__diag">
          <DiagnosticsBlock diag={diag} />
        </div>
      )}
    </section>
  )
}

/* ============================================================
   ГЛАВНЫЙ КОМПОНЕНТ
   ============================================================ */
export default function ArchiveAnalyze({
  photos, fileInputRef, handleFiles, onDrop, removePhoto,
  title, setTitle, notes, setNotes,
  isProd, setIsProd,
  busy, compressing, compProg, compMsg, upProg, status, online,
  runAnalysis, addToQueue, reset, openReport,
  result, parsed, plyUrl, glbUrl, upVec, upGlbVec, diag,
  startTime, analysisId,
  onCubeChange, cubeSpec,
  sizeStr,
}) {
  const [cubeOpen, setCubeOpen] = useState(false)
  const [dlgSeen, setDlgSeen]   = useState(false)

  /* Приём снимков «по одному»: карточки проявляются с шагом ~320 мс,
     пока идёт проявка — плашка ЧТЕНИЕ МЕТАДАННЫХ. Это отражение уже
     проделанной работы (каждый файл реально прочитан парсером EXIF),
     а не имитация процесса: сам разбор идёт в handleFiles до того,
     как снимок попадает в этот массив.

     Очередь проявки держится ОДНИМ числом (индекс первой новой
     карточки), а сроки отсчитывает CSS по animation-delay. Через
     setTimeout это было хрупко: StrictMode в dev монтирует эффект
     дважды, cleanup гасил таймеры, а повторный проход видел
     added === 0 и уже не заводил их заново — плашки «ЧТЕНИЕ
     МЕТАДАННЫХ» оставались на снимках навсегда. */
  const [newFrom, setNewFrom] = useState(-1)
  const prevCount = useRef(0)

  useEffect(() => {
    const added = photos.length - prevCount.current
    prevCount.current = photos.length
    if (!photos.length) { setNewFrom(-1); return }
    if (added > 0) setNewFrom(photos.length - added)
  }, [photos.length])

  /* Кнопки панели задач подводят страницу к своему окну.
     СВОЙСТВА_КУБА сперва разворачивает панель и только потом
     прокручивает: у свёрнутой панели нулевая высота, и доводка
     целилась бы в точку, которая через кадр уедет. */
  const dzRef   = useRef(null)
  const cubeRef = useRef(null)
  useEffect(() => onArchive(EV.FILES, () => revealEl(dzRef.current)), [])
  useEffect(() => onArchive(EV.CUBE, () => {
    setCubeOpen(true)
    requestAnimationFrame(() => revealEl(cubeRef.current))
  }), [])

  // ── реальные метрики партии ───────────────────────────────────
  const withExif  = photos.filter((p) => !!p.exifData).length
  const withGeo   = photos.filter((p) => geoOf(p) != null).length
  const withFocal = photos.filter((p) => focalOf(p) != null).length
  const noFocal   = photos.length - withFocal

  const has3d    = !!(plyUrl || glbUrl)
  const finished = !!(result || has3d)
  const cubeState = finished ? cubeResolved(result, parsed?._volumeNum) : null

  // номер анализа: из uuid замера, пока он известен — держим последний
  const lastId = useRef(null)
  if (analysisId) lastId.current = analysisId
  const docNo = analysisNo(analysisId || lastId.current)

  const phase = finished ? 'ГОТОВ' : busy ? 'РАБОТА' : photos.length ? 'ПАРТИЯ НАБРАНА' : 'ОЖИДАНИЕ'

  // подпись под полосой в зоне ввода — только по настоящей работе
  const dzNote = compressing
    ? `ЧТЕНИЕ МЕТАДАННЫХ ${compProg} %`
    : upProg?.phase === 'upload'
      ? `ОТПРАВКА ${upProg.pct} %`
      : upProg
        ? 'СЕРВЕР РАСКЛАДЫВАЕТ ПАЧКУ'
        : photos.length
          ? `ПРИНЯТО ${pad2(photos.length)} · ${sizeStr}`
          : 'ОЖИДАНИЕ ФАЙЛОВ'
  const dzPct = compressing ? compProg : upProg?.phase === 'upload' ? upProg.pct : photos.length ? 100 : 0
  const dzIndeterminate = !!upProg && upProg.phase !== 'upload'

  // первый снимок — в «приклеенное» окно шапки
  const shot = photos[0] || null
  const shotFocal = focalOf(shot)

  // ── диалог партии: настоящий повод, а не сценарный ────────────
  // В макете диалог про «куб не найден на 2 снимках». На клиенте
  // куб определить нечем — его ищет пайплайн. Зато проверяемо и не
  // менее важно другое: без фокусного расстояния в метаданных
  // масштаб поедет (см. CLAUDE.md, prepareImage.js). По этому
  // поводу и предупреждаем.
  const showDlg = !dlgSeen && !busy && !finished && photos.length > 0 && noFocal > 0
  const dropNoFocal = () => {
    for (let i = photos.length - 1; i >= 0; i--) if (focalOf(photos[i]) == null) removePhoto(i)
    setDlgSeen(true)
  }
  useEffect(() => { if (!photos.length) setDlgSeen(false) }, [photos.length])

  return (
    <div className="arc-page">
      {/* ═══ ШАПКА РАЗДЕЛА ═══════════════════════════════════ */}
      <section className="arc-head">
        <span className="arc-head__no" aria-hidden="true">01</span>

        <div className="arc-head__text">
          <div className="arc-head__chips">
            <span className="arc-chip is-solid">ФОТОГРАММЕТРИЯ</span>
            <span className="arc-chip">ГЕОМЕТРИЯ + КЛАССИФИКАТОР</span>
            {/* Чип сеанса появляется только когда сеанс есть: до отправки
                замера номера не существует, и «СЕАНС НЕ ОТКРЫТ» был
                подписью к пустоте. */}
            {docNo && <span className="arc-chip">СЕАНС {docNo}</span>}
          </div>

          <h1 className="arc-head__h1">ФОТОГРАММЕТРИЧЕСКИЙ АНАЛИЗ</h1>
          <p className="arc-head__sub">материал, объём и вес</p>
          <p className="arc-head__lead">
            Загрузите фото строительного материала — система восстановит геометрию по
            снимкам, определит тип, объём и приблизительную массу. Калибровочный куб в
            кадре обязателен.
          </p>
          <div className="arc-head__ver">
            <span className="arc-ico-check" aria-hidden="true" />
            ВЕРСИЯ 2.26 · СБОРКА 1609.2026
          </div>
        </div>

        <div className="arc-head__aside">
          <Win
            name={`СНИМОК_${photos.length ? '0001' : '0000'}.ЖПГ`}
            collapsible={false}
            className="arc-shot"
          >
            <div className="arc-blueprint arc-blueprint--shot">
              {shot ? (
                <img src={shot.dataUrl} alt="" className="arc-shot__img" />
              ) : (
                /* «КУЧИ» здесь не было места: система меряет объём
                   любого навала, а не одного материала. */
                <ArcPlate
                  as="button"
                  kind="frame"
                  className="arc-plate--btn"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  caption="КАДР ОБЪЕКТА НЕ ЗАГРУЖЕН"
                  hint="ПЕРЕТАЩИТЕ СНИМОК ИЛИ ВЫБЕРИТЕ ФАЙЛ"
                />
              )}
              <span className="arc-blueprint__corner arc-blueprint__corner--tl" aria-hidden="true" />
              <span className="arc-blueprint__corner arc-blueprint__corner--br" aria-hidden="true" />
            </div>
            <div className="arc-shot__meta">
              <span>{shot ? `${shot.width}×${shot.height}` : DASH}</span>
              <span>{shotFocal ? `${shotFocal} мм` : DASH}</span>
              <span>ГЕО {geoOf(shot) ? '✓' : DASH}</span>
              <span>МЕТА {shot?.exifData ? '✓' : DASH}</span>
            </div>
          </Win>

          <CalibCube
            edgeMm={cubeSpec?.edgeMm ?? 70}
            squaresPerSide={cubeSpec?.squaresPerSide ?? 4}
          />
        </div>
      </section>

      {/* ═══ СТРОКА СОСТОЯНИЯ + ДИАЛОГ ПРОВЕРКИ ПАРТИИ ═══════
          Диалог всплывает НАД строкой состояния (на узких экранах
          встаёт в поток — см. медиазапрос). */}
      <div className="arc-strip">
        {showDlg && (
          <BatchDialog
            text={`ФОКУСНОЕ РАССТОЯНИЕ НЕ НАЙДЕНО В МЕТАДАННЫХ ${noFocal} ${
              noFocal === 1 ? 'СНИМКА' : 'СНИМКОВ'
            }. ТОЧНОСТЬ ОБЪЁМА СНИЗИТСЯ.`}
            hint="СТОП — УБРАТЬ ЭТИ СНИМКИ ИЗ ПАРТИИ"
            onNext={() => setDlgSeen(true)}
            onStop={dropNoFocal}
          />
        )}
        <StateStrip photos={photos.length} withExif={withExif} phase={phase} />
      </div>

      {/* ═══ ОКНА ПРОГРАММ ═══════════════════════════════════ */}
      <div className="arc-cols">
        {/* ── ВВОД СНИМКОВ ── */}
        <Win
          name="ВВОД_СНИМКОВ.ПРГ"
          meta={`${pad2(photos.length)} / ${MAX_PHOTOS} · ${photos.length ? sizeStr : '0.0 МБ'}`}
        >
          <div
            ref={dzRef}
            className={`arc-dz${compressing ? ' is-intake' : ''}`}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over') }}
            onDragLeave={(e) => e.currentTarget.classList.remove('over')}
            onDrop={onDrop}
            onClick={() => !compressing && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
            aria-label="Перетащите снимки или выберите файлы"
          >
            <input
              ref={fileInputRef} type="file" multiple accept="image/*"
              onChange={(e) => handleFiles(e.target.files)}
              style={{ display: 'none' }}
            />
            <span className="arc-dz__scan" aria-hidden="true" />

            {compressing ? (
              /* Приём партии: крупный счётчик процентов по БАЙТАМ (те же
                 цифры, что и у полосы) плюс лента протяжки. Лента —
                 единственное здесь чистое украшение, и она намеренно
                 отвязана от процентов: это «плёнка идёт», а не второй,
                 конкурирующий индикатор прогресса. */
              <>
                <div className="arc-dz__big">{compProg}<i>%</i></div>
                <div className="arc-dz__title arc-dz__title--sm">ПРИЁМ ПАРТИИ</div>
                <div className="arc-film" aria-hidden="true">
                  {Array.from({ length: 18 }, (_, i) => (
                    <i key={i} style={{ animationDelay: `${i * 70}ms` }} />
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="arc-dz__title">ПЕРЕТАЩИТЕ СНИМКИ</div>
                <div className="arc-dz__arrows" aria-hidden="true">↓↓↓↓↓↓↓↓↓</div>
                <div className="arc-dz__hint">
                  ДО {MAX_PHOTOS} СНИМКОВ — ГЕОМЕТКИ ЧИТАЮТСЯ ИЗ МЕТАДАННЫХ
                </div>
              </>
            )}

            <div className={`arc-bar${dzIndeterminate ? ' is-indeterminate' : ''}`}>
              {!dzIndeterminate && <span style={{ width: `${dzPct}%` }} />}
            </div>
            <div className="arc-dz__note">{dzNote}</div>
            {compressing && compMsg && <div className="arc-dz__file">{compMsg}</div>}
          </div>

          <div className="arc-two">
            <div className="arc-box">
              <div className="arc-box__ttl">ТРЕБОВАНИЯ К СНИМКУ</div>
              <ul className="arc-list">
                {REQUIREMENTS.map((r) => <li key={r}>{r}</li>)}
              </ul>
              {/* Образцовый кадр стоит ИМЕННО ЗДЕСЬ, рядом со списком,
                  который он иллюстрирует, — а не в окне «СНИМОК_0001»,
                  где через секунду будет настоящий кадр пользователя.
                  Там он читался бы как чужой замер. */}
              <figure className="arc-sample">
                <img className="arc-art" src={ART.sample} alt="Пример правильного кадра: объект целиком, калибровочный куб в кадре" loading="lazy" />
                <figcaption>ОБРАЗЦОВЫЙ КАДР · ОБЪЕКТ ЦЕЛИКОМ · КУБ В КАДРЕ</figcaption>
              </figure>
            </div>

            <div className="arc-box">
              <div className="arc-box__ttl">ПРОВЕРКА ПАРТИИ</div>
              <div className="arc-kv">
                <div className={withGeo < photos.length ? 'is-bad' : ''}>
                  <span>ГЕОМЕТКИ</span><b>{pad2(withGeo)} / {pad2(photos.length)}</b>
                </div>
                <div className={withExif < photos.length ? 'is-bad' : ''}>
                  <span>МЕТАДАННЫЕ</span><b>{pad2(withExif)} / {pad2(photos.length)}</b>
                </div>
                <div className={noFocal > 0 ? 'is-bad' : ''}>
                  <span>ФОКУСНОЕ РАССТОЯНИЕ</span><b>{pad2(withFocal)} / {pad2(photos.length)}</b>
                </div>
                {/* Перекрытие кадров считает пайплайн, на клиенте его нечем
                    измерить — до ответа сервера здесь прочерк. */}
                <div>
                  <span>КАЛИБРОВОЧНЫЙ КУБ</span>
                  <b className={cubeState === false ? 'is-bad' : ''}>
                    {cubeState === null ? DASH : cubeState ? '✓' : 'НЕ НАЙДЕН'}
                  </b>
                </div>
              </div>
            </div>
          </div>

          {photos.length > 0 && (
            <div className="arc-thumbs">
              {photos.map((p, i) => {
                const isNew = newFrom >= 0 && i >= newFrom
                const delay = isNew ? `${(i - newFrom) * 320}ms` : undefined
                return (
                  <div
                    key={`${p.name}-${i}`}
                    className={`arc-th${isNew ? ' arc-th--in' : ''}`}
                    style={isNew ? { '--d': delay, animationDelay: delay } : undefined}
                    title={`${p.name}\n${p.width}×${p.height}, ${mb(p.sizeKb)}`}
                  >
                    <img src={p.dataUrl} alt="" />
                    <span className="arc-th__n">{pad2(i + 1)}</span>
                    <span className={`arc-th__tag${focalOf(p) != null ? ' is-ok' : ' is-bad'}`}>
                      МЕТА {focalOf(p) != null ? '✓' : '?'}
                    </span>
                    {geoOf(p) && <span className="arc-th__geo" title="Есть координаты">◎</span>}
                    {isNew && (
                      <>
                        <span className="arc-th__read">
                          <i className="arc-th__runner" aria-hidden="true" />
                          ЧТЕНИЕ МЕТАДАННЫХ
                        </span>
                        {/* вспышка «принят» — снимается той же выдержкой,
                            что и плашка чтения, только на кадр позже */}
                        <span className="arc-th__accept" aria-hidden="true">ПРИНЯТ</span>
                      </>
                    )}
                    <button
                      type="button"
                      className="arc-th__rm"
                      onClick={(e) => { e.stopPropagation(); removePhoto(i) }}
                      aria-label={`Убрать снимок ${i + 1}`}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </Win>

        {/* ── ПАРАМЕТРЫ ОБЪЕКТА ── */}
        <Win name="ПАРАМЕТРЫ_ОБЪЕКТА.ПРГ">
          <label className="arc-field">
            <span className="arc-field__k">НАЗВАНИЕ ОБЪЕКТА</span>
            <input
              className="arc-input"
              type="text" maxLength={200}
              placeholder="Щебень у склада №3"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className="arc-field">
            <span className="arc-field__k">ЗАМЕТКИ ДЛЯ АНАЛИЗА</span>
            <textarea
              className="arc-input arc-input--area"
              maxLength={500}
              placeholder="Описание кучи..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
            />
          </label>

          <div className="arc-field">
            <span className="arc-field__k">РЕЖИМ РАБОТЫ</span>
            <div className="arc-seg" role="group" aria-label="Режим работы">
              {/* TEST / PROD — латиницей по прямой просьбе: это имена
                  контуров пайплайна n8n, а не подписи интерфейса, и в
                  логах/настройках они называются именно так. */}
              <button
                type="button"
                className={`arc-seg__b${!isProd ? ' is-on' : ''}`}
                aria-pressed={!isProd}
                disabled={busy}
                onClick={() => !busy && setIsProd(false)}
              >
                TEST
              </button>
              <button
                type="button"
                className={`arc-seg__b arc-seg__b--prod${isProd ? ' is-on' : ''}`}
                aria-pressed={isProd}
                disabled={busy}
                onClick={() => !busy && setIsProd(true)}
              >
                PROD
              </button>
            </div>
          </div>

          {!online && (
            <p className="arc-warn">
              НЕТ СВЯЗИ. ЗАМЕР МОЖНО ПОСТАВИТЬ В ОЧЕРЕДЬ — УЙДЁТ САМ, КОГДА СВЯЗЬ ВЕРНЁТСЯ.
            </p>
          )}

          <div className="arc-actions">
            <button
              type="button"
              className="arc-btn arc-btn--main"
              onClick={runAnalysis}
              disabled={busy}
            >
              {busy
                ? (upProg?.phase === 'upload' ? `ОТПРАВКА ${upProg.pct} %` : 'ОБРАБОТКА…')
                : finished ? 'ПОВТОРИТЬ АНАЛИЗ'
                  : online ? 'НАЧАТЬ АНАЛИЗ' : 'ОТПРАВИТЬ В ОЧЕРЕДЬ'}
            </button>
            <button type="button" className="arc-btn" onClick={addToQueue} disabled={busy}>
              В ОЧЕРЕДЬ
            </button>
          </div>

          <div className="arc-actions arc-actions--sub" ref={cubeRef}>
            <button type="button" className="arc-btn arc-btn--ghost" onClick={reset}>
              СБРОСИТЬ СЕССИЮ
            </button>
            {/* ✳ — окно СВОЙСТВА_КУБА. Управляемое: ту же панель
                разворачивает кнопка панели задач. */}
            <CubeSettings open={cubeOpen} onOpenChange={setCubeOpen} onChange={onCubeChange} />
          </div>

          {busy && startTime && <ArcTimer startTime={startTime} />}

          {status && (
            <div className={`arc-status is-${status.type}`}>
              <b>{String(status.title).toUpperCase()}</b> {status.msg}
            </div>
          )}
        </Win>
      </div>

      {/* ═══ ЖУРНАЛ ══════════════════════════════════════════ */}
      {(busy || finished) && <Journal busy={busy} finished={finished} upProg={upProg} />}

      {/* ═══ ДОСЬЕ РЕЗУЛЬТАТА ════════════════════════════════ */}
      {(result || has3d || diag) && (
        <Dossier
          parsed={parsed}
          result={result}
          title={title}
          docNo={docNo}
          photos={photos}
          plyUrl={plyUrl}
          glbUrl={glbUrl}
          upVec={upVec}
          upGlbVec={upGlbVec}
          diag={diag}
          onReport={openReport}
        />
      )}
    </div>
  )
}
