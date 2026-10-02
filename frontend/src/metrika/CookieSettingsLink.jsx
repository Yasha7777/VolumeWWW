import { METRIKA_ENABLED, resetConsent } from './metrika'

/* «Настройки cookie» — способ передумать (152-ФЗ: отозвать согласие должно
   быть так же просто, как дать). Возвращает баннер выбора: metrika.resetConsent.
   Без счётчика (нет VITE_YM_ID) cookie не ставятся и ссылка не рисуется.
   Стоит в подвалах лендинга, приложения и юридических страниц — на неё
   ссылается текст /privacy (п. 4.4) и /consent (раздел 8): убирая ссылку,
   поправь и их. */
export default function CookieSettingsLink({ className, style, children = 'Настройки cookie' }) {
  if (!METRIKA_ENABLED) return null
  return (
    <button type="button" className={className} style={style} onClick={resetConsent}>
      {children}
    </button>
  )
}
