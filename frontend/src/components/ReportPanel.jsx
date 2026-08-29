import { lazy, memo, Suspense, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildDocData, makeDocNo } from './raschet/raschetData'

/* ============================================================
   ReportPanel — выдвижное окно отчёта.
   ------------------------------------------------------------
   Десктоп (≥769px): панель выезжает справа и ТЕСНИТ контент
     (body.rp-open → margin-right). Превью = <PDFViewer> с тем же
     RaschetDocument, что и скачивается (один источник правды).
   Мобила (≤768px): шторка снизу (bottom sheet) с кратким отчётом —
     inline-PDF в iframe на телефоне ненадёжен, поэтому показываем
     читаемую сводку, а полный документ — по кнопке «Скачать».

   ВАЖНО (производительность): @react-pdf/renderer здесь больше
   НЕ импортируется статически. PdfPreview / PdfDownload лежат в
   ./raschet/* и подгружаются лениво (vendor-pdf чанк): превью —
   когда панель открыта на десктопе, кнопка — когда есть result.
   Мобильная сводка — обычный JSX, PDF-движок ей не нужен.

   Управление: open / onClose (свернуть «>») / onOpen (развернуть).
   Стили — в report-panel.css (импортится в main.jsx).
   ============================================================ */

const PdfPreview = lazy(() => import('./raschet/PdfPreview'))
const PdfDownload = lazy(() => import('./raschet/PdfDownload'))

const MQ = '(max-width: 768px)'

/* Пауза, после которой ввод в поле формы доезжает до документа.
   Меньше — возвращается мигание на каждый символ, больше — отчёт
   заметно отстаёт от того, что человек только что напечатал. */
const TYPING_IDLE_MS = 600

/* Значение, «догоняющее» исходное только после паузы в изменениях.
   Ключ к проблеме мигания: каждое нажатие в «Названии объекта» меняло
   title → data → document → @react-pdf перерисовывал PDF и перезагружал
   iframe. То есть моргал не отчёт, а полная пересборка документа на
   КАЖДЫЙ символ. Теперь пересборка одна — когда человек допечатал. */
function useIdleValue(value, ms = TYPING_IDLE_MS) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (Object.is(settled, value)) return
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms, settled])
  return settled
}

const ChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
)

const PreviewLoader = () => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', minHeight: 200, color: '#888', fontSize: 13,
  }}>
    Готовлю предпросмотр…
  </div>
)

function ReportPanel({ open, onClose, onOpen, result, photos = [], title = '' }) {
  const [mobile, setMobile] = useState(
    typeof window !== 'undefined' ? window.matchMedia(MQ).matches : false
  )

  useEffect(() => {
    const mq = window.matchMedia(MQ)
    const on = () => setMobile(mq.matches)
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on)
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on) }
  }, [])

  // Всё, из чего собирается документ, берём в «устоявшемся» виде: пока
  // человек печатает, ссылка на data не меняется → PDF не пересобирается
  // и панель не моргает. Название доезжает через TYPING_IDLE_MS.
  const idleTitle  = useIdleValue(title)
  const idleResult = useIdleValue(result)
  const idlePhotos = useIdleValue(photos)

  // номер документа — один на анализ (стабилен, пока не сменился result)
  const docNo = useMemo(() => makeDocNo(), [idleResult])
  const data = useMemo(
    () => buildDocData({ result: idleResult, photos: idlePhotos, title: idleTitle, docNo }),
    [idleResult, idlePhotos, idleTitle, docNo]
  )
  const fileName = `Raschet_${String(docNo).replace(/[^\w-]+/g, '-')}.pdf`
  const r = data.rows[0] || {}

  // десктоп: пушим контент вбок, пока панель открыта
  useEffect(() => {
    if (mobile) { document.body.classList.remove('rp-open'); return }
    document.body.classList.toggle('rp-open', open)
    return () => document.body.classList.remove('rp-open')
  }, [open, mobile])

  // Esc — свернуть
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // кнопка рендерится только при наличии result — без результата
  // не тянем PDF-движок и не даём скачивать документ-заглушку
  const DownloadBtn = result ? (
    <Suspense
      fallback={
        <span className="btn btn-primary btn-sm rp__dl" style={{ textDecoration: 'none', opacity: 0.7 }}>
          PDF…
        </span>
      }
    >
      <PdfDownload
        className="btn btn-primary btn-sm rp__dl"
        style={{ textDecoration: 'none' }}
        data={data}
        fileName={fileName}
        labels={{ error: 'Ошибка', loading: 'PDF…', idle: 'Скачать' }}
      />
    </Suspense>
  ) : null

  const panel = (
    <>
      {/* затемнение — только для мобильной шторки */}
      {mobile && (
        <div className={`rp-backdrop${open ? ' is-open' : ''}`} onClick={onClose} aria-hidden="true" />
      )}

      <aside className={`rp${open ? ' is-open' : ''}`} aria-hidden={!open}>
        {mobile && <div className="rp__grab" aria-hidden="true" />}

        <div className="rp__head">
          <span className="rp__title">Отчёт · предпросмотр</span>
          <div className="rp__actions">
            {DownloadBtn}
            <button className="rp__collapse" onClick={onClose} aria-label="Свернуть" title="Свернуть">
              <ChevronRight />
            </button>
          </div>
        </div>

        <div className="rp__body">
          {/* десктоп: живой PDF (лениво, только когда панель открыта) */}
          {open && !mobile && (
            <Suspense fallback={<PreviewLoader />}>
              <PdfPreview className="rp__viewer" data={data} />
            </Suspense>
          )}

          {/* мобила: краткая сводка вместо iframe-PDF */}
          {open && mobile && (
            <div className="rp__sum">
              <div className="rp__sum-title">Расчёт объёма и массы материала</div>
              <div className="rp__sum-no">№ {data.docNo} · {data.dateMade}</div>

              <div className="rp__sum-obj">{data.object}</div>

              <div className="rp__sum-grid">
                <div className="rp__sum-cell">
                  <span>Материал</span><b>{r.material}</b>
                </div>
                <div className="rp__sum-cell">
                  <span>Объём</span><b>{r.volume} м³</b>
                </div>
                <div className="rp__sum-cell">
                  <span>Плотность</span><b>{r.density} кг/м³</b>
                </div>
                <div className="rp__sum-cell rp__sum-cell--accent">
                  <span>Расчётная масса</span><b>{r.mass} т</b>
                </div>
              </div>

              <div className="rp__sum-meta">
                Исходных кадров: {data.framesUsed}
              </div>
              {data.coords !== '—' && (
                <div className="rp__sum-meta">Координаты: {data.coords}</div>
              )}
              {data.shotAt !== '—' && (
                <div className="rp__sum-meta">Съёмка: {data.shotAt}</div>
              )}

              <div className="rp__sum-hint">
                Полный официальный документ — по кнопке «Скачать» вверху.
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* десктоп: язычок у правого края, чтобы развернуть свёрнутую панель */}
      {!mobile && !open && result && (
        <button className="rp-handle" onClick={onOpen} aria-label="Открыть отчёт">
          Отчёт
        </button>
      )}
    </>
  )

  return createPortal(panel, document.body)
}

/* memo: Analyze перерисовывается на КАЖДОЕ нажатие в любом поле формы
   (title, notes, параметры куба). Без memo вместе с ней перерисовывалась
   и панель отчёта — лишняя работа под открытым PDF-предпросмотром. */
export default memo(ReportPanel)
