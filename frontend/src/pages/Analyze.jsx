import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Timer from '../components/Timer'
import exifr from 'exifr'
import PlyViewer from '../components/PlyViewer'
import ViewerErrorBoundary from '../components/ViewerErrorBoundary'
import { DiagnosticsBlock, pickDiagnostics } from '../components/Diagnostics'  // ← карты высот + облака точек
import ReportPanel from '../components/ReportPanel'   // ← выдвижное окно отчёта
import ResultSummary from '../components/ResultSummary'  // ← плашка-сводка: материал / объём / плотность / масса
import { parseWebhookResult } from '../components/RaschetDownloadButton' // ← общий парсер (объём DUSt3R, масса = V×ρ)
import { enqueue, flushItem } from '../queue/queue'  // ← офлайн-очередь (PWA)
import Reveal from '../components/Reveal'  // ← лёгкое scroll/stagger-проявление
// Новый вид страницы (светлая/тёмная темы): выбор обхода из приложения вместо
// загрузки фото. Старая форма загрузки осталась — по ссылке «Загрузить фото вручную».
import AnalyzeDecor from '../components/obhod/AnalyzeDecor'
import { ObhodHero, ObhodStepper } from '../components/obhod/ObhodHero'
import ObhodPicker from '../components/obhod/ObhodPicker'
import ObhodShowcase from '../components/obhod/ObhodShowcase'
import { useFitZoom } from '../components/obhod/fit'
import { useScans, useTrack, useCloud } from '../components/obhod/scans'
import { periodQuery } from '../components/obhod/PeriodPicker'
import '../components/obhod/obhod.css'
import CubeSettings, { CUBE_DEFAULT } from '../components/CubeSettings'  // ← настраиваемый калибровочный куб
import { prepareImage } from '../prepareImage'  // ← оригинал на сервер + превью для UI
import { useTheme } from '../theme/ThemeProvider'
import ArchiveAnalyze from '../components/archive/ArchiveAnalyze'  // ← вид этой же страницы в теме «Архив»

const MAX_PHOTOS = 100
const POLL_MS    = 5000

const fmtMb = (bytes) => `${(bytes / 1048576).toFixed(1)} МБ`

// демо (?demo=1): ответ пайплайна для эталонной кучи 178 м³ — в формате n8n
const DEMO_RESULT = [
  'Проанализировано фото: 96',
  'Материал: Отсев дробления гранита, фракция 0–5 мм',
  '3D-реконструкция (DUSt3R)',
  'Объём DUSt3R: 178.40 м³',
  'Плотность материала: 1450 кг/м³',
].join('\n')

export default function Analyze() {
  const [photos, setPhotos]     = useState([])
  const [title, setTitle]       = useState('')
  const [notes, setNotes]       = useState('')
  const [compressing, setComp]  = useState(false)
  const [compMsg, setCompMsg]   = useState('')
  const [compProg, setCompProg] = useState(0)
  // Реальная отправка байтов на сервер: { phase:'upload'|'server', loaded, total, pct }.
  // phase 'upload' — цифры настоящие (XHR upload.onprogress); 'server' —
  // байты ушли, сервер раскладывает фото в Storage, длительность неизвестна,
  // поэтому полоса переходит в неопределённый режим вместо выдуманных процентов.
  const [upProg, setUpProg]     = useState(null)
  const [status, setStatus]     = useState(null)
  const [analysisId, setAId]    = useState(null)
  const [startTime, setStart]   = useState(null)

  const [result, setResult]     = useState(null)
  const [plyUrl, setPlyUrl]     = useState(null)  // ← отдельный state для PLY
  const [glbUrl, setGlbUrl]     = useState(null)  // ← отдельный state для GLB
  const [upVec, setUpVec]       = useState(null)  // ← ось «вверх» из пайплайна (PLY-кадр)
  const [upGlbVec, setUpGlbVec] = useState(null)  // ← ось «вверх» для GLB-меша (свой кадр)
  // Диагностика: карта высот + облако точек, сверху и сбоку. У старых замеров
  // колонок нет → null → блока просто нет.
  const [diag, setDiag]         = useState(null)

  const [busy, setBusy]         = useState(false)
  const [reportOpen, setReportOpen] = useState(false)  // выдвижное окно отчёта
  const [online, setOnline]     = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  // Блок cube для payload + валидность параметров куба (из CubeSettings).
  const [cube, setCube]         = useState(CUBE_DEFAULT)
  const [cubeValid, setCubeValid] = useState(true)
  // Разобранные размеры куба — нужны только для подписи карточки
  // калибровочного куба в теме «Архив». В payload не идут.
  const [cubeSpec, setCubeSpec] = useState({ edgeMm: 70, squaresPerSide: 4 })
  const onCubeChange = useCallback(({ payload, valid, edgeMm, squaresPerSide }) => {
    setCube(payload); setCubeValid(valid)
    setCubeSpec(prev => (prev.edgeMm === edgeMm && prev.squaresPerSide === squaresPerSide)
      ? prev
      : { edgeMm, squaresPerSide })
  }, [])
  const { isArchive, isDark } = useTheme()

  // ─── Обходы из приложения (новый шаг 1) ──────────────────────────────────
  // source: 'scans' — выбор обхода (по умолчанию), 'upload' — старая загрузка фото.
  // ?demo=1 (или VITE_OBHOD_DEMO=1) — данные мокапа вместо /api/scans/.
  const demo = useMemo(() => (
    (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')) ||
    import.meta.env.VITE_OBHOD_DEMO === '1'
  ), [])
  const [source, setSource]       = useState('scans')
  const [scanSel, setScanSel]     = useState([])
  const [period, setPeriod]       = useState(null)   // null — за всё время
  const periodQ                   = useMemo(() => periodQuery(period), [period])
  // ── Суперадмин: обходы чужих пользователей ──
  // adminUsers === null → обычный пользователь, селектора нет (как в History.jsx)
  // userFilter: 'mine' | 'all' | <uuid пользователя>
  const [adminUsers, setAdminUsers] = useState(null)
  const [userFilter, setUserFilter] = useState('mine')
  useEffect(() => {
    if (demo) return
    api.adminListUsers()
      .then((list) => setAdminUsers(Array.isArray(list) ? list : []))
      .catch(() => setAdminUsers(null))
  }, [demo])
  const scans = useScans(periodQ, demo, userFilter === 'mine' ? null : userFilter)
  // смена «чей обход показывать» — снимаем выбор (старый обход из другого
  // списка не исчезает сам: pickedScans его не найдёт, но лучше явно сбросить)
  useEffect(() => { setScanSel([]); setQueueNote('') }, [userFilter])
  const pickedScans = useMemo(
    () => scans.items.filter(o => scanSel.includes(o.id)),
    [scans.items, scanSel],
  )
  // карта показывает траекторию первого выбранного обхода
  const trackState = useTrack(pickedScans[0] || null, demo)
  const cloud = useCloud(pickedScans[0] || null, demo)
  const ksZoom = useFitZoom()   // на невысоком окне ужимаем «Анализ», чтобы раскрытая панель влезала целиком
  const [queueNote, setQueueNote]     = useState('')   // «поставлен в очередь» — в подвале панели
  // обход выбирается один: клик по выбранному снимает выбор
  const toggleScan = useCallback((id) => {
    setScanSel(prev => prev[0] === id ? [] : [id])
    setQueueNote('')
  }, [])
  // запуск анализа обхода прямо из панели: «Запустить» — ждём результат на
  // странице (как в ручной загрузке), «В очередь» — отправили и свободны
  const [scanSending, setScanSending] = useState(false)
  const [collapseSig, setCollapseSig] = useState(0)
  const [scanReport, setScanReport]   = useState({ title: '', photos: [] })
  const scanRunIds = useRef({})      // client_id на обход: повтор после обрыва сети не заведёт второй анализ
  const doneMsgRef = useRef('')
  const demoTimer  = useRef(null)
  const resultRef  = useRef(null)
  // Стабильные ссылки — иначе memo на ReportPanel бесполезен: новая стрелка
  // на каждый рендер Analyze (а он идёт на каждое нажатие в любом поле)
  // считалась бы сменой пропса и тянула бы за собой пересборку отчёта.
  const openReport  = useCallback(() => setReportOpen(true), [])
  const closeReport = useCallback(() => setReportOpen(false), [])
  const pollRef                 = useRef(null)
  // Метаданные текущего опроса: id анализа, крайний срок и счётчик подряд
  // неудачных запросов. Держим в ref, чтобы интервал видел свежие значения
  // без пересоздания и чтобы cleanup на unmount мог всё погасить.
  const pollMetaRef             = useRef({ id: null, deadline: 0, fails: 0 })
  const fileInputRef            = useRef(null)
  // Синхронный замок сабмита. setBusy(true) — асинхронный стейт React: два
  // быстрых тапа/двойной клик успевают оба пройти `if (busy) return` до
  // ре-рендера и отправить дважды. Ref срабатывает мгновенно.
  const submittingRef           = useRef(false)

  // Следим за связью — от неё зависит дефолтная кнопка и офлайн-баннер.
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Числа для сводки и отчёта — из текста результата.
  // Сам текст (эмодзи, служебные строки) пользователю не показываем —
  // он под тогглом «Технические данные» в плашке-сводке (ResultSummary).
  const parsed = useMemo(
    () => (result ? parseWebhookResult(result) : null),
    [result],
  )

  // ─── Файлы ─────────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList).filter(
      f => f.type.startsWith('image/') || f.name.match(/\.(heic|heif)$/i)
    )
    if (!files.length) { setStatus({ type:'error', title:'Неверный формат', msg:'Выберите JPG, PNG или HEIC' }); return }

    const total = Math.min(files.length, MAX_PHOTOS)
    const batch = files.slice(0, total)
    // Прогресс считаем по БАЙТАМ и только по уже сделанному. По номеру кадра
    // он врал: кадр 12 МБ и кадр 1 МБ давали одинаковый шаг, полоса дёргалась
    // и уезжала вперёд работы. Здесь шаг = доля веса реально обработанного файла.
    const totalBytes = batch.reduce((s, f) => s + (f.size || 0), 0) || 1
    let doneBytes = 0
    setComp(true)
    setCompProg(0)
    const added = []
    for (let i = 0; i < total; i++) {
      setCompMsg(`Готовим ${i + 1} из ${total}: ${batch[i].name}`)
      try {
        let exifData = null
        try {
          exifData = await exifr.parse(batch[i], {
            gps:  true,
            tiff: true,
            exif: true,
            xmp:  false,
            iptc: false,
          })
          if (exifData) {
            exifData = JSON.parse(JSON.stringify(exifData, (_, v) =>
              v instanceof Date ? v.toISOString() : v
            ))
          }
        } catch (_) {}

        const photo = await prepareImage(batch[i])
        photo.exifData = exifData
        added.push(photo)
      } catch (err) {
        setStatus({ type:'error', title:'Ошибка файла', msg: err.message })
      }
      doneBytes += batch[i].size || 0
      setCompProg(Math.round((doneBytes / totalBytes) * 100))
    }
    setCompProg(100)
    setComp(false)
    setCompMsg('')

    setPhotos(prev => [...prev, ...added].slice(0, MAX_PHOTOS))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    e.currentTarget.classList.remove('over')
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const removePhoto = (idx) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx))
  }

  // ─── Polling ────────────────────────────────────────────────────────────────
  // Бэкенд может считать до часа — задаём потолок с запасом, чтобы страница
  // не опрашивала сервер бесконечно, если анализ завис.
  const POLL_MAX_MS   = 65 * 60 * 1000
  // ~12 подряд неудачных ответов (≈1 мин) при живой сети → сдаёмся, чтобы не
  // крутить спиннер вечно на 404/500. Офлайн за неудачу не считаем.
  const POLL_MAX_FAILS = 12

  const startPolling = (id) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollMetaRef.current = { id, deadline: Date.now() + POLL_MAX_MS, fails: 0 }
    pollRef.current = setInterval(pollOnce, POLL_MS)
  }

  const pollOnce = async () => {
    const meta = pollMetaRef.current
    if (!meta.id) return

    // Потолок по времени — анализ явно завис.
    if (Date.now() > meta.deadline) {
      stopPolling()
      setStatus({ type:'error', title:'Время вышло', msg:'Анализ занял слишком долго. Проверьте статус в Истории.' })
      setAId(null)
      return
    }
    // Вкладка скрыта — не жжём батарею/трафик, вернёмся когда станет видимой.
    if (typeof document !== 'undefined' && document.hidden) return

    try {
        const data = await api.getAnalysis(meta.id)
        meta.fails = 0
        if (data.status === 'completed') {
          stopPolling()

          let textResult = data.result

          // ШАГ 1: сначала смотрим прямые поля из Supabase (отдельные колонки)
          let finalGlbUrl = data.glb_url || null
          let finalPlyUrl = data.ply_url || null

          // ось «вверх» из пайплайна (heightfield-нормаль, со знаком) —
          // для детерминированного выравнивания вьюера без RANSAC.
          // PLY и GLB — в разных кадрах, поэтому два вектора.
          let finalUp = Array.isArray(data.up_vector) ? data.up_vector : null
          let finalUpGlb = Array.isArray(data.up_vector_glb) ? data.up_vector_glb : null
          const asVec3 = (a) =>
            (Array.isArray(a) && a.length === 3 && a.every((n) => Number.isFinite(+n)))
              ? a.map(Number) : null

          // ШАГ 2: парсим result как JSON
          let parsedJson = data.result
          if (typeof parsedJson === 'string') {
            try { parsedJson = JSON.parse(parsedJson) } catch (e) {}
          }

          if (parsedJson && typeof parsedJson === 'object') {
            // up-векторы внутри JSON (up_vector / up_vector_glb = [x,y,z])
            // Обход с потолком глубины и ранним выходом: как только оба
            // вектора найдены — не обходим остаток дерева (лишняя работа на
            // каждом поллинге при большом ответе). MAX_DEPTH страхует от
            // патологически вложенных структур.
            const MAX_DEPTH = 8
            if (!finalUp || !finalUpGlb) {
              const findUp = (obj, depth = 0) => {
                if (!obj || typeof obj !== 'object' || depth > MAX_DEPTH) return
                if (finalUp && finalUpGlb) return
                if (!Array.isArray(obj)) {
                  if (!finalUp)    finalUp    = asVec3(obj.up_vector || obj.up || obj.upVector)
                  if (!finalUpGlb) finalUpGlb = asVec3(obj.up_vector_glb || obj.upGlb || obj.up_glb)
                }
                for (const v of Object.values(obj)) {
                  if (finalUp && finalUpGlb) break
                  findUp(v, depth + 1)
                }
              }
              findUp(parsedJson)
            }
            // ШАГ 3: если в прямых полях пусто — ищем внутри JSON
            if (!finalGlbUrl || !finalPlyUrl) {
              const findUrls = (obj, depth = 0) => {
                if (!obj || typeof obj !== 'object' || depth > MAX_DEPTH) return
                if (finalGlbUrl && finalPlyUrl) return
                if (obj.glb_url && !finalGlbUrl) finalGlbUrl = obj.glb_url
                if (obj.ply_url && !finalPlyUrl) finalPlyUrl = obj.ply_url
                if (obj.model_url && !finalGlbUrl) finalGlbUrl = obj.model_url
                for (const v of Object.values(obj)) {
                  if (finalGlbUrl && finalPlyUrl) break
                  findUrls(v, depth + 1)
                }
              }
              findUrls(parsedJson)
            }

            // ШАГ 4: достаём текст
            const n8nData = Array.isArray(parsedJson) ? parsedJson[0] : parsedJson
            if (n8nData?.dust3rBlock) textResult = n8nData.dust3rBlock
            else if (n8nData?.json?.dust3rBlock) textResult = n8nData.json.dust3rBlock
          }

          // фолбэк: up-вектор строкой в тексте вебхука «up_vector: x y z»
          const upFromText = (re) => {
            const m = String(textResult || '').match(re)
            return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null
          }
          if (!finalUp)
            finalUp = upFromText(/up[_ ]?vector[:=]\s*\[?\s*(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)/i)
          if (!finalUpGlb)
            finalUpGlb = upFromText(/up[_ ]?vector[_ ]?glb[:=]\s*\[?\s*(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)/i)

          setResult(textResult)
          setGlbUrl(finalGlbUrl)
          setPlyUrl(finalPlyUrl)
          // Прямые колонки heatmap_*_url / cloud_*_url — GET /analyses/{id}
          // делает select("*"), так что приезжают сами.
          setDiag(pickDiagnostics(data))
          setUpVec(finalUp)
          setUpGlbVec(finalUpGlb)
          setReportOpen(true)   // авто-выдвижение отчёта по готовности
          setStatus({ type:'success', title:'Готово!', msg: doneMsgRef.current || `Обработано ${photos.length} фото.` })
          doneMsgRef.current = ''
          setAId(null)

        } else if (data.status === 'error') {
          stopPolling()
          setStatus({ type:'error', title:'Ошибка анализа', msg: data.result || 'Неизвестная ошибка' })
          setAId(null)
        }
    } catch (e) {
      // Офлайн — не наша вина, ждём восстановления сети без штрафа.
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      meta.fails += 1
      if (meta.fails >= POLL_MAX_FAILS) {
        stopPolling()
        setStatus({ type:'error', title:'Нет ответа сервера', msg:'Не удаётся получить статус анализа. Загляните в Историю позже.' })
        setAId(null)
      }
    }
  }

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    pollMetaRef.current.id = null
    setBusy(false)
    setStart(null)
  }

  // Гасим интервал при уходе со страницы — иначе он продолжит опрашивать
  // сервер в фоне после размонтирования (утечка + расход батареи/трафика).
  useEffect(() => () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    pollMetaRef.current.id = null
  }, [])

  // ─── Запуск анализа ─────────────────────────────────────────────────────────
  // «Анализировать»: кладём в очередь и сразу отправляем, ждём результат здесь.
  // Очередь — единый источник правды: даже при потере ответа замер не пропадёт.
  const runAnalysis = async () => {
    if (busy || submittingRef.current) return
    if (!photos.length) { setStatus({ type:'error', title:'Нет фото', msg:'Добавьте хотя бы одно фото' }); return }
    if (!cubeValid) { setStatus({ type:'error', title:'Параметры куба', msg:'Исправьте значения калибровочного куба' }); return }

    submittingRef.current = true
    setBusy(true)
    setStatus(null)
    setResult(null)
    setGlbUrl(null)
    setPlyUrl(null)
    setUpVec(null)
    setUpGlbVec(null)
    setDiag(null)

    const payload = photos.map(p => ({ blob: p.blob, name: p.name, exif: p.exifData ?? null }))

    let id
    try {
      id = await enqueue({ title, notes, photos: payload, cube })
    } catch (err) {
      submittingRef.current = false
      setBusy(false)
      setStatus({ type:'error', title:'Ошибка сохранения', msg: err.message })
      return
    }

    try {
      setUpProg({ phase: 'upload', loaded: 0, total: 1, pct: 0 })
      const serverId = await flushItem(id, { onProgress: setUpProg })   // POST сейчас
      setUpProg(null)                           // байты ушли, дальше считает пайплайн

      // flushItem НЕ бросает, когда офлайн: он просто оставляет элемент в
      // очереди и возвращает null. Раньше этот null уходил в startPolling(null)
      // — опрос молча ничего не делал, а страница навсегда застревала в busy
      // со спиннером и бегущим таймером. Ровно то, что видно на мобильной сети
      // при обрыве. Нет id — значит не отправили, и вести себя надо как в catch.
      if (!serverId) {
        setBusy(false)
        setStart(null)
        setStatus({
          type: 'info',
          title: online ? 'Добавлено в очередь' : 'Нет сети — добавлено в очередь',
          msg: 'Замер сохранён и отправится автоматически. Статус — в Истории.',
        })
        setPhotos([])
        return
      }

      setAId(serverId)
      setStart(Date.now())
      startPolling(serverId)                    // ждём готовности на странице
    } catch (err) {
      // Сеть пропала — замер уже в очереди и уйдёт сам. Не крутим спиннер.
      setUpProg(null)
      setBusy(false)
      setStart(null)
      setStatus({
        type: 'info',
        title: online ? 'Добавлено в очередь' : 'Нет сети — добавлено в очередь',
        msg: 'Замер сохранён и отправится автоматически. Статус — в Истории.',
      })
      setPhotos([])
    } finally {
      submittingRef.current = false
    }
  }

  // «В очередь»: сохраняем и отпускаем — отправка в фоне, без ожидания.
  // Для случая, когда надо набить пачку объектов и не ждать каждый.
  const addToQueue = async () => {
    if (busy || submittingRef.current) return
    if (!photos.length) { setStatus({ type:'error', title:'Нет фото', msg:'Добавьте хотя бы одно фото' }); return }
    if (!cubeValid) { setStatus({ type:'error', title:'Параметры куба', msg:'Исправьте значения калибровочного куба' }); return }

    submittingRef.current = true
    try {
      const payload = photos.map(p => ({ blob: p.blob, name: p.name, exif: p.exifData ?? null }))
      let id
      try {
        id = await enqueue({ title, notes, photos: payload, cube })
      } catch (err) {
        setStatus({ type:'error', title:'Ошибка', msg: err.message })
        return
      }
      // Отправляем фоном, но прогресс всё равно показываем: пачка оригиналов
      // на мобильной сети уходит минутами, и «тишина» выглядит как зависание.
      setUpProg({ phase: 'upload', loaded: 0, total: 1, pct: 0 })
      flushItem(id, { onProgress: setUpProg })
        .catch(() => {})
        .finally(() => setUpProg(null))

      setStatus({ type:'success', title:'В очереди', msg:'Замер добавлен — отправим автоматически при связи.' })
      setPhotos([])
      setTitle('')
      setNotes('')
    } finally {
      submittingRef.current = false
    }
  }

  // ─── Анализ обхода из приложения ────────────────────────────────────────────
  const clearResult = () => {
    setResult(null); setGlbUrl(null); setPlyUrl(null); setUpVec(null); setUpGlbVec(null)
    setDiag(null); setReportOpen(false)
  }
  const runScan = async (queueOnly = false) => {
    const s = pickedScans[0]
    if (!s || busy || scanSending || submittingRef.current) return
    if (!cubeValid) { setStatus({ type:'error', title:'Параметры куба', msg:'Исправьте значения калибровочного куба' }); return }
    submittingRef.current = true
    setStatus(null)
    const frames = (trackState.track?.frames || []).map(f => f.thumb).filter(Boolean)
    if (!queueOnly) {
      clearResult()
      setScanReport({ title: s.title, photos: [s.img, ...frames].filter(Boolean).slice(0, 3) })
      doneMsgRef.current = `«${s.title}» · ${s.photos} ${s.photos % 10 === 1 && s.photos % 100 !== 11 ? 'кадр' : 'кадров'} обхода.`
    }
    // демо: без сервера — показываем весь путь, результат эталонной кучи
    if (demo) {
      submittingRef.current = false
      if (queueOnly) {
        setQueueNote(`«${s.title}» в очереди (демо)`)
        setScanSel([]); return
      }
      setBusy(true); setAId('demo'); setStart(Date.now())
      clearTimeout(demoTimer.current)
      demoTimer.current = setTimeout(() => {
        setBusy(false); setStart(null); setAId(null)
        setResult(DEMO_RESULT); setReportOpen(true)
        setStatus({ type:'success', title:'Готово!', msg: doneMsgRef.current + ' Демо: цифры эталонной кучи.' })
        doneMsgRef.current = ''
      }, 9000)
      return
    }
    setScanSending(true)
    const client_id = (scanRunIds.current[s.id] ||= globalThis.crypto?.randomUUID?.())
    try {
      const r = await api.analyzeScan(s.id, { cube, client_id })
      delete scanRunIds.current[s.id]
      if (queueOnly) {
        setQueueNote(`«${s.title}» в очереди`)
        setScanSel([])
      } else {
        setBusy(true); setAId(r.id); setStart(Date.now())
        startPolling(r.id)
      }
    } catch (e) {
      setStatus({ type:'error', title:'Не удалось запустить анализ', msg: e?.message || 'Ошибка сервера' })
    } finally {
      setScanSending(false)
      submittingRef.current = false
    }
  }
  // «Не ждать»: перестаём опрашивать, анализ досчитается на сервере сам
  const detachScan = () => {
    clearTimeout(demoTimer.current)
    stopPolling(); setAId(null)
    doneMsgRef.current = ''
    setQueueNote('Анализ досчитается на сервере')
    setScanSel([])
  }
  useEffect(() => () => clearTimeout(demoTimer.current), [])
  // результат обхода пришёл — сворачиваем панель и показываем его под плашкой
  useEffect(() => {
    if (source !== 'scans' || !result) return
    setCollapseSig(n => n + 1)
    const id = setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 450)
    return () => clearTimeout(id)
  }, [result, source])

  const reset = () => {
    if (busy) { stopPolling() }
    setPhotos([])
    setTitle('')
    setNotes('')
    setStatus(null)
    setResult(null)
    setGlbUrl(null)
    setPlyUrl(null)
    setUpVec(null)
    setUpGlbVec(null)
    setDiag(null)
    setAId(null)
    setCompProg(0)
    setUpProg(null)
    setReportOpen(false)
  }

  const copyResult = () => {
    if (!result) return
    navigator.clipboard.writeText(result).catch(() => {})
  }

  const totalKb = photos.reduce((s, p) => s + p.sizeKb, 0)
  const sizeStr = totalKb > 1024 ? `${(totalKb/1024).toFixed(1)} МБ` : `${totalKb} КБ`
  const has3d   = plyUrl || glbUrl

  // Текущий шаг процесса — выводится из состояния, без отдельного state.
  // Когда результат готов — уводим за 3, чтобы шаг «Объём и вес» тоже стал
  // галочкой (done), а не завис на числе (active).
  const finished = !!(result || has3d)
  const currentStep = finished ? 4 : busy ? 2 : 1

  // Карточка результата — общая для ручной загрузки и для обхода из приложения
  const resultCard = (
(result || has3d || diag) && (
      <div className="result-card">
        <div className="result-hd">
          <span className="result-hd-title">Результат</span>
          {result && (
            <div style={{ display:'flex', gap:'var(--sp-2)', alignItems:'center' }}>
              <button className="copy-btn" onClick={copyResult}>Копировать</button>
              <button className="copy-btn" onClick={() => setReportOpen(true)}>Открыть отчёт</button>
            </div>
          )}
        </div>

        {/* Плашка-сводка, как п. 2 отчёта: материал, объём, плотность, масса.
            Показывается при любом завершённом расчёте — чего сервер не
            определил, там прочерк. Сырой текст пайплайна — под тогглом
            «Технические данные» внутри неё. */}
        {result && <ResultSummary parsed={parsed} result={result} />}

        {/* 3D-модель — показывается по наличию модели, а не по тексту */}
        {has3d && (
          <div style={{ padding:'0 var(--sp-4) var(--sp-4)' }}>
            <div className="divider" style={{ marginTop: result ? 'var(--sp-1)' : 'var(--sp-4)' }}>
              <div className="div-line" />
              <span className="div-txt">Визуализация объёма</span>
              <div className="div-line" />
            </div>
            <ViewerErrorBoundary>
              <PlyViewer plyUrl={plyUrl} glbUrl={glbUrl} up={upVec} upGlb={upGlbVec} />
            </ViewerErrorBoundary>
            {/* рядом с 3D — та же геометрия, но с разметкой достроек */}
            <DiagnosticsBlock diag={diag} />
          </div>
        )}

        {/* Текст есть, а модели нет — мягкая подсказка вместо красного блока */}
        {result && !has3d && (
          <div style={{ padding:'0 var(--sp-4) var(--sp-4)', fontSize:'var(--fs-xs)', color:'var(--muted)' }}>
            3D-модель для этого анализа недоступна.
          </div>
        )}

        {/* Диагностика без 3D — блок всё равно нужен: он единственный
            показывает, ИЗ ЧЕГО посчитан объём и где модель достраивали. */}
        {diag && !has3d && (
          <div style={{ padding:'0 var(--sp-4) var(--sp-4)' }}>
            <DiagnosticsBlock diag={diag} />
          </div>
        )}
      </div>
    )
  )

  /* ── Тема «Архив»: другой ВИД той же страницы ──────────────────────────
     Ветка стоит после всех хуков, поэтому порядок вызовов не меняется.
     Логика целиком остаётся здесь — ArchiveAnalyze получает готовые
     обработчики и не знает ни про api, ни про очередь. */
  if (isArchive) {
    return (
      <>
        <ArchiveAnalyze
          photos={photos} fileInputRef={fileInputRef} handleFiles={handleFiles}
          onDrop={onDrop} removePhoto={removePhoto}
          title={title} setTitle={setTitle} notes={notes} setNotes={setNotes}
          busy={busy} compressing={compressing} compProg={compProg} compMsg={compMsg}
          upProg={upProg} status={status} online={online}
          runAnalysis={runAnalysis} addToQueue={addToQueue} reset={reset}
          openReport={openReport}
          result={result} parsed={parsed}
          plyUrl={plyUrl} glbUrl={glbUrl} upVec={upVec} upGlbVec={upGlbVec} diag={diag}
          startTime={startTime} analysisId={analysisId}
          onCubeChange={onCubeChange} cubeSpec={cubeSpec}
          sizeStr={sizeStr}
        />
        {result && (
          <ReportPanel
            open={reportOpen}
            onOpen={openReport}
            onClose={closeReport}
            result={result}
            photos={photos}
            title={title}
          />
        )}
      </>
    )
  }

  return (
    <div className="page">
      <div className="ks-scope" style={ksZoom !== 1 ? { zoom: ksZoom } : undefined}>
        <AnalyzeDecor theme={isDark ? 'dark' : 'light'} />
        <ObhodHero />
        <ObhodStepper current={currentStep} first={source === 'upload' ? 'Загрузить фото' : 'Обход'} />

        {source === 'scans' && (
          <>
            <ObhodPicker
              items={scans.items}
              selected={scanSel}
              onToggle={toggleScan}
              run={{
                onCube: onCubeChange,
                busy: scanSending, waiting: busy && !!analysisId, startTime,
                onRun: () => runScan(false), onQueue: () => runScan(true), onDetach: detachScan,
                notice: queueNote,
              }}
              collapseSignal={collapseSig}
              loading={scans.loading}
              error={scans.error}
              demo={demo}
              track={trackState.track}
              trackLoading={trackState.loading}
              cloud={cloud}
              theme={isDark ? 'dark' : 'light'}
              zoomed={ksZoom !== 1}
              period={period}
              onPeriod={setPeriod}
              adminUsers={adminUsers}
              userFilter={userFilter}
              onUserFilter={setUserFilter}
            />
            {(status || resultCard) && (
              <div className="ks-result" ref={resultRef}>
                {status && (
                  <div className={`status ${status.type}`}>
                    <strong>{status.title}</strong> {status.msg}
                    {status.history && <> <Link to="/history">Открыть Историю →</Link></>}
                  </div>
                )}
                {resultCard}
              </div>
            )}
            <button type="button" className="ks-manual" onClick={() => { setStatus(null); setSource('upload') }} disabled={busy}>
              Нет обхода? Загрузить фото вручную
            </button>
            {!busy && !finished && !status && <ObhodShowcase theme={isDark ? 'dark' : 'light'} />}
          </>
        )}
        {source === 'upload' && (
          <button type="button" className="ks-manual" onClick={() => { setStatus(null); setSource('scans') }} disabled={busy}>
            ← Выбрать обход из приложения
          </button>
        )}
      </div>

      {source === 'upload' && (
      <div className="content">
      <Reveal delay={60} y={22}>
      <div className="card">
        {/* UPLOAD SECTION */}
        <div className="card-sec">
          <div className="sec-hd">
            <span className="sec-title">Фотографии объекта</span>
            <span className="pill">{photos.length} / {MAX_PHOTOS}{photos.length > 0 ? ` · ${sizeStr}` : ''}</span>
          </div>

          <div
            className="dz"
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over') }}
            onDragLeave={e => e.currentTarget.classList.remove('over')}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef} type="file" multiple accept="image/*"
              onChange={e => handleFiles(e.target.files)}
              style={{ display:'none' }}
            />
            <div className="dz-icons">
              <div className="dz-ico">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5a2 2 0 0 0-3 0L5 21"/>
                </svg>
              </div>
              <div className="dz-ico">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <div className="dz-ico">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 7.5 12 2 3 7.5v9L12 22l9-5.5z"/><path d="M3 7.5 12 13l9-5.5"/><path d="M12 22V13"/>
                </svg>
              </div>
            </div>
            <div className="dz-title">Перетащите фото сюда</div>
            <div className="dz-sub">JPG, PNG, HEIC · до {MAX_PHOTOS} шт. · считываем GPS из EXIF</div>
            {photos.length > 0 && (
              <div className="dz-count">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                Добавлено: {photos.length}
              </div>
            )}
          </div>

          {/* ПОДГОТОВКА ФАЙЛОВ (локально, до отправки) */}
          {compressing && (
            <div className="status info" style={{ display:'block' }}>
              <strong>Подготовка фотографий · {compProg}%</strong>
              {compMsg}
              <div className="prog-wrap"><div className="prog-bar" style={{ width:`${compProg}%` }} /></div>
            </div>
          )}

          {/* ОТПРАВКА НА СЕРВЕР — цифры настоящие, из XHR upload.onprogress.
              Пока байты идут, показываем процент и мегабайты; когда ушли все,
              переключаемся в неопределённый режим: сколько сервер будет
              раскладывать пачку в Storage, браузеру неизвестно, и рисовать
              там «проценты» значило бы снова врать. */}
          {upProg && (
            <div className="status info" style={{ display:'block' }}>
              {upProg.phase === 'upload' ? (
                <>
                  <strong>Отправка на сервер · {upProg.pct}%</strong>
                  {upProg.total > 1 ? `${fmtMb(upProg.loaded)} из ${fmtMb(upProg.total)}` : 'Начинаем передачу…'}
                  <div className="prog-wrap">
                    <div className="prog-bar" style={{ width:`${upProg.pct}%` }} />
                  </div>
                </>
              ) : (
                <>
                  <strong>Фото отправлены</strong>
                  Сервер сохраняет пачку — это занимает до минуты.
                  <div className="prog-wrap">
                    <div className="prog-bar is-indeterminate" />
                  </div>
                </>
              )}
            </div>
          )}

          {photos.length > 0 && (
            <div className="thumbs">
              {photos.map((p, i) => (
                <div
                  key={i}
                  className="thumb"
                  /* видно, что уходит именно оригинал: разрешение и вес файла */
                  title={`${p.name}\n${p.width}×${p.height}, ${
                    p.sizeKb > 1024 ? `${(p.sizeKb / 1024).toFixed(1)} МБ` : `${p.sizeKb} КБ`
                  }${p.original ? '' : ' (конвертирован из HEIC)'}`}
                >
                  <img src={p.dataUrl} alt="" />
                  <span className="thumb-n">{i + 1}</span>
                  {p.exifData?.latitude && (
                    <span
                      className="thumb-geo"
                      title={`${Number(p.exifData.latitude.toFixed(5))}, ${Number(p.exifData.longitude.toFixed(5))}`}
                      aria-label="Есть GPS-координаты"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                    </span>
                  )}
                  <button
                    className="thumb-rm"
                    onClick={e => { e.stopPropagation(); removePhoto(i) }}
                    aria-label={`Удалить фото ${i + 1}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* DETAILS SECTION */}
        <div className="card-sec">
          <div className="fields">
            <div className="field">
              <label>Название объекта</label>
              <input
                type="text" maxLength={200}
                placeholder="Щебень у склада №3"
                value={title} onChange={e => setTitle(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label>Заметки для анализа</label>
              <textarea
                maxLength={500} placeholder="Описание кучи..."
                value={notes} onChange={e => setNotes(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          {/* Баннер офлайна — подсказываем, что можно снять и поставить в очередь */}
          {!online && (
            <div className="status info" style={{ display:'block', marginTop:'var(--sp-4)' }}>
              <strong>Нет сети.</strong> Снимите замер и добавьте в очередь — отправим сами, когда связь вернётся.
            </div>
          )}

          <div className="actions" style={{ marginTop:'var(--sp-6)' }}>
            <button className="btn btn-primary" onClick={runAnalysis} disabled={busy}>
              {busy
                ? (upProg?.phase === 'upload'
                    ? <><div className="spinner" /> Отправка {upProg.pct}%</>
                    : <><div className="spinner" /> Анализируем...</>)
                : (online ? 'Запустить анализ' : 'Отправить (в очередь)')}
            </button>
            <button className="btn btn-secondary" onClick={addToQueue} disabled={busy} title="Сохранить и отправить в фоне">
              В очередь
            </button>
            <button className="btn btn-secondary" onClick={reset}>Сбросить</button>
            {/* Шестерёнка — в пустом слоте колонки «В очередь», на одном уровне
                со «Сбросить»; панель раскрывается на всю ширину под кнопками. */}
            <CubeSettings onChange={onCubeChange} />
          </div>

          {busy && startTime && <Timer startTime={startTime} />}

          {status && (
            <div className={`status ${status.type}`}>
              <strong>{status.title}</strong> {status.msg}
            </div>
          )}

          {resultCard}
        </div>
      </div>
      </Reveal>
      </div>
      )}

      {/* выдвижное окно отчёта (рендерится порталом в body) */}
      {result && (
        <ReportPanel
          open={reportOpen}
          onOpen={openReport}
          onClose={closeReport}
          result={result}
          photos={source === 'scans' ? scanReport.photos : photos}
          title={source === 'scans' ? scanReport.title : title}
        />
      )}
    </div>
  )
}
