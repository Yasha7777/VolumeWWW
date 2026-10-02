/* ════════════════════════════════════════════════════════════════════════
   Точка входа ПРЕРЕНДЕРА (Vite SSR, только на сборке — в браузер не идёт).

   scripts/vite-plugin-seo.js собирает этот файл отдельной SSR-сборкой и
   зовёт render() для каждой публичной страницы из src/seo/routes.js, чтобы
   в dist лежал HTML с текстом, H1 и метой без выполнения JS.

   Обёртка повторяет DOM из App.jsx (div.app-shell, остальное DOM не
   рисует), чтобы при подмене пререндера живым React не было прыжка.
   Страницы импортированы статически: renderToString не дожидается lazy().

   context/AuthContext на время этой сборки подменён заглушкой (auth-stub.js):
   настоящий создаёт клиент Supabase и лезет в localStorage/IndexedDB, а
   пререндер — это страница для гостя.
   ════════════════════════════════════════════════════════════════════════ */
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import Landing from '../pages/Landing'
import Privacy from '../pages/Privacy'
import Consent from '../pages/Consent'
import Terms from '../pages/Terms'
import NotFound from '../pages/NotFound'

const PAGES = { landing: Landing, privacy: Privacy, consent: Consent, terms: Terms, notfound: NotFound }

export function render(page, url) {
  const Page = PAGES[page]
  if (!Page) throw new Error(`prerender: неизвестная страница «${page}»`)
  return renderToString(
    <StaticRouter location={url}>
      <div className="app-shell"><Page /></div>
    </StaticRouter>
  )
}
