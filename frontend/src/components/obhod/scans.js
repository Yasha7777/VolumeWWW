import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { DEMO_OBHODS } from './demo'

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

// строка /api/scans/ → карточка
export function normalizeScan(r) {
  const d = new Date(r.captured_at)
  const st = STATUS[r.status] || { label: r.status, ready: false }
  const place = r.author_city || (r.lat != null && r.lon != null ? `${r.lat.toFixed(3)}°, ${r.lon.toFixed(3)}°` : null)
  return {
    id: r.id,
    title: r.title || 'Без названия',
    date: fmtDate(d), dateShort: fmtShort(d),
    photos: r.frame_count,
    duration: fmtDur(r.duration_s),
    author: r.author_name,
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
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1)
  const m1 = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  const d30 = new Date(now.getTime() - 30 * 864e5)
  return [
    { key: 'month', label: `${fmtDay(m0)} — ${fmtDay(m1)}`, from: m0.toISOString(), to: m1.toISOString() },
    { key: '30d', label: `${fmtDay(d30)} — ${fmtDay(now)}`, from: d30.toISOString(), to: now.toISOString() },
    { key: 'all', label: 'За всё время', from: null, to: null },
  ]
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
        const track = { points: t?.points || [], lat: scan.lat, lon: scan.lon, acc: scan.acc }
        trackCache.set(scan.id, track)
        if (alive) setSt({ track, loading: false })
      })
      .catch(() => { if (alive) setSt({ track: null, loading: false }) })
    return () => { alive = false }
  }, [scan?.id, demo])
  return st
}
