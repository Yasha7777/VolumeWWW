import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

/* Период в панели выбора обхода. По умолчанию — «За всё время».
   Клик открывает календарь: первый клик по дню — начало, второй — конец
   (порядок не важен), после второго период применяется и календарь закрывается.
   Быстрые варианты сверху. Будущие дни недоступны. Значение — { from, to }
   (Date начала первого дня и конца последнего) или null = за всё время. */

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const pad = (n) => String(n).padStart(2, '0')
const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const dayEnd = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
const same = (a, b) => a && b && a.getTime() === b.getTime()
export const fmtDay = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`

export function periodLabel(v) {
  if (!v) return 'За всё время'
  return same(day0(v.from), day0(v.to)) ? fmtDay(v.from) : `${fmtDay(v.from)} — ${fmtDay(v.to)}`
}
// для API: ISO-границы или null
export const periodQuery = (v) => (v ? { from: v.from.toISOString(), to: v.to.toISOString() } : { from: null, to: null })

const range = (a, b) => (a <= b ? { from: day0(a), to: dayEnd(b) } : { from: day0(b), to: dayEnd(a) })

function presets() {
  const t = day0(new Date())
  return [
    { key: 'all', label: 'За всё время', value: null },
    { key: 'month', label: 'Этот месяц', value: range(new Date(t.getFullYear(), t.getMonth(), 1), t) },
    { key: '30', label: '30 дней', value: range(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 29), t) },
    { key: '7', label: '7 дней', value: range(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6), t) },
  ]
}

export default function PeriodPicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(null)     // выбран первый день, ждём второй
  const [hover, setHover] = useState(null)
  const [view, setView] = useState(() => { const d = value?.to || new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const box = useRef(null)
  const today = day0(new Date())

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    // Esc закрывает только календарь: preventDefault — чтобы панель выбора не свернулась
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [open])

  const toggle = () => {
    if (!open) {
      const d = value?.to || new Date()
      setView(new Date(d.getFullYear(), d.getMonth(), 1)); setStart(null); setHover(null)
    }
    setOpen((o) => !o)
  }
  const apply = (v) => { onChange(v); setOpen(false); setStart(null); setHover(null) }
  const pick = (d) => { if (!start) setStart(d); else apply(range(start, d)) }

  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1)
    const lead = (first.getDay() + 6) % 7
    const n = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
    const out = []
    for (let i = 0; i < lead; i++) out.push(null)
    for (let i = 1; i <= n; i++) out.push(new Date(view.getFullYear(), view.getMonth(), i))
    while (out.length % 7) out.push(null)
    return out
  }, [view])

  // что подсвечивать: выбор в процессе (start…hover) или текущий период
  const shown = start ? range(start, hover || start) : value
  const nextOff = view.getFullYear() > today.getFullYear() || (view.getFullYear() === today.getFullYear() && view.getMonth() >= today.getMonth())
  const shift = (k) => setView((v) => new Date(v.getFullYear(), v.getMonth() + k, 1))
  const ps = presets()
  const activeKey = ps.find((p) => (p.value === null ? value === null : value && same(p.value.from, value.from) && same(day0(p.value.to), day0(value.to))))?.key

  return (
    <div className="ks-period-wrap" ref={box}>
      <button className={'ks-period' + (open ? ' is-open' : '')} type="button" onClick={toggle} title="Выбрать период" disabled={disabled} aria-expanded={open} aria-haspopup="dialog">
        <CalendarDays size={16} strokeWidth={1.6} />
        <span className="ks-period__label">Период</span>
        <span className="ks-period__value">{periodLabel(value)}</span>
        <ChevronDown size={15} strokeWidth={1.8} className="ks-period__chev" />
      </button>
      {open && (
        <div className="ks-cal" role="dialog" aria-label="Выбор периода">
          <div className="ks-cal__presets">
            {ps.map((p) => (
              <button key={p.key} type="button" className={'ks-cal__preset' + (activeKey === p.key && !start ? ' is-on' : '')} onClick={() => apply(p.value)}>{p.label}</button>
            ))}
          </div>
          <div className="ks-cal__nav">
            <button type="button" className="ks-cal__arrow" onClick={() => shift(-1)} aria-label="Предыдущий месяц"><ChevronLeft size={16} strokeWidth={1.8} /></button>
            <span className="ks-cal__month">{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
            <button type="button" className="ks-cal__arrow" onClick={() => shift(1)} disabled={nextOff} aria-label="Следующий месяц"><ChevronRight size={16} strokeWidth={1.8} /></button>
          </div>
          <div className="ks-cal__grid" onPointerLeave={() => setHover(null)}>
            {WD.map((w) => <span key={w} className="ks-cal__wd">{w}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={i} />
              const future = d > today
              const inR = shown && d >= day0(shown.from) && d <= shown.to
              const edge = shown && (same(d, day0(shown.from)) || same(d, day0(shown.to)))
              const cls = 'ks-cal__day' + (inR ? ' is-in' : '') + (edge ? ' is-edge' : '') + (same(d, today) ? ' is-today' : '')
              return (
                <button key={i} type="button" className={cls} disabled={future}
                  onClick={() => pick(d)} onPointerEnter={() => start && setHover(d)}>
                  {d.getDate()}
                </button>
              )
            })}
          </div>
          <div className="ks-cal__hint">{start ? `С ${fmtDay(start)} — выберите последний день` : 'Выберите первый и последний день'}</div>
        </div>
      )}
    </div>
  )
}
