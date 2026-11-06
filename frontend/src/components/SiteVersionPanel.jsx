import { useEffect, useState } from 'react'
import { api } from '../api'

const current = __SITE_BUILD__

function BuildDetails({ label, build }) {
  return (
    <div className="kb-site-build">
      <strong>{label}</strong>
      <div>Версия <code>{build.version}</code> · исходники <code>{build.revision?.slice(0, 12) || 'неизвестны'}</code></div>
      <div>Собрана {new Date(build.builtAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК</div>
      {build.dirty && <div>В сборке есть незакоммиченные изменения.</div>}
      {build.dirty == null && <div>Состояние исходников неизвестно.</div>}
    </div>
  )
}

export default function SiteVersionPanel() {
  const [server, setServer] = useState(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setChecking(true); setError(''); setServer(null)
    api.adminGetVersion().then(value => {
      if (alive) setServer(value)
    }).catch(e => {
      if (alive) setError(e.message)
    }).finally(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, [attempt])

  const matches = server?.buildId === current.buildId
  return (
    <div className="kb-admin">
      <div className="kb-admin-head">
        <span className="kb-account-title">Версия сайта</span>
        <span className="kb-admin-badge">Администратор</span>
      </div>
      <BuildDetails label="Открытая страница" build={current} />
      {server && <BuildDetails label="Бэкенд на сервере" build={server} />}
      <div role="status" aria-live="polite" className={`status ${error ? 'error' : server ? (matches ? 'success' : 'info') : 'info'}`}>
        <div>{checking ? 'Проверяю версию сервера…' : error
          ? <>Версия сервера не проверена: {error}</>
          : matches ? 'Страница и бэкенд относятся к одной сборке.'
          : 'Сборки различаются. Обновите страницу. Если версии всё ещё разные, пересоберите оба контейнера сайта.'}</div>
      </div>
      <div className="kb-admin-actions">
        <button type="button" className="btn btn-secondary" disabled={checking} onClick={() => setAttempt(v => v + 1)}>Проверить версию сервера</button>
        <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>Обновить страницу</button>
      </div>
    </div>
  )
}
