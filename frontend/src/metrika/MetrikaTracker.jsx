import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { isPublicPath } from '../seo/routes'
import { hit, isWebvisorSession, readConsent, startMetrika } from './metrika'

/* Просмотры для SPA + старт счётчика, если согласие уже дано раньше.
   Смонтирован в App.jsx ПОСЛЕ RouteMeta: его эффект ставит document.title
   раньше, и в hit уходит уже заголовок новой страницы. Правила — metrika.js. */
export default function MetrikaTracker() {
  const { pathname, search } = useLocation()
  const prevUrl = useRef(null)

  useEffect(() => {
    if (readConsent() === 'accepted') startMetrika(window.location.pathname)
  }, [])

  useEffect(() => {
    // Страховка к guardPrivateNavigation: в непубличный роут попали без клика
    // по ссылке (navigate() в коде, «назад» в браузере) — Вебвизор там писать
    // не должен, перезагружаемся, и счётчик поднимется уже без него.
    if (isWebvisorSession() && !isPublicPath(pathname)) {
      window.location.reload()
      return
    }
    // В Метрику — адрес без #hash и без служебных параметров входа: после
    // возврата с Яндекса или ВК в адресе бывает ?code=… / ?vk_ticket=… (или токены в hash у старых
    // ссылок) — наружу это уходить не должно.
    const clean = new URL(window.location.href)
    clean.hash = ''
    for (const k of ['code', 'error', 'error_code', 'error_description', 'vk_ticket', 'vk_error']) clean.searchParams.delete(k)
    const url = clean.href
    // тик — дать ленивой странице (404) поставить свой заголовок
    const t = setTimeout(() => {
      hit(url, { title: document.title, referer: prevUrl.current ?? document.referrer })
      prevUrl.current = url
    }, 0)
    return () => clearTimeout(t)
  }, [pathname, search])

  return null
}
