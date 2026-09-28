import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { findRoute, headSpec } from './routes'

/* ════════════════════════════════════════════════════════════════════════
   RouteMeta — мета <head> при переходах внутри SPA.

   Первый заход на любую страницу получает правильный <head> от сервера
   (пререндер / shell.html из vite-plugin-seo.js). Здесь — только то, что
   меняется БЕЗ перезагрузки: переход с / на /privacy, на /login и т.д.
   Без этого после клиентского перехода в документе оставались бы canonical
   и description предыдущей страницы, а у /app не было бы noindex.

   Описание тегов — headSpec() в routes.js, то же, что у пререндера.
   Меняем только блок между <!--seo:start--> и <!--seo:end--> и document.title.
   Несуществующий адрес: title ставит сама NotFound.jsx, здесь — noindex.
   ════════════════════════════════════════════════════════════════════════ */

function seoRegion() {
  let start = null, end = null
  for (const n of document.head.childNodes) {
    if (n.nodeType !== Node.COMMENT_NODE) continue
    if (n.data === 'seo:start') start = n
    else if (n.data === 'seo:end') end = n
  }
  if (!start || !end) {
    start = document.createComment('seo:start')
    end = document.createComment('seo:end')
    document.head.append(start, end)
  }
  return { start, end }
}

export default function RouteMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    const route = findRoute(pathname)
    const { title, tags } = headSpec(route)
    if (title) document.title = title

    const { start, end } = seoRegion()
    while (start.nextSibling && start.nextSibling !== end) start.nextSibling.remove()
    for (const t of tags) {
      const el = document.createElement(t.tag)
      for (const [k, v] of Object.entries(t.attrs)) el.setAttribute(k, v)
      document.head.insertBefore(el, end)
    }
  }, [pathname])

  return null
}
