import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useTheme } from '../theme/ThemeProvider'
import RaschetDownloadButton, { parseWebhookResult } from '../components/RaschetDownloadButton'
import { analysisNo, splitMaterial, DASH } from '../components/archive/archiveData'
import { ART } from '../components/archive/ArcPlate'

/* ============================================================
   Reports — раздел «04 ОТЧЁТЫ».
   ------------------------------------------------------------
   Собирает отчёты-расчёты по всем ЗАВЕРШЁННЫМ замерам
   пользователя. Отдельной таблицы отчётов в базе нет и заводить
   её не потребовалось: расчёт — это производная от замера, PDF
   собирается на клиенте из `result` (components/raschet/*). То
   есть список отчётов — это список готовых анализов, а кнопка
   рядом с каждым собирает документ по требованию.

   Следствие, про которое стоит знать: «отчёт» появляется здесь
   ровно тогда, когда анализ дошёл до status='completed' и в нём
   есть объём или материал. Замер в обработке отчётом ещё не стал.
   ============================================================ */

const pad3 = (n) => String(n).padStart(3, '0')
const pad2 = (n) => String(n).padStart(2, '0')

const fmtDate = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(+d)
    ? DASH
    : `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`
}

export default function Reports() {
  const { isArchive } = useTheme()
  const [items, setItems]   = useState([])
  const [loading, setLoad]  = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    let alive = true
    api.listAnalyses()
      .then((data) => {
        if (!alive) return
        setItems(Array.isArray(data) ? data : data?.items || [])
        setError(null)
      })
      .catch((e) => alive && setError(e?.message || 'Не удалось загрузить отчёты'))
      .finally(() => alive && setLoad(false))
    return () => { alive = false }
  }, [])

  const rows = useMemo(() => items
    .filter((it) => it.status === 'completed')
    .map((it) => {
      const parsed = parseWebhookResult(it.result)
      return { it, parsed, mat: splitMaterial(parsed.material) }
    })
    .filter(({ parsed }) => parsed._volumeNum != null || parsed.material)
    .sort((a, b) => new Date(b.it.created_at) - new Date(a.it.created_at)),
    [items],
  )

  /* ── тема «Архив» ──────────────────────────────────────────── */
  if (isArchive) {
    return (
      <div className="arc-page">
        <section className="arc-head">
          <span className="arc-head__no" aria-hidden="true">04</span>
          <div className="arc-head__text">
            <h1 className="arc-head__h1">ОТЧЁТЫ</h1>
            <p className="arc-head__sub">расчёты по завершённым замерам</p>
            <p className="arc-head__lead">
              Документ собирается по требованию из данных замера: объём, материал,
              плотность, масса и кадры съёмки. Замер в обработке отчётом ещё не стал.
            </p>
          </div>
          <figure className="arc-head__aside arc-plateshot">
            <img className="arc-art" src={ART.manual} alt="" loading="lazy" />
            <figcaption>ЛИСТ ОБМЕРА · СПРАВОЧНИК · ОБРАЗЕЦ ФОРМЫ</figcaption>
          </figure>
        </section>

        <div className="arc-tab" role="table" aria-label="Отчёты">
          <div className="arc-tab__hd arc-tab__hd--rep" role="row">
            <span role="columnheader">НОМЕР</span>
            <span role="columnheader">ОБЪЕКТ</span>
            <span role="columnheader" className="arc-tab__r">ОБЪЁМ</span>
            <span role="columnheader" className="arc-tab__r">МАССА</span>
            <span role="columnheader" className="arc-tab__r">ДАТА</span>
            <span role="columnheader" className="arc-tab__r">ДОКУМЕНТ</span>
          </div>

          {loading && <div className="arc-tab__msg">ЧТЕНИЕ ОТЧЁТОВ…</div>}
          {!loading && error && <div className="arc-tab__msg is-bad">{String(error).toUpperCase()}</div>}
          {!loading && !error && !rows.length && (
            <div className="arc-tab__msg">ОТЧЁТОВ НЕТ — НИ ОДИН ЗАМЕР ЕЩЁ НЕ ЗАВЕРШЁН</div>
          )}

          {rows.map(({ it, parsed, mat }, i) => (
            <div key={it.id} className="arc-tab__item">
              <div className="arc-tab__row arc-tab__row--rep" role="row">
                <span role="cell" className="arc-tab__no">{pad3(i + 1)}</span>
                <span role="cell" className="arc-tab__mat">
                  {(it.title || mat.name || 'БЕЗ НАЗВАНИЯ').toUpperCase()}
                </span>
                <span role="cell" className="arc-tab__r">{parsed.volume ?? DASH} <i>м³</i></span>
                <span role="cell" className="arc-tab__r">{parsed.mass ?? DASH} <i>т</i></span>
                <span role="cell" className="arc-tab__r arc-tab__date">{fmtDate(it.created_at)}</span>
                <span role="cell" className="arc-tab__r">
                  <RaschetDownloadButton
                    result={it.result}
                    photos={it.thumbnail_urls || it.photo_urls || []}
                    title={it.title || mat.name || ''}
                    docNo={analysisNo(it.id) || undefined}
                    className="arc-btn arc-btn--chip"
                  />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  /* ── светлая / тёмная тема: тот же список обычной вёрсткой ── */
  return (
    <div className="page content">
      <h1 className="page-title">Отчёты</h1>
      {loading && <p style={{ color: 'var(--muted)' }}>Загрузка…</p>}
      {!loading && error && <p style={{ color: 'var(--err)' }}>{error}</p>}
      {!loading && !error && !rows.length && (
        <p style={{ color: 'var(--muted)' }}>Отчётов пока нет — ни один замер не завершён.</p>
      )}
      {rows.map(({ it, parsed, mat }) => (
        <div key={it.id} className="card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <strong>{it.title || mat.name || 'Без названия'}</strong>
              <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>
                {parsed.volume ?? '—'} м³ · {parsed.mass ?? '—'} т · {fmtDate(it.created_at)}
              </div>
            </div>
            <RaschetDownloadButton
              result={it.result}
              photos={it.thumbnail_urls || it.photo_urls || []}
              title={it.title || mat.name || ''}
              docNo={analysisNo(it.id) || undefined}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
