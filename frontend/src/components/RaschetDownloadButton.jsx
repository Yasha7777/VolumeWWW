import { lazy, Suspense, useMemo } from 'react'
import { buildDocData, makeDocNo } from './raschet/raschetData'

/* ============================================================
   RaschetDownloadButton — кнопка «Скачать (PDF)».
   ------------------------------------------------------------
   Путь и API прежние, страницы менять не надо:
     <RaschetDownloadButton result={result} photos={photos} title={title} />

   ВАЖНО (производительность): @react-pdf/renderer здесь больше
   НЕ импортируется статически. Сам документ и PDFDownloadLink
   живут в ./raschet/* и подгружаются лениво (vendor-pdf чанк),
   только когда кнопка реально отрисована. Логин-страница и
   основной бандл про PDF ничего не знают.

   Парсер и сборка данных переехали в ./raschet/raschetData.js —
   ре-экспортируем их отсюда, чтобы старые импорты вида
     import { parseWebhookResult } from './components/RaschetDownloadButton'
   продолжили работать без правок.

   Если где-то нужен сам RaschetDocument — импортируй его ТОЛЬКО
   динамически из './raschet/RaschetDocument', иначе PDF-движок
   вернётся в основной бандл.
   ============================================================ */

export { parseWebhookResult, buildDocData, makeDocNo } from './raschet/raschetData'

const PdfDownload = lazy(() => import('./raschet/PdfDownload'))

const BTN_STYLE = { textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }

export default function RaschetDownloadButton({
  result, photos = [], title = '', docNo: docNoProp, className = 'copy-btn',
}) {
  const docNo = useMemo(() => docNoProp || makeDocNo(), [docNoProp])

  const data = useMemo(
    () => buildDocData({ result, photos, title, docNo }),
    [result, photos, title, docNo],
  )

  const fileName = `Raschet_${String(docNo).replace(/[^\w-]+/g, '-')}.pdf`

  return (
    <Suspense
      fallback={
        <span className={className} style={{ ...BTN_STYLE, opacity: 0.7 }}>
          Готовлю PDF…
        </span>
      }
    >
      <PdfDownload
        data={data}
        fileName={fileName}
        className={className}
        style={BTN_STYLE}
        labels={{ error: 'Ошибка PDF', loading: 'Готовлю PDF…', idle: 'Скачать (PDF)' }}
      />
    </Suspense>
  )
}
