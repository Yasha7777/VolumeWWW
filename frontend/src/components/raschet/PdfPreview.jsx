import { useMemo } from 'react'
import { PDFViewer } from '@react-pdf/renderer'
import { RaschetDocument } from './RaschetDocument'

/* ============================================================
   PdfPreview — живой предпросмотр PDF (десктопная панель отчёта).
   ТЯЖЁЛЫЙ модуль — импортируется только через React.lazy
   из ReportPanel, когда панель реально открыта на десктопе.
   ============================================================ */

export default function PdfPreview({ data, className }) {
  const doc = useMemo(() => <RaschetDocument data={data} />, [data])

  return (
    <PDFViewer className={className} showToolbar={false}>
      {doc}
    </PDFViewer>
  )
}
