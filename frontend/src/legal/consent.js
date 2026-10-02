/* ════════════════════════════════════════════════════════════════════════
   Согласие на обработку персональных данных — версия и учёт.

   CONSENT_VERSION — дата редакции документов /consent, /privacy, /terms.
   Поменялся текст согласия по существу (состав данных, цели, получатели) →
   поставь новую дату: всем пользователям при следующем входе покажется окно
   согласия (components/ConsentGate.jsx).

   Где хранится отметка: auth.users.raw_user_meta_data (user_metadata):
     consent_version — редакция, с которой согласились;
     consent_at      — когда (ISO, часы устройства пользователя).
   Пишется при регистрации по почте (signUp → options.data) и в окне согласия
   после входа (updateUser). Отдельной таблицы нет намеренно: миграцию БД на
   self-hosted Supabase делает владелец руками, а отметка нужна уже сейчас.
   Доказательная сила у записи, сделанной сервером, выше — если заводить
   журнал согласий, то серверный (IP, время сервера, текст редакции).
   ════════════════════════════════════════════════════════════════════════ */
export const CONSENT_VERSION = '2026-10-02'

export const consentMeta = () => ({
  consent_version: CONSENT_VERSION,
  consent_at: new Date().toISOString(),
})

// Пользователь из кэша (режим degraded, только id/email) метаданных не несёт —
// по нему о согласии судить нельзя, поэтому «неизвестно» ≠ «нет».
export const consentKnown = (user) => !!user && user.user_metadata !== undefined
export const hasConsent = (user) => user?.user_metadata?.consent_version === CONSENT_VERSION

// Чекбокс на /register отмечен, дальше человек ушёл на Яндекс: отметку надо
// донести через редирект. После возврата её подхватит ConsentGate.
const PENDING_KEY = 'kb-consent-pending'
export const markConsentPending = () => { try { localStorage.setItem(PENDING_KEY, CONSENT_VERSION) } catch {} }
export const takeConsentPending = () => {
  try {
    const v = localStorage.getItem(PENDING_KEY)
    localStorage.removeItem(PENDING_KEY)
    return v === CONSENT_VERSION
  } catch { return false }
}
