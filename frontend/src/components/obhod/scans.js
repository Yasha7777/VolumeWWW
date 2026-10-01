import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { DEMO_OBHODS, DEMO_CLOUDS } from './demo'

export const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const pad = (n) => String(n).padStart(2, '0')
const fmtDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
const fmtShort = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
const fmtDay = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
const fmtDur = (s) => (s == null ? null : `${pad(Math.floor(s / 60))}:${pad(Math.round(s % 60))}`)

const STATUS = {
  ready:     { label: 'Готов',     ready: true },
  uploading: { label: 'Загрузка',  ready: false },
  failed:    { label: 'Ошибка',    ready: false },
}

// приложение до 5.0 называло обход по-английски: «Обход 26 Sep at 19:17» —
// такие авто-названия показываем по-русски, свои названия не трогаем
const EN_AUTO = /^Обход\s.*\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b.*\bat\b/
const niceTitle = (t, d) => (!t ? 'Без названия' : EN_AUTO.test(t) && !isNaN(d) ? `Обход ${fmtShort(d)}` : t)

// строка /api/scans/ → карточка
export function normalizeScan(r) {
  const d = new Date(r.captured_at)
  const st = STATUS[r.status] || { label: r.status, ready: false }
  const place = r.author_city || (r.lat != null && r.lon != null ? `${r.lat.toFixed(3)}°, ${r.lon.toFixed(3)}°` : null)
  return {
    id: r.id,
    title: niceTitle(r.title, d),
    date: fmtDate(d), dateShort: fmtShort(d),
    photos: r.frame_count,
    duration: fmtDur(r.duration_s), durationS: r.duration_s,
    // в «Анализе» — только свои обходы; имя не заполнено в профиле → «Вы»
    author: r.author_name || 'Вы',
    place,
    device: ['ARKit', r.device_model].filter(Boolean).join(' · '),
    status: st.label, statusKey: r.status, ready: st.ready,
    img: r.cover_url || null,
    lat: r.lat, lon: r.lon, acc: r.loc_accuracy_m,
    lastAnalysis: r.last_analysis || null,
  }
}

// Периоды по кругу: текущий месяц → последние 30 дней → всё время
export function makePeriods(now = new Date()) {
  // «по сегодня»: правая граница — конец текущего дня, а не конец месяца
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const d30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)
  return [
    { key: 'month', label: `${fmtDay(m0)} — ${fmtDay(now)}`, from: m0.toISOString(), to: end.toISOString() },
    { key: '30d', label: `${fmtDay(d30)} — ${fmtDay(now)}`, from: d30.toISOString(), to: end.toISOString() },
    { key: 'all', label: 'За всё время', from: null, to: null },
  ]
}

// периоды пересчитываются, когда сменились сутки (вкладку могли оставить
// открытой на ночь): проверка при возврате во вкладку и раз в минуту
export function usePeriods() {
  const [periods, setPeriods] = useState(() => makePeriods())
  useEffect(() => {
    const check = () => {
      const fresh = makePeriods()
      setPeriods((old) => (old[0].label === fresh[0].label && old[1].label === fresh[1].label ? old : fresh))
    }
    const t = setInterval(check, 60e3)
    const vis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', vis); window.addEventListener('focus', check)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', check) }
  }, [])
  return periods
}

export function useScans(period, demo) {
  const [state, setState] = useState({ items: demo ? DEMO_OBHODS : [], loading: !demo, error: null })
  const load = useCallback(async () => {
    if (demo) { setState({ items: DEMO_OBHODS, loading: false, error: null }); return }
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const rows = await api.listScans({ from: period?.from, to: period?.to })
      setState({ items: (rows || []).map(normalizeScan), loading: false, error: null })
    } catch (e) {
      setState({ items: [], loading: false, error: e?.message || 'Ошибка сервера' })
    }
  }, [demo, period?.from, period?.to])
  useEffect(() => { load() }, [load])
  // обход, отправленный с телефона, пока страница открыта, — подтягиваем при
  // возвращении во вкладку и раз в минуту (без мигания: loading не включаем)
  useEffect(() => {
    if (demo) return
    const quiet = async () => {
      if (document.hidden) return
      try {
        const rows = await api.listScans({ from: period?.from, to: period?.to })
        setState((s) => ({ ...s, items: (rows || []).map(normalizeScan), error: null }))
      } catch (_) { /* тихий опрос: ошибку покажет следующий явный запрос */ }
    }
    const onVis = () => { if (!document.hidden) quiet() }
    document.addEventListener('visibilitychange', onVis)
    const id = setInterval(quiet, 60000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(id) }
  }, [demo, period?.from, period?.to])
  return { ...state, reload: load }
}

// Траектория обхода (метры, вид сверху) для карты. Кэш на сессию страницы.
const trackCache = new Map()
export function useTrack(scan, demo) {
  const [st, setSt] = useState({ track: null, loading: false })
  useEffect(() => {
    if (demo || !scan) { setSt({ track: null, loading: false }); return }
    const hit = trackCache.get(scan.id)
    if (hit) { setSt({ track: hit, loading: false }); return }
    let alive = true
    setSt({ track: null, loading: true })
    api.getScanTrack(scan.id)
      .then((t) => {
        const track = {
          points: t?.points || [], frames: t?.frames || [], geo: t?.geo || null,
          lat: scan.lat, lon: scan.lon, acc: scan.acc,
          frameCount: scan.photos, duration: scan.durationS,
        }
        trackCache.set(scan.id, track)
        if (alive) setSt({ track, loading: false })
      })
      .catch(() => { if (alive) setSt({ track: null, loading: false }) })
    return () => { alive = false }
  }, [scan?.id, demo])
  return st
}

/* Облако точек для вкладки 3D. Демо — плотная реконструкция из набора.
   Реальный обход — разреженные точки ARKit и позиции камеры из scan.json
   (GET /api/scans/{id}/cloud); после анализа сюда можно подставить плотное облако. */
const cloudCache = new Map()
export function useCloud(scan, demo) {
  const [cloud, setCloud] = useState(null)
  useEffect(() => {
    // обход не выбран — показываем эталонную кучу как пример того, что будет
    if (!scan) { setCloud({ ...DEMO_CLOUDS.o1, title: 'Пример: отсев, эталон 178 м³' }); return }
    if (demo) {
      setCloud(DEMO_CLOUDS[scan.id] || { empty: 'Для этого обхода в демо нет облака — выберите «Отсев у склада №3»' })
      return
    }
    const hit = cloudCache.get(scan.id)
    if (hit) { setCloud(hit); return }
    let alive = true
    setCloud(null)
    api.getScanCloud(scan.id)
      .then((c) => {
        const n = c?.points?.length || 0
        const v = n
          ? { data: { points: c.points, cameras: c.cameras || null }, title: scan.title, meta: `Облако ARKit · ${n.toLocaleString('ru-RU')} точек · ${c.cameras?.length || 0} кадров` }
          : { empty: 'В этом обходе нет точек ARKit' }
        cloudCache.set(scan.id, v)
        if (alive) setCloud(v)
      })
      .catch(() => { if (alive) setCloud({ empty: 'Облако точек пока недоступно' }) })
    return () => { alive = false }
  }, [scan?.id, demo])
  return cloud
}
