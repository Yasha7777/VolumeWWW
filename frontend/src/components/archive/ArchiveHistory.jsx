import { useMemo, useState } from 'react'
import PlyViewer from '../PlyViewer'
import ViewerErrorBoundary from '../ViewerErrorBoundary'
import { DiagnosticsBlock } from '../Diagnostics'
import Win from './Win'
import Barcode from './Barcode'
import { analysisNo, extraMetrics, splitMaterial, DASH } from './archiveData'

/* ============================================================
   ArchiveHistory — экран 02 АРХИВ в теме «Архив».
   ------------------------------------------------------------
   Слой представления над pages/History.jsx: строки приезжают
   уже отфильтрованными и посчитанными, здесь только вёрстка,
   раскрытие скан-листа и «осмотр» записи.

   Отличия от макета — по одной причине, всегда одной: числа,
   которых у приложения нет, не выдумываются. Достоверность
   показывается, если пайплайн её прислал, иначе прочерк.
   ============================================================ */

const pad3 = (n) => String(n).padStart(3, '0')
const pad2 = (n) => String(n).padStart(2, '0')

const fmtDate = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(+d)
    ? DASH
    : `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`
}

const num = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : null)

/* ── скан-лист: раскрывается под записью ─────────────────────── */
function ScanSheet({ row, no, onInspect }) {
  const thumbs = (row.thumbs?.length ? row.thumbs : row.photos || []).slice(0, 3)
  const extra  = useMemo(() => extraMetrics(row.raw?.result), [row.raw?.result])
  const shots  = row.photos?.length || 0

  return (
    <div className="arc-scan">
      <div className="arc-scan__films">
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className="arc-scan__film">
            {thumbs[i]
              ? <img src={thumbs[i]} alt="" loading="lazy" />
              : <i className="arc-scan__empty" aria-hidden="true" />}
          </span>
        ))}
      </div>

      <div className="arc-scan__data">
        <div><span>СКАН</span><b>{no} / {pad2(shots)} {shots === 1 ? 'СНИМОК' : 'СНИМКА'}</b></div>
        <div><span>ДОСТОВЕРНОСТЬ</span><b>{extra.confidence != null ? extra.confidence.toFixed(2) : DASH}</b></div>
        <div>
          <span>КАЛИБРОВОЧНЫЙ КУБ</span>
          <b className={row.volume != null ? '' : 'is-bad'}>{row.volume != null ? '✓' : DASH}</b>
        </div>
        <div><span>НОМЕР</span><b>{analysisNo(row.id) || DASH}</b></div>
      </div>

      <button type="button" className="arc-btn arc-btn--chip" onClick={onInspect}>
        [ОСМОТР]
      </button>
    </div>
  )
}

/* ── окно осмотра записи ─────────────────────────────────────── */
function Inspect({ row, detail, onClose }) {
  const parsedMat = splitMaterial(row.material)
  const extra = useMemo(() => extraMetrics(row.raw?.result), [row.raw?.result])
  const has3d = !!(detail?.plyUrl || detail?.glbUrl)

  return (
    <Win
      name={`ОСМОТР_${(analysisNo(row.id) || 'ЗАПИСИ').replace('-', '_')}.ПРГ`}
      meta={fmtDate(row.date)}
      className="arc-inspect"
    >
      <div className="arc-inspect__grid">
        <div className="arc-dos__col">
          <div className="arc-dos__k">ИЗМЕРЕННЫЙ ОБЪЁМ</div>
          <div className="arc-dos__big">{num(row.volume) ?? DASH}</div>
          <div className="arc-dos__unit">м³</div>
          <div className="arc-dos__rows">
            <div className="arc-dos__row"><span>МАТЕРИАЛ</span><b>{parsedMat.name?.toUpperCase() || DASH}</b></div>
            <div className="arc-dos__row"><span>ФРАКЦИЯ</span><b>{parsedMat.fraction || DASH}</b></div>
            <div className="arc-dos__row"><span>СНИМКОВ</span><b>{pad2(row.photos?.length || 0)}</b></div>
            <div className="arc-dos__row">
              <span>ДОСТОВЕРНОСТЬ</span>
              <b className="arc-blue">{extra.confidence != null ? extra.confidence.toFixed(2) : DASH}</b>
            </div>
          </div>
        </div>

        <div className="arc-dos__col">
          <div className="arc-dos__k">ОЦЕНКА МАССЫ</div>
          <div className="arc-dos__big arc-dos__big--green">{num(row.weight, 1) ?? DASH}</div>
          <div className="arc-dos__unit">т</div>
          <div className="arc-dos__rows">
            <div className="arc-dos__row"><span>ЗАПИСЬ ОТ</span><b>{fmtDate(row.date)}</b></div>
            <div className="arc-dos__row"><span>НОМЕР АНАЛИЗА</span><b className="arc-amber">{analysisNo(row.id) || DASH}</b></div>
            <div className="arc-dos__row">
              <span>ВЫСОТА</span>
              <b>{extra.height != null ? `${extra.height.toFixed(2)} м` : DASH}</b>
            </div>
            <div className="arc-dos__row">
              <span>ПЛОЩАДЬ ОСНОВАНИЯ</span>
              <b>{extra.baseArea != null ? `${extra.baseArea.toFixed(1)} м²` : DASH}</b>
            </div>
          </div>
        </div>

        <div className="arc-dos__view">
          <div className="arc-dos__viewhd">ВОССТАНОВЛЕННАЯ ГЕОМЕТРИЯ</div>
          <div className="arc-blueprint">
            {has3d ? (
              <ViewerErrorBoundary>
                <PlyViewer
                  plyUrl={detail.plyUrl} glbUrl={detail.glbUrl}
                  up={detail.up} upGlb={detail.upGlb}
                />
              </ViewerErrorBoundary>
            ) : (
              <div className="arc-plate">
                <span className="arc-plate__ico" aria-hidden="true" />
                ТРЁХМЕРНАЯ МОДЕЛЬ НЕ СОХРАНЕНА
              </div>
            )}
            <span className="arc-blueprint__tag">[ВРАЩАТЬ]</span>
          </div>
          <Barcode caption={`${analysisNo(row.id) || 'ЗАПИСЬ'} · 2026`} />
        </div>
      </div>

      {detail?.diag && (
        <div className="arc-dos__diag"><DiagnosticsBlock diag={detail.diag} /></div>
      )}

      <div className="arc-actions arc-actions--sub">
        <button type="button" className="arc-btn arc-btn--ghost" onClick={onClose}>ЗАКРЫТЬ ОСМОТР</button>
      </div>
    </Win>
  )
}

/* ============================================================ */
export default function ArchiveHistory({
  rows, sumVol, sumWeight, loading, error,
  onRefresh, getDetail, query, setQuery,
}) {
  const [openId, setOpenId]     = useState(null)   // раскрытый скан-лист
  const [inspectId, setInspect] = useState(null)   // окно осмотра

  const opened  = rows.find((r) => r.id === inspectId) || null
  const detail  = opened && getDetail ? getDetail(opened.raw) : null
  const lastAt  = rows.length ? rows[0].date : null

  return (
    <div className="arc-page">
      {/* ═══ ШАПКА АРХИВА ════════════════════════════════════ */}
      <section className="arc-arch__top">
        <div className="arc-blueprint arc-blueprint--wide">
          <div className="arc-plate">
            <span className="arc-plate__ico" aria-hidden="true" />
            АРХИВНЫЙ СНИМОК СКЛАДА
          </div>
          <span className="arc-blueprint__cap">СКЛАДСКАЯ ПЛОЩАДКА · {new Date().getFullYear()}</span>
          <span className="arc-blueprint__corner arc-blueprint__corner--tl" aria-hidden="true" />
          <span className="arc-blueprint__corner arc-blueprint__corner--br" aria-hidden="true" />
        </div>

        <div className="arc-arch__sum">
          <Barcode />
          <div className="arc-kv arc-kv--big">
            <div><span>ЗАПИСЕЙ В АРХИВЕ</span><b>{pad2(rows.length)}</b></div>
            <div><span>СУММАРНЫЙ ОБЪЁМ</span><b>{num(sumVol) ?? DASH} м³</b></div>
            <div><span>СУММАРНАЯ МАССА</span><b>{num(sumWeight, 1) ?? DASH} т</b></div>
            <div><span>ПОСЛЕДНЯЯ ЗАПИСЬ</span><b>{lastAt ? fmtDate(lastAt) : DASH}</b></div>
          </div>
          <div className="arc-arch__tools">
            <input
              className="arc-input arc-input--find"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ПОИСК ПО АРХИВУ"
              aria-label="Поиск по архиву"
            />
            <button type="button" className="arc-btn arc-btn--chip" onClick={onRefresh}>
              ОБНОВИТЬ
            </button>
          </div>
        </div>
      </section>

      {/* ═══ ТАБЛИЦА ═════════════════════════════════════════ */}
      <div className="arc-tab" role="table" aria-label="Записи архива">
        <div className="arc-tab__hd" role="row">
          <span role="columnheader">НОМЕР</span>
          <span role="columnheader">МАТЕРИАЛ</span>
          <span role="columnheader" className="arc-tab__r">ОБЪЁМ</span>
          <span role="columnheader" className="arc-tab__r">МАССА</span>
          <span role="columnheader" className="arc-tab__r">ДАТА</span>
        </div>

        {loading && <div className="arc-tab__msg">ЧТЕНИЕ АРХИВА…</div>}
        {!loading && error && <div className="arc-tab__msg is-bad">{String(error).toUpperCase()}</div>}
        {!loading && !error && !rows.length && (
          <div className="arc-tab__msg">АРХИВ ПУСТ — ЗАПИСЕЙ НЕТ</div>
        )}

        {rows.map((r, i) => {
          // Нумерация по порядку в списке: сверху свежая запись — 001.
          const no = pad3(i + 1)
          const isOpen = openId === r.id
          return (
            <div
              key={r.id}
              className={`arc-tab__item${isOpen ? ' is-open' : ''}`}
              onMouseEnter={() => setOpenId(r.id)}
              onMouseLeave={() => setOpenId((cur) => (cur === r.id ? null : cur))}
            >
              <button
                type="button"
                className="arc-tab__row"
                role="row"
                onFocus={() => setOpenId(r.id)}
                onClick={() => setInspect((cur) => (cur === r.id ? null : r.id))}
                aria-expanded={isOpen}
              >
                <span role="cell" className="arc-tab__no">{no}</span>
                <span role="cell" className="arc-tab__mat">
                  {(r.material || r.title || 'МАТЕРИАЛ НЕ ОПРЕДЕЛЁН').toUpperCase()}
                </span>
                <span role="cell" className="arc-tab__r">
                  {num(r.volume) ?? DASH} <i>м³</i>
                </span>
                <span role="cell" className="arc-tab__r">
                  {num(r.weight, 1) ?? DASH} <i>т</i>
                </span>
                <span role="cell" className="arc-tab__r arc-tab__date">{fmtDate(r.date)}</span>
              </button>

              {isOpen && (
                <ScanSheet row={r} no={no} onInspect={() => setInspect(r.id)} />
              )}
            </div>
          )
        })}
      </div>

      <p className="arc-tab__hint">
        НАВЕДИТЕ КУРСОР НА ЗАПИСЬ — КАРТОЧКА РАСКРОЕТСЯ В СКАН-ЛИСТ
      </p>

      {/* ═══ ОСМОТР ══════════════════════════════════════════ */}
      {opened && (
        <Inspect row={opened} detail={detail} onClose={() => setInspect(null)} />
      )}
    </div>
  )
}
