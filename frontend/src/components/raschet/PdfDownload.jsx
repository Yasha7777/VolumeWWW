import { useMemo } from 'react'
import { PDFDownloadLink } from '@react-pdf/renderer'
import { RaschetDocument } from './RaschetDocument'

/* ============================================================
   PdfDownload — внутренняя кнопка «Скачать PDF».
   ТЯЖЁЛЫЙ модуль (тянет @react-pdf/renderer) — импортируется
   только через React.lazy из RaschetDownloadButton / ReportPanel.
   ============================================================ */

const DEFAULT_LABELS = { error: 'Ошибка PDF', loading: 'Готовлю PDF…', idle: 'Скачать (PDF)' }

export default function PdfDownload({ data, fileName, className, style, labels = DEFAULT_LABELS }) {
  /* документ мемоизируем: PDFDownloadLink перегенерирует blob при смене
     ссылки на document — без useMemo это происходило бы на каждый рендер */
  const doc = useMemo(() => <RaschetDocument data={data} />, [data])

  return (
    <PDFDownloadLink className={className} style={style} document={doc} fileName={fileName}>
      {({ loading, error }) => (error ? labels.error : loading ? labels.loading : labels.idle)}
    </PDFDownloadLink>
  )
}
