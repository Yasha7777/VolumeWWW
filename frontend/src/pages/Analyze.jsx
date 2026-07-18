import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import Timer from '../components/Timer'
import exifr from 'exifr'
import PlyViewer from '../components/PlyViewer'
import ReportPanel from '../components/ReportPanel'   // ← выдвижное окно отчёта
import { parseWebhookResult } from '../components/RaschetDownloadButton' // ← общий парсер (объём DUSt3R, масса = V×ρ)
import { useTheme } from '../theme/ThemeProvider'   // ← только ради свага-лейбла кнопки
import { enqueue, flushItem } from '../queue/queue'  // ← офлайн-очередь (PWA)

const MAX_PHOTOS = 100
const MAX_DIM    = 1600
const QUALITY    = 0.85
const POLL_MS    = 5000

const STEPS = ['Загрузить фото', '3D-реконструкция', 'Объём и вес']

// ─── Сжатие изображения через Canvas ─────────────────────────────────────────
function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/') && !file.name.match(/\.(heic|heif)$/i)) {
      reject(new Error(`Не изображение: ${file.name}`))
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width >= height) { height = Math.round(height * MAX_DIM / width); width = MAX_DIM }
        else                 { width = Math.round(width * MAX_DIM / height); height = MAX_DIM }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Canvas toBlob failed')); return }
        const sizeKb = Math.round(blob.size / 1024)
        const dataUrl = canvas.toDataURL('image/jpeg', QUALITY)
        resolve({ blob, dataUrl, sizeKb, name: file.name })
      }, 'image/jpeg', QUALITY)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      if (file.name.match(/\.(heic|heif)$/i)) {
        reject(new Error('HEIC не поддерживается браузером. Конвертируйте в JPG/PNG.'))
      } else {
        reject(new Error(`Не удалось загрузить: ${file.name}`))
      }
    }
    img.src = url
  })
}

export default function Analyze() {
  const { isGtc } = useTheme()   // ← живёт под <ThemeProvider> из main.jsx

  const [photos, setPhotos]     = useState([])
  const [title, setTitle]       = useState('')
  const [notes, setNotes]       = useState('')
  const [compressing, setComp]  = useState(false)
  const [compMsg, setCompMsg]   = useState('')
  const [compProg, setCompProg] = useState(0)
  const [status, setStatus]     = useState(null)
  const [analysisId, setAId]    = useState(null)
  const [startTime, setStart]   = useState(null)

  const [result, setResult]     = useState(null)
  const [plyUrl, setPlyUrl]     = useState(null)  // ← отдельный state для PLY
  const [glbUrl, setGlbUrl]     = useState(null)  // ← отдельный state для GLB

  const [busy, setBusy]         = useState(false)
  const [isProd, setIsProd]     = useState(false)  // по умолчанию TEST
  const [reportOpen, setReportOpen] = useState(false)  // выдвижное окно отчёта
  const [showRaw, setShowRaw]   = useState(false)      // сырой ответ пайплайна (для отладки)
  const [online, setOnline]     = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const pollRef                 = useRef(null)
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

  // Структурированная сводка из текстового ответа n8n.
  // Сырой дамп с эмодзи и служебными полями (conf/sim/ratio) пользователю
  // не показываем — он доступен под тогглом «Технические данные».
  const parsed = useMemo(
    () => (result ? parseWebhookResult(result) : null),
    [result],
  )
  const hasSummary = !!(parsed && (parsed._volumeNum != null || parsed.material))

  // ─── Файлы ─────────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList).filter(
      f => f.type.startsWith('image/') || f.name.match(/\.(heic|heif)$/i)
    )
    if (!files.length) { setStatus({ type:'error', title:'Неверный формат', msg:'Выберите JPG, PNG или HEIC' }); return }

    const total = Math.min(files.length, MAX_PHOTOS)
    setComp(true)
    setCompProg(0)
    const added = []
    for (let i = 0; i < total; i++) {
      setCompMsg(`Сжимаем ${i + 1} из ${total}: ${files[i].name}`)
      setCompProg(Math.round((i / total) * 100))
      try {
        let exifData = null
        try {
          exifData = await exifr.parse(files[i], {
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

        const photo = await compressImage(files[i])
        photo.exifData = exifData
        added.push(photo)
      } catch (err) {
        setStatus({ type:'error', title:'Ошибка файла', msg: err.message })
      }
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
  const startPolling = (id) => {
    pollRef.current = setInterval(async () => {
      try {
        const data = await api.getAnalysis(id)
        if (data.status === 'completed') {
          stopPolling()

          let textResult = data.result

          // ШАГ 1: сначала смотрим прямые поля из Supabase (отдельные колонки)
          let finalGlbUrl = data.glb_url || null
          let finalPlyUrl = data.ply_url || null

          // ШАГ 2: парсим result как JSON
          let parsedJson = data.result
          if (typeof parsedJson === 'string') {
            try { parsedJson = JSON.parse(parsedJson) } catch (e) {}
          }

          if (parsedJson && typeof parsedJson === 'object') {
            // ШАГ 3: если в прямых полях пусто — ищем внутри JSON
            if (!finalGlbUrl || !finalPlyUrl) {
              const findUrls = (obj) => {
                if (!obj || typeof obj !== 'object') return
                if (obj.glb_url && !finalGlbUrl) finalGlbUrl = obj.glb_url
                if (obj.ply_url && !finalPlyUrl) finalPlyUrl = obj.ply_url
                if (obj.model_url && !finalGlbUrl) finalGlbUrl = obj.model_url
                Object.values(obj).forEach(findUrls)
              }
              findUrls(parsedJson)
            }

            // ШАГ 4: достаём текст
            const n8nData = Array.isArray(parsedJson) ? parsedJson[0] : parsedJson
            if (n8nData?.dust3rBlock) textResult = n8nData.dust3rBlock
            else if (n8nData?.json?.dust3rBlock) textResult = n8nData.json.dust3rBlock
          }

          setResult(textResult)
          setGlbUrl(finalGlbUrl)
          setPlyUrl(finalPlyUrl)
          setShowRaw(false)     // новый анализ — технические данные снова свёрнуты
          setReportOpen(true)   // авто-выдвижение отчёта по готовности
          setStatus({ type:'success', title:'Готово!', msg:`Обработано ${photos.length} фото.` })
          setAId(null)

        } else if (data.status === 'error') {
          stopPolling()
          setStatus({ type:'error', title:'Ошибка анализа', msg: data.result || 'Неизвестная ошибка' })
          setAId(null)
        }
      } catch (e) {}
    }, POLL_MS)
  }

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setBusy(false)
    setStart(null)
  }

  // ─── Запуск анализа ─────────────────────────────────────────────────────────
  // «Анализировать»: кладём в очередь и сразу отправляем, ждём результат здесь.
  // Очередь — единый источник правды: даже при потере ответа замер не пропадёт.
  const runAnalysis = async () => {
    if (busy || submittingRef.current) return
    if (!photos.length) { setStatus({ type:'error', title:'Нет фото', msg:'Добавьте хотя бы одно фото' }); return }

    submittingRef.current = true
    setBusy(true)
    setStatus(null)
    setResult(null)
    setGlbUrl(null)
    setPlyUrl(null)
    setShowRaw(false)

    const payload = photos.map(p => ({ blob: p.blob, name: p.name, exif: p.exifData ?? null }))

    let id
    try {
      id = await enqueue({ title, notes, isProd, photos: payload })
    } catch (err) {
      submittingRef.current = false
      setBusy(false)
      setStatus({ type:'error', title:'Ошибка сохранения', msg: err.message })
      return
    }

    try {
      const serverId = await flushItem(id)     // POST сейчас
      setAId(serverId)
      setStart(Date.now())
      startPolling(serverId)                    // ждём готовности на странице
    } catch (err) {
      // Сеть пропала — замер уже в очереди и уйдёт сам. Не крутим спиннер.
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

    submittingRef.current = true
    try {
      const payload = photos.map(p => ({ blob: p.blob, name: p.name, exif: p.exifData ?? null }))
      let id
      try {
        id = await enqueue({ title, notes, isProd, photos: payload })
      } catch (err) {
        setStatus({ type:'error', title:'Ошибка', msg: err.message })
        return
      }
      flushItem(id).catch(() => {})   // пробуем отправить фоном, но не ждём

      setStatus({ type:'success', title:'В очереди', msg:'Замер добавлен — отправим автоматически при связи.' })
      setPhotos([])
      setTitle('')
      setNotes('')
    } finally {
      submittingRef.current = false
    }
  }

  const reset = () => {
    if (busy) { stopPolling() }
    setPhotos([])
    setTitle('')
    setNotes('')
    setStatus(null)
    setResult(null)
    setGlbUrl(null)
    setPlyUrl(null)
    setAId(null)
    setCompProg(0)
    setReportOpen(false)
    setShowRaw(false)
  }

  const copyResult = () => {
    if (!result) return
    navigator.clipboard.writeText(result).catch(() => {})
  }

  const totalKb = photos.reduce((s, p) => s + p.sizeKb, 0)
  const sizeStr = totalKb > 1024 ? `${(totalKb/1024).toFixed(1)} МБ` : `${totalKb} КБ`
  const has3d   = plyUrl || glbUrl

  // Текущий шаг процесса — выводится из состояния, без отдельного state.
  const currentStep = (result || has3d) ? 3 : busy ? 2 : 1

  return (
    <div className="page content" style={{ paddingTop: 0 }}>

      {/* HERO */}
      <div className="hero">
        <div className="badge">
          <span className="badge-dot" />
          КАРЕЛИЯ · ФОТОГРАММЕТРИЯ · 2026
        </div>
        <h1>Фото — и готов<em>материал, объём и вес</em></h1>
        <p>Загрузите фото строительного материала — система построит 3D-модель, определит тип, объём и приблизительный вес.</p>

        {/* Реальная последовательность процесса — подсветка текущего шага */}
        <div className="steps">
          {STEPS.map((label, i) => {
            const n = i + 1
            const state = n < currentStep ? 'done' : n === currentStep ? 'active' : 'todo'
            return (
              <Fragment key={n}>
                {i > 0 && (
                  <span className={`step-arr ${n <= currentStep ? 'is-passed' : ''}`}>→</span>
                )}
                <div className={`step is-${state}`}>
                  <span className="step-n">
                    {state === 'done' ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    ) : n}
                  </span>
                  {label}
                </div>
              </Fragment>
            )
          })}
        </div>
      </div>

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

          {/* ПРОГРЕСС СЖАТИЯ */}
          {compressing && (
            <div className="status info" style={{ display:'block' }}>
              <strong>Обработка фотографий</strong>
              {compMsg}
              <div className="prog-wrap"><div className="prog-bar" style={{ width:`${compProg}%` }} /></div>
            </div>
          )}

          {photos.length > 0 && (
            <div className="thumbs">
              {photos.map((p, i) => (
                <div key={i} className="thumb">
                  <img src={p.dataUrl} alt="" />
                  <span className="thumb-n">{i + 1}</span>
                  {p.exifData?.latitude && (
                    <span
                      className="thumb-geo"
                      title={`${Number(p.exifData.latitude.toFixed(5))}, ${Number(p.exifData.longitude.toFixed(5))}`}
                    >📍</span>
                  )}
                  <button className="thumb-rm" onClick={e => { e.stopPropagation(); removePhoto(i) }}>✕</button>
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

          {/* ПЕРЕКЛЮЧАТЕЛЬ TEST/PROD — нужен, пока продукт не вышел в прод */}
          <div className="field" style={{ marginTop:'4px' }}>
            <label style={{ fontSize:'12px', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.5px' }}>Режим анализа</label>
            <div className="mode-toggle">
              <button
                type="button"
                className={`test ${!isProd ? 'active' : ''}`}
                disabled={busy}
                onClick={() => !busy && setIsProd(false)}
              >
                TEST
              </button>
              <button
                type="button"
                className={`prod ${isProd ? 'active' : ''}`}
                disabled={busy}
                onClick={() => !busy && setIsProd(true)}
              >
                PROD
              </button>
            </div>
          </div>

          {/* Баннер офлайна — подсказываем, что можно снять и поставить в очередь */}
          {!online && (
            <div className="status info" style={{ display:'block', marginTop:'16px' }}>
              <strong>Нет сети.</strong> Снимите замер и добавьте в очередь — отправим сами, когда связь вернётся.
            </div>
          )}

          <div className="actions" style={{ marginTop:'24px' }}>
            <button className="btn btn-primary" onClick={runAnalysis} disabled={busy}>
              {busy
                ? <><div className="spinner" /> {isGtc ? 'ВЫЗЫВАЕМ…' : 'Анализируем...'}</>
                : (online ? 'Запустить анализ' : 'Отправить (в очередь)')}
            </button>
            <button className="btn btn-secondary" onClick={addToQueue} disabled={busy} title="Сохранить и отправить в фоне">
              В очередь
            </button>
            <button className="btn btn-secondary" onClick={reset}>Сбросить</button>
          </div>

          {busy && startTime && <Timer startTime={startTime} />}

          {status && (
            <div className={`status ${status.type}`}>
              <strong>{status.title}</strong> {status.msg}
            </div>
          )}

          {/* РЕЗУЛЬТАТ */}
          {(result || has3d) && (
            <div className="result-card">
              <div className="result-hd">
                <span className="result-hd-title">Результат · {isProd ? 'PROD' : 'TEST'}</span>
                {result && (
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <button className="copy-btn" onClick={copyResult}>Копировать</button>
                    <button className="copy-btn" onClick={() => setReportOpen(true)}>Открыть отчёт</button>
                  </div>
                )}
              </div>

              {/* Структурированная сводка — вместо сырого дампа пайплайна.
                  Метрики в ячейках, материал засечками, масса с золотым
                  акцентом. Служебные поля пайплайна — под тогглом. */}
              {result && hasSummary && (
                <div className="rs">
                  <div className="rs-grid">
                    <div className="rs-cell">
                      <span>Материал</span>
                      <b className="rs-mat">{parsed.material || '—'}</b>
                    </div>
                    <div className="rs-cell">
                      <span>Объём, м³</span>
                      <b>{parsed.volume}</b>
                    </div>
                    <div className="rs-cell">
                      <span>Плотность, кг/м³</span>
                      <b>{parsed.density}</b>
                    </div>
                    <div className="rs-cell rs-cell--accent">
                      <span>Масса, т</span>
                      <b>{parsed.mass}</b>
                    </div>
                  </div>
                  <div className="rs-meta">
                    Исходных кадров: {parsed.framesUsed ?? '—'}
                  </div>
                  <button
                    type="button"
                    className="rs-raw-toggle"
                    onClick={() => setShowRaw(v => !v)}
                  >
                    <svg
                      width="12" height="12" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: showRaw ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}
                    >
                      <path d="m6 9 6 6 6-6"/>
                    </svg>
                    {showRaw ? 'Скрыть технические данные' : 'Технические данные'}
                  </button>
                  {showRaw && (
                    <div className="rs-raw">{result}</div>
                  )}
                </div>
              )}

              {/* Фоллбэк: если из текста не вытащились ни объём, ни материал —
                  показываем как раньше, чтобы ничего не потерять */}
              {result && !hasSummary && (
                <div className="result-body">{result}</div>
              )}

              {/* 3D-модель — показывается по наличию модели, а не по тексту */}
              {has3d && (
                <div style={{ padding:'0 18px 18px' }}>
                  <div className="divider" style={{ marginTop: result ? '4px' : '16px' }}>
                    <div className="div-line" />
                    <span className="div-txt">Визуализация объёма</span>
                    <div className="div-line" />
                  </div>
                  <PlyViewer plyUrl={plyUrl} glbUrl={glbUrl} />
                </div>
              )}

              {/* Текст есть, а модели нет — мягкая подсказка вместо красного блока */}
              {result && !has3d && (
                <div style={{ padding:'0 18px 16px', fontSize:'12px', color:'var(--muted)' }}>
                  3D-модель для этого анализа недоступна.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* выдвижное окно отчёта (рендерится порталом в body) */}
      {result && (
        <ReportPanel
          open={reportOpen}
          onOpen={() => setReportOpen(true)}
          onClose={() => setReportOpen(false)}
          result={result}
          photos={photos}
          title={title}
        />
      )}
    </div>
  )
}
