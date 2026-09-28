import { useState } from 'react'
import { Link } from 'react-router-dom'
import { hit, readConsent, saveConsent, startMetrika } from './metrika'
import './cookie-banner.css'

/* Согласие на cookie (152-ФЗ). Пока посетитель не нажал «Принять», счётчик
   не загружается вовсе. «Отклонить» — равноправная кнопка того же размера:
   согласие, которое сложно не дать, согласием не считается.
   Показывается, только если задан VITE_YM_ID (см. App.jsx / metrika.js). */
export default function CookieBanner() {
  const [open, setOpen] = useState(() => readConsent() === null)
  if (!open) return null

  const accept = () => {
    saveConsent('accepted')
    startMetrika(window.location.pathname)
    // первый просмотр этой страницы: MetrikaTracker уже отработал до согласия
    hit(window.location.href, { title: document.title, referer: document.referrer })
    setOpen(false)
  }
  const decline = () => {
    saveConsent('declined')
    setOpen(false)
  }

  return (
    <section className="kb-cookie" role="region" aria-label="Согласие на использование cookie">
      <p className="kb-cookie__text">
        Сайт использует cookie и Яндекс Метрику, чтобы понимать, как им пользуются.
        Статистика включится, только если вы согласитесь.
        Подробнее — в <Link to="/privacy">политике конфиденциальности</Link>.
      </p>
      <div className="kb-cookie__acts">
        <button type="button" className="kb-cookie__btn kb-cookie__btn--ghost" onClick={decline}>Отклонить</button>
        <button type="button" className="kb-cookie__btn kb-cookie__btn--solid" onClick={accept}>Принять</button>
      </div>
    </section>
  )
}
