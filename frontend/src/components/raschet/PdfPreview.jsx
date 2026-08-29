import { useEffect, useMemo, useRef, useState } from 'react'
import { usePDF } from '@react-pdf/renderer'
import { RaschetDocument } from './RaschetDocument'

/* ============================================================
   PdfPreview — живой предпросмотр PDF (десктопная панель отчёта).
   ТЯЖЁЛЫЙ модуль — импортируется только через React.lazy
   из ReportPanel, когда панель реально открыта на десктопе.

   ПОЧЕМУ НЕ ШТАТНЫЙ <PDFViewer>. Он держит ОДИН iframe и меняет ему
   src на новый blob. Смена src = перезагрузка встроенного просмотрщика
   PDF: кадр белеет, страница перескакивает в начало. При пересборке
   документа это читается как «отчёт мигает».

   Здесь двойная буферизация: два iframe друг над другом. Новый blob
   грузится в НЕВИДИМЫЙ, и только по его onLoad слои меняются местами.
   Видимый кадр до этого момента не трогаем — мигать нечему.

   Про отозванные blob-URL: usePDF ревокает предыдущий URL, когда
   приезжает новый. Уже загруженному в iframe документу это не мешает —
   ревокация закрывает только выдачу нового содержимого по ссылке.
   ============================================================ */

// Если onLoad почему-то не пришёл (заблокированный вьюер PDF, экзотика) —
// всё равно показываем свежий документ, иначе предпросмотр замрёт навсегда.
const SWAP_FALLBACK_MS = 3000

export default function PdfPreview({ data, className }) {
  const doc = useMemo(() => <RaschetDocument data={data} />, [data])

  const [instance, update] = usePDF()
  useEffect(() => { update(doc) }, [doc])

  // Два слота; front — тот, что сейчас виден.
  const [slots, setSlots] = useState({ a: null, b: null })
  const [front, setFront] = useState('a')
  const swapTimer = useRef(null)

  const back = front === 'a' ? 'b' : 'a'

  useEffect(() => {
    const url = instance.url
    if (!url || url === slots[front]) return

    // Первый готовый документ показываем сразу — буферизовать нечего.
    if (!slots[front]) { setSlots(s => ({ ...s, [front]: url })); return }

    setSlots(s => ({ ...s, [back]: url }))
    clearTimeout(swapTimer.current)
    swapTimer.current = setTimeout(() => setFront(back), SWAP_FALLBACK_MS)
  }, [instance.url])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(swapTimer.current), [])

  const onSlotLoad = (slot) => {
    if (slot === front || !slots[slot]) return   // about:blank и текущий кадр не считаются
    // Показываем слой, только если в нём догрузилась ИМЕННО актуальная версия.
    // Если пока он грузился, документ пересобрался ещё раз, его загрузку успели
    // прервать сменой src — тогда ждём загрузку новой, а не выносим на экран
    // недогруженный кадр.
    if (slots[slot] !== instance.url) return
    clearTimeout(swapTimer.current)
    setFront(slot)
  }

  const renderSlot = (slot) => {
    const url = slots[slot]
    if (!url) return null
    return (
      <iframe
        key={slot}
        className="rp__viewer-frame"
        src={`${url}#toolbar=0`}
        onLoad={() => onSlotLoad(slot)}
        style={{ opacity: slot === front ? 1 : 0, pointerEvents: slot === front ? 'auto' : 'none' }}
        title="Предпросмотр отчёта"
      />
    )
  }

  return (
    <div className={className} style={{ position: 'relative' }}>
      {renderSlot('a')}
      {renderSlot('b')}

      {!slots[front] && (
        <div className="rp__viewer-note" style={{ inset: 0, display: 'flex' }}>
          Готовлю предпросмотр…
        </div>
      )}

      {/* Документ пересобирается — старый кадр остаётся на месте,
          рядом лишь ненавязчивая метка, что версия обновляется. */}
      {slots[front] && instance.loading && (
        <div className="rp__viewer-badge">обновляю…</div>
      )}
    </div>
  )
}
