import { useEffect, useState } from 'react'

const MAX_SECONDS = 3600

export default function Timer({ startTime }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const tick = () => {
      const s = Math.floor((Date.now() - startTime) / 1000)
      setElapsed(Math.min(s, MAX_SECONDS))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startTime])

  const pct = Math.min((elapsed / MAX_SECONDS) * 100, 100)
  const h   = Math.floor(elapsed / 3600)
  const m   = Math.floor((elapsed % 3600) / 60)
  const s   = elapsed % 60

  const fmt = h > 0
    ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`

  const stage = elapsed < 30
    ? 'Загрузка фото...'
    : elapsed < 90
    ? 'CLIP строит эмбеддинги...'
    : elapsed < 180
    ? 'Поиск похожих объектов в БД...'
    : elapsed < 360
    ? 'AI анализирует изображение...'
    : 'Вычисление объёма и веса...'

  return (
    <div className="timer-box">
      <div className="timer-label">{stage}</div>
      <div className="timer-clock">{fmt}</div>
      <div className="timer-max">максимум 60:00</div>

      {/* Прогресс-дуга */}
      <div className="prog-wrap" style={{ width: '100%', marginTop: 10 }}>
        <div className="prog-bar" style={{ width: `${pct}%` }} />
      </div>

      <div className="timer-dots">
        <div className="timer-dot" />
        <div className="timer-dot" />
        <div className="timer-dot" />
      </div>
    </div>
  )
}
