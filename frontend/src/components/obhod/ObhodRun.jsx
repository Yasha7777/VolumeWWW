import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { api } from '../../api'
import CubeSettings, { CUBE_DEFAULT } from '../CubeSettings'
import { plural } from './scans'

/* Шаг 2 для обходов: режим TEST/PROD, калибровочный куб и запуск.
   Каждый выбранный обход — отдельный анализ; сервер ставит их в очередь
   и считает по одному, результаты приезжают в «Историю». */
export default function ObhodRun({ scans, onBack, demo = false }) {
  const [isProd, setIsProd] = useState(false)
  const [cube, setCube] = useState(CUBE_DEFAULT)
  const [cubeValid, setCubeValid] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const onCube = useCallback(({ payload, valid }) => { setCube(payload); setCubeValid(valid) }, [])
  // client_id на обход живёт до успешного запуска: повторное нажатие после
  // обрыва сети не заведёт второй анализ (бэкенд идемпотентен по client_id)
  const runIds = useRef({})

  const n = scans.length
  const run = async () => {
    if (busy || !n) return
    if (!cubeValid) { setStatus({ error: true, msg: 'Исправьте параметры калибровочного куба.' }); return }
    if (demo) { setStatus({ msg: `Демо-режим: ${n} ${plural(n, 'анализ', 'анализа', 'анализов')} не отправлены.` }); return }
    setBusy(true); setStatus(null)
    const ok = [], failed = []
    for (const s of scans) {
      const client_id = (runIds.current[s.id] ||= globalThis.crypto?.randomUUID?.())
      try { await api.analyzeScan(s.id, { is_prod: isProd, cube, client_id }); ok.push(s) }
      catch (e) { failed.push(`${s.title}: ${e?.message || 'ошибка'}`) }
    }
    setBusy(false)
    if (!failed.length) runIds.current = {}
    if (failed.length) setStatus({ error: true, msg: `Не запущены: ${failed.join('; ')}`, ok: ok.length })
    else setStatus({ msg: `${ok.length} ${plural(ok.length, 'анализ поставлен', 'анализа поставлены', 'анализов поставлены')} в очередь.`, ok: ok.length })
  }

  return (
    <section className="ks-run" aria-label="Запуск анализа">
      <div className="ks-run__head">
        <h2 className="ks-run__title">{n} {plural(n, 'обход', 'обхода', 'обходов')} к анализу</h2>
        <button type="button" className="ks-run__back" onClick={onBack} disabled={busy}>← Изменить выбор</button>
      </div>

      <div className="ks-run__list">
        {scans.map((o) => (
          <div key={o.id} className="ks-chip">
            {o.img ? <img src={o.img} alt="" /> : <span className="ks-chip__noimg" />}
            <span className="ks-chip__text">
              <span className="ks-chip__date">{o.title}</span>
              <span className="ks-chip__meta">{o.date} · {o.photos} фото</span>
            </span>
          </div>
        ))}
      </div>

      <div className="ks-run__row">
        <span className="ks-run__label">Режим анализа</span>
        <div className="ks-mode" role="radiogroup" aria-label="Режим анализа">
          <button type="button" role="radio" aria-checked={!isProd} className={!isProd ? 'is-on' : ''} onClick={() => setIsProd(false)} disabled={busy}>TEST</button>
          <button type="button" role="radio" aria-checked={isProd} className={isProd ? 'is-on' : ''} onClick={() => setIsProd(true)} disabled={busy}>PROD</button>
        </div>
      </div>

      <div className="ks-run__actions">
        <button type="button" className="ks-continue" onClick={run} disabled={busy || !n}>
          {busy ? 'Ставим в очередь…' : <>Запустить {n > 1 ? `${n} ${plural(n, 'анализ', 'анализа', 'анализов')}` : 'анализ'} <ArrowRight size={15} strokeWidth={1.8} /></>}
        </button>
        {/* шестерёнка калибровочного куба — тот же компонент, что в ручной загрузке */}
        <CubeSettings onChange={onCube} />
      </div>

      {status && (
        <div className={'ks-run__status' + (status.error ? ' is-error' : '')}>
          {status.msg}{status.ok ? <> Статус и результаты — в <Link to="/history">Истории</Link>.</> : null}
        </div>
      )}
    </section>
  )
}
