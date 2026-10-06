import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

/* ─────────────────────────────────────────────────────────────────────────
   Расчётный сервер — панель суперадмина в «Профиле».

   Сайт ходит на приёмник расчётного сервера напрямую (без n8n). Здесь задаётся,
   КУДА именно: адрес, режим масштаба (Cube | VIO) и ключ доступа. Настройки
   лежат в БД и применяются со следующего же замера — деплой не нужен.

   Панель — только UI: права проверяет бэкенд (/api/admin/gpu → 403 для всех,
   кроме profiles.is_superadmin). Ключ доступа с сервера не возвращается:
   приходит лишь признак «задан» и его хвост, поэтому пустое поле ключа значит
   «не менять», а не «стереть».
   ───────────────────────────────────────────────────────────────────────── */

const MODES = [
  { key: 'cube', label: 'Cube', hint: 'Масштаб по калибровочному кубу в кадре.' },
  { key: 'vio',  label: 'VIO',  hint: 'Масштаб по данным телефона (позы ARKit из обхода).' },
]

function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function GpuAdminPanel() {
  const [loaded, setLoaded] = useState(null)   // то, что лежит на сервере
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState('cube')
  const [token, setToken] = useState('')        // вводимый новый ключ; пусто = не менять
  const [clearToken, setClearToken] = useState(false)

  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState(null)      // ответ последней проверки связи
  const savedTimer = useRef(null)

  const apply = (cfg) => {
    setLoaded(cfg)
    setUrl(cfg.url || '')
    setMode(cfg.mode === 'vio' ? 'vio' : 'cube')
    setToken('')
    setClearToken(false)
  }

  useEffect(() => {
    let alive = true
    api.adminGetGpu()
      .then(cfg => { if (alive) apply(cfg) })
      .catch(e => { if (alive) setLoadError(e.message) })
    return () => { alive = false; clearTimeout(savedTimer.current) }
  }, [])

  if (loadError) {
    return (
      <div className="kb-admin">
        <div className="kb-admin-head"><span className="kb-account-title">Расчётный сервер</span></div>
        <div className="status error"><div><strong>Настройки не загрузились</strong>{loadError}</div></div>
      </div>
    )
  }
  if (!loaded) return null

  const tokenChanged = clearToken || token.trim() !== ''
  const dirty = url.trim() !== (loaded.url || '') || mode !== loaded.mode || tokenChanged
  const canSave = loaded.storage_ready && url.trim() !== '' && !saving

  // Что уйдёт на сервер в поле ключа: undefined — не трогать, '' — стереть.
  const tokenPayload = () => (clearToken ? '' : (token.trim() || undefined))

  const save = async () => {
    setSaveError(''); setSaved(false)
    setSaving(true)
    try {
      const cfg = await api.adminSaveGpu({ url: url.trim(), mode, token: tokenPayload() })
      apply(cfg)
      setSaved(true)
      clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setSaveError(e.message)
    }
    setSaving(false)
  }

  // Проверяется то, что СЕЙЧАС в форме, ещё не сохранённое: адрес с опечаткой
  // лучше поймать до того, как по нему уйдёт чей-то замер.
  const runCheck = async () => {
    setCheck(null)
    setChecking(true)
    try {
      setCheck(await api.adminCheckGpu({ url: url.trim() || undefined, token: tokenPayload() }))
    } catch (e) {
      setCheck({ ok: false, error: e.message })
    }
    setChecking(false)
  }

  const vioReady = check?.ok && (check.scale_modes_ready || []).includes('vio')
  const tokenPlaceholder = clearToken
    ? 'будет убран при сохранении'
    : loaded.token_set
      ? `задан${loaded.token_hint ? ` (${loaded.token_hint})` : ''} — введите новый, чтобы заменить`
      : 'не задан'

  return (
    <div className="kb-admin">
      <div className="kb-admin-head">
        <span className="kb-account-title">Расчётный сервер</span>
        <span className="kb-admin-badge">Администратор</span>
      </div>

      {!loaded.storage_ready && (
        <div className="status info" style={{ display: 'block', marginTop: 0 }}>
          <strong>Таблица настроек не создана</strong>
          Выполните <code>supabase/migration_app_settings.sql</code> в SQL-редакторе Supabase.
          До этого сохранить настройки нельзя.
        </div>
      )}

      <div className="kb-field kb-admin-field">
        <label htmlFor="gpu-url">URL сервера</label>
        <input id="gpu-url" type="url" inputMode="url" autoComplete="off" spellCheck={false}
               value={url} onChange={e => { setUrl(e.target.value); setCheck(null) }}
               placeholder="http://адрес-сервера:6007/run" />
        <p className="kb-hint">
          Адрес приёмника на GPU-сервере. Окончание <code>/run</code> допишется само.
          {loaded.source === 'env' && ' Сейчас действует адрес из переменных окружения бэкенда.'}
        </p>
      </div>

      <div className="kb-field kb-admin-field">
        <label id="gpu-mode-label">Режим масштаба</label>
        <div className="kb-seg" role="radiogroup" aria-labelledby="gpu-mode-label">
          {MODES.map(m => (
            <button key={m.key} type="button" role="radio" aria-checked={mode === m.key}
                    className={mode === m.key ? 'is-on' : ''} onClick={() => setMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="kb-hint">{MODES.find(m => m.key === mode).hint}</p>
        {mode === 'vio' && !vioReady && (
          <p className="kb-hint kb-admin-warn">
            Сервер уже принимает данные обхода, но масштаб по VIO пока не считает:
            объём будет посчитан по кубу, и в результате это будет указано.
          </p>
        )}
      </div>

      <div className="kb-field kb-admin-field">
        <label htmlFor="gpu-token">Ключ доступа</label>
        <input id="gpu-token" type="password" autoComplete="new-password" spellCheck={false}
               value={token} disabled={clearToken}
               onChange={e => { setToken(e.target.value); setCheck(null) }}
               placeholder={tokenPlaceholder} />
        <p className="kb-hint">
          Тот же, что <code>RECEIVER_TOKEN</code> в <code>.env.local</code> на сервере. Пустое поле — ключ не меняется.
          {loaded.token_set && token.trim() === '' && (
            <>{' '}
              <button type="button" className="kb-link-btn" onClick={() => { setClearToken(v => !v); setCheck(null) }}>
                {clearToken ? 'Оставить ключ' : 'Убрать ключ'}
              </button>
            </>
          )}
        </p>
      </div>

      <div className="kb-admin-actions">
        <button type="button" className="btn btn-secondary" onClick={runCheck} disabled={checking || url.trim() === ''}>
          {checking ? 'Проверяем…' : 'Проверить связь'}
        </button>
        {dirty && (
          <button type="button" className="btn btn-primary" onClick={save} disabled={!canSave}>
            {saving ? <><div className="spinner" />Сохраняем…</> : 'Сохранить'}
          </button>
        )}
        {!dirty && loaded.updated_at && (
          <span className="kb-actions-note">Изменено {fmtWhen(loaded.updated_at)}</span>
        )}
      </div>

      {check && (check.ok ? (
        <div className="status success" role="status">
          <div>
            <strong>Сервер на связи</strong>
            {[
              check.ms != null && `ответ за ${check.ms} мс`,
              check.engine && `движок ${check.engine}`,
              check.code_edit_msk && `приёмник от ${check.code_edit_msk}`,
              check.auth_required ? 'ключ подходит' : 'ключ на сервере не задан — вход открыт',
            ].filter(Boolean).join(' · ')}
            {dirty && ' Настройки ещё не сохранены.'}
          </div>
        </div>
      ) : (
        <div className="status error" role="alert">
          <div><strong>Связи нет</strong>{check.error || 'Сервер не ответил.'}</div>
        </div>
      ))}

      {saveError && (
        <div className="status error" role="alert"><div><strong>Не удалось сохранить</strong>{saveError}</div></div>
      )}
      {saved && (
        <div className="status success" role="status"><div><strong>Сохранено</strong>Следующий замер уйдёт по этим настройкам.</div></div>
      )}
    </div>
  )
}
