import { useMemo, useState } from 'react'
import PlyViewer from '../PlyViewer'
import ViewerErrorBoundary from '../ViewerErrorBoundary'
import { DiagnosticsBlock } from '../Diagnostics'
import Barcode from './Barcode'
import ArcPlate, { ART } from './ArcPlate'
import { analysisNo, extraMetrics, splitMaterial, DASH } from './archiveData'

/* ============================================================
   ArchiveHistory — экран 02 АРХИВ в теме «Архив».
   ------------------------------------------------------------
   Слой представления над pages/History.jsx: строки приезжают
   уже отфильтрованными и посчитанными, здесь только вёрстка и
   раскрытие записи.

   Запись раскрывается ПО НАЖАТИЮ и прямо под своей строкой.
   Раскрытие по наведению было ошибкой: курсор, идущий к
   содержимому карточки, по дороге пересекал соседние строки —
   те открывались и закрывались, а нужная схлопывалась под
   рукой. Наведение теперь только подсвечивает.

   Отличия от макета — по одной причине, всегда одной: числа,
   которых у приложения нет, не выдумываются.
   ============================================================ */

const pad3 = (n) => String(n).padStart(3, '0')
const pad2 = (n) => String(n).padStart(2, '0')

const fmtDate = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(+d)
    ? DASH
    : `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`
}
const fmtTime = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(+d) ? '' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const num = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : null)

const STATUS = {
  completed: { label: 'ГОТОВ',      cls: 'is-ok' },
  error:     { label: 'ОШИБКА',     cls: 'is-bad' },
  pending:   { label: 'В ОБРАБОТКЕ', cls: 'is-run' },
}
const statusOf = (s) => STATUS[s] || STATUS.pending

/* ── раскрытая запись ────────────────────────────────────────
   Содержит всё, что показывают светлая и тёмная темы: текст
   ответа пайплайна, снимки, трёхмерную модель, диагностику,
   владельца и место съёмки. Штрих-кода здесь нет намеренно —
   в окне записи он ничего не кодирует, кроме самого себя.  */
function Record({ row, detail, onDelete, deleting }) {
  const mat   = splitMaterial(row.material)
  const extra = useMemo(() => extraMetrics(row.raw?.result), [row.raw?.result])
  const st    = statusOf(row.status)
  const has3d = !!(detail?.plyUrl || detail?.glbUrl)
  const photos = row.photos || []
  const thumbs = row.thumbs || []
  const thumbAt = (i) => thumbs[i] || photos[i]

  const metric = (k, v, cls = '') => (
    <div className="arc-rec__m">
      <span>{k}</span>
      <b className={cls}>{v ?? DASH}</b>
    </div>
  )

  return (
    <div className="arc-rec">
      {/* ── название и мета ── */}
      <div className="arc-rec__hd">
        <h3 className="arc-rec__ttl">
          {(row.title || mat.name || 'БЕЗ НАЗВАНИЯ').toUpperCase()}
        </h3>
        <span className={`arc-rec__st ${st.cls}`}>{st.label}</span>
      </div>
      <div className="arc-rec__meta">
        <span>ЗАПИСЬ {analysisNo(row.id) || DASH}</span>
        <span>{fmtDate(row.date)} {fmtTime(row.date)}</span>
        {row.site && <span>{String(row.site).toUpperCase()}</span>}
        {row.owner && <span>ВЛАДЕЛЕЦ: {String(row.owner).toUpperCase()}</span>}
        {row.location && <span>КООРДИНАТЫ: {row.location}</span>}
      </div>

      {row.status === 'error' && (
        <p className="arc-rec__err">{String(row.errorReason || 'НЕ УДАЛОСЬ ОБРАБОТАТЬ СНИМКИ').toUpperCase()}</p>
      )}
      {row.status !== 'error' && row.status !== 'completed' && (
        <p className="arc-rec__wait">ИДЁТ ОБРАБОТКА — СПИСОК ОБНОВЛЯЕТСЯ САМ</p>
      )}

      {/* ── метрики ── */}
      <div className="arc-rec__metrics">
        {metric('ОБЪЁМ', num(row.volume) ? `${num(row.volume)} м³` : null)}
        {metric('МАССА', num(row.weight, 1) ? `${num(row.weight, 1)} т` : null)}
        {metric('МАТЕРИАЛ', mat.name ? mat.name.toUpperCase() : null)}
        {metric('ФРАКЦИЯ', mat.fraction)}
        {metric('ПЛОТНОСТЬ', row.density ? `${row.density} кг/м³` : null)}
        {metric('ДОСТОВЕРНОСТЬ', extra.confidence != null ? extra.confidence.toFixed(2) : null, 'arc-blue')}
        {metric('ВЫСОТА', extra.height != null ? `${extra.height.toFixed(2)} м` : null)}
        {metric('СНИМКОВ', photos.length ? pad2(photos.length) : null)}
      </div>

      {/* ── модель крупно, диагностика мельче ── */}
      <div className="arc-rec__grid">
        <div className="arc-rec__view">
          <div className="arc-rec__k">ВОССТАНОВЛЕННАЯ ГЕОМЕТРИЯ</div>
          {/* Высокая рамка — только под настоящую модель. Пустая
              «синька» в полэкрана читается как сломанный вьюер. */}
          <div className={`arc-blueprint${has3d ? ' arc-blueprint--tall' : ''}`}>
            {has3d ? (
              <ViewerErrorBoundary height="460px">
                <PlyViewer
                  plyUrl={detail.plyUrl} glbUrl={detail.glbUrl}
                  up={detail.up} upGlb={detail.upGlb} height="460px"
                />
              </ViewerErrorBoundary>
            ) : (
              <ArcPlate kind="mesh" src={ART.mesh} caption="ТРЁХМЕРНАЯ МОДЕЛЬ НЕ СОХРАНЕНА" />
            )}
            <span className="arc-blueprint__tag">[ВРАЩАТЬ]</span>
          </div>
        </div>

        <div className="arc-rec__side">
          {detail?.diag && (
            <>
              <div className="arc-rec__k">ДИАГНОСТИКА</div>
              {/* Ширину ограничиваем контейнером, а не transform: scale —
                  пометки в этих кадрах размером в одну ячейку, и любое
                  масштабирование картинки их размазывает (см. CLAUDE.md).
                  Просмотр 1:1 внутри блока при этом остаётся. */}
              <div className="arc-rec__diag"><DiagnosticsBlock diag={detail.diag} /></div>
            </>
          )}

          {photos.length > 0 && (
            <>
              <div className="arc-rec__k">СНИМКИ · {pad2(photos.length)}</div>
              <div className="arc-rec__photos">
                {photos.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="arc-rec__photo"
                    title={`Снимок ${i + 1} — открыть полный размер`}
                  >
                    <img src={thumbAt(i)} alt="" loading="lazy" />
                    <span>{pad2(i + 1)}</span>
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── сырой ответ пайплайна ── */}
      {row.raw?.result && (
        <details className="arc-rec__raw">
          <summary>ОТВЕТ РАСЧЁТНОГО УЗЛА</summary>
          <pre>{row.raw.result}</pre>
        </details>
      )}

      <div className="arc-rec__act">
        <button
          type="button"
          className="arc-btn arc-btn--chip arc-btn--danger"
          onClick={(e) => onDelete?.(row.id, e)}
          disabled={deleting}
        >
          {deleting ? 'УДАЛЯЮ…' : 'УДАЛИТЬ ЗАПИСЬ'}
        </button>
      </div>
    </div>
  )
}

/* ============================================================ */
export default function ArchiveHistory({
  rows, sumVol, sumWeight, loading, error,
  onRefresh, onDelete, deleting = {}, getDetail,
  query, setQuery,
  adminUsers, userFilter, setUserFilter,
}) {
  const [openId, setOpenId] = useState(null)

  const lastAt = rows.length ? rows[0].date : null

  /* «Архивный снимок склада» из макета был пустой синькой с
     подписью — картинки под него в системе нет и взяться ей
     неоткуда. Вместо заглушки показываем настоящую витрину
     архива: кадры последних замеров. Нет ни одного — блока нет. */
  const showcase = useMemo(() => {
    const out = []
    for (const r of rows) {
      for (const t of (r.thumbs?.length ? r.thumbs : r.photos || [])) {
        out.push(t)
        if (out.length >= 6) return out
      }
    }
    return out
  }, [rows])

  const userLabel = (u) =>
    (u.name || '').trim() || (u.company || '').trim() || `${String(u.id).slice(0, 8)}…`

  return (
    <div className="arc-page">
      {/* ═══ ШАПКА АРХИВА ════════════════════════════════════ */}
      <section className={`arc-arch__top${showcase.length ? '' : ' is-bare'}`}>
        {showcase.length > 0 && (
          <div className="arc-showcase">
            <div className="arc-showcase__grid">
              {showcase.map((src, i) => (
                <span key={i} className="arc-showcase__cell">
                  <img src={src} alt="" loading="lazy" />
                </span>
              ))}
            </div>
            <span className="arc-blueprint__cap">ПОСЛЕДНИЕ КАДРЫ АРХИВА</span>
          </div>
        )}

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
            {/* Суперадмин: чужие архивы. Селектор появляется, только
                если бэкенд подтвердил права (adminListUsers → 200). */}
            {Array.isArray(adminUsers) && (
              <select
                className="arc-input arc-input--find arc-select"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                aria-label="Чей архив показывать"
              >
                <option value="mine">МОЙ АРХИВ</option>
                <option value="all">ВСЕ ПОЛЬЗОВАТЕЛИ</option>
                {adminUsers.map((u) => (
                  <option key={u.id} value={u.id}>{userLabel(u)}</option>
                ))}
              </select>
            )}
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
          <div className="arc-empty">
            <img className="arc-art" src={ART.manual} alt="" loading="lazy" />
            <p>АРХИВ ПУСТ — ЗАПИСЕЙ НЕТ</p>
            <i>ЗАВЕРШЁННЫЕ ЗАМЕРЫ ПОПАДАЮТ СЮДА САМИ</i>
          </div>
        )}

        {rows.map((r, i) => {
          const isOpen = openId === r.id
          return (
            <div key={r.id} className={`arc-tab__item${isOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="arc-tab__row"
                role="row"
                onClick={() => setOpenId((cur) => (cur === r.id ? null : r.id))}
                aria-expanded={isOpen}
              >
                <span role="cell" className="arc-tab__no">{pad3(i + 1)}</span>
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
                <Record
                  row={r}
                  detail={getDetail?.(r.raw)}
                  onDelete={onDelete}
                  deleting={!!deleting[r.id]}
                />
              )}
            </div>
          )
        })}
      </div>

      <p className="arc-tab__hint">НАЖМИТЕ НА ЗАПИСЬ — ОНА РАСКРОЕТСЯ ПОД СТРОКОЙ</p>
    </div>
  )
}
