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
export const CONSENT_VERSION = '2026-10-08'

export const consentMeta = () => ({
  consent_version: CONSENT_VERSION,
  consent_at: new Date().toISOString(),
})

// Пользователь из кэша (режим degraded, только id/email) метаданных не несёт —
// по нему о согласии судить нельзя, поэтому «неизвестно» ≠ «нет».
export const consentKnown = (user) => !!user && user.user_metadata !== undefined
export const hasConsent = (user) => user?.user_metadata?.consent_version === CONSENT_VERSION
