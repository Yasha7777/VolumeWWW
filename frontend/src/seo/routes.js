/* ════════════════════════════════════════════════════════════════════════
   РОУТЫ ДЛЯ ПОИСКА — единственный источник правды.

   Отсюда берут данные:
     • RouteMeta.jsx — title / description / canonical / robots при смене роута;
     • scripts/vite-plugin-seo.js — пререндер публичных страниц, sitemap.xml
       и проверка, что роуты App.jsx, этот файл и frontend/nginx.conf
       совпадают (разъехались → сборка падает).

   Файл читается и браузером, и Node на сборке — поэтому здесь только
   данные, без JSX и без импортов.

   Добавляешь роут в App.jsx → добавь его сюда (PUBLIC или PRIVATE) и в
   nginx.conf (иначе nginx отдаст на него честный 404).

   Тексты: title 50–60 символов (главный запрос в начале, бренд в конце),
   description 140–160. Никаких неподтверждённых цифр — ни точности, ни
   «бесплатно»: это обещание, которое поисковик покажет в выдаче.
   ════════════════════════════════════════════════════════════════════════ */

export const SITE_URL = 'https://volumetric.gottland.ru'
export const BRAND = 'Volumetric Gottland'
export const SITE_NAME = 'Карелия Строй'

// 1200×630, JPEG — webp понимают не все, кто строит превью ссылок.
// Кадр 0.5 c из public/landing/video.mp4 (hero.webp не годится: полоса 1512×240).
export const OG_IMAGE = { path: '/og-cover.jpg', width: 1200, height: 630, alt: 'Ночная стройка: трое в касках за ноутбуками у насыпи, на экранах — её 3D-модель' }

// Публичные: пререндерятся в статический HTML, попадают в sitemap.xml.
// `file` — куда пререндер кладёт страницу в dist (nginx отдаёт её по `path`).
// `sources` — по последнему коммиту этих файлов считается lastmod в sitemap.
export const PUBLIC_ROUTES = [
  {
    path: '/',
    file: 'index.html',
    page: 'landing',
    title: 'Расчёт объёма и массы насыпи по фото — Volumetric Gottland',
    description: 'Снимите насыпь щебня, песка или грунта на телефон со всех сторон — сервис соберёт 3D-модель, посчитает объём в м³ и массу в тоннах и выдаст PDF-отчёт.',
    sources: ['src/pages/Landing.jsx', 'src/landing.css', 'src/seo/routes.js'],
  },
  {
    path: '/privacy',
    file: 'privacy.html',
    page: 'privacy',
    title: 'Политика обработки персональных данных — Volumetric Gottland',
    description: 'Политика обработки персональных данных сервиса «Карелия Строй»: какие данные мы собираем, для чего, как их защищаем и как отозвать согласие на обработку.',
    sources: ['src/pages/Privacy.jsx'],
  },
]

// Непубличные: не пререндерятся, отдаются пустой оболочкой shell.html
// c noindex (мета + заголовок X-Robots-Tag из nginx), закрыты в robots.txt.
export const PRIVATE_ROUTES = [
  { path: '/login',    title: 'Вход — Volumetric Gottland' },
  { path: '/register', title: 'Регистрация — Volumetric Gottland' },
  { path: '/app',      title: 'Новый замер — Volumetric Gottland' },
  { path: '/history',  title: 'История замеров — Volumetric Gottland' },
  { path: '/profile',  title: 'Профиль — Volumetric Gottland' },
  { path: '/reports',  title: 'Отчёты — Volumetric Gottland' },
]

export const ROBOTS_NOINDEX = 'noindex, nofollow'

// Несуществующий адрес. Заголовок ставит сама NotFound.jsx (держи строки
// одинаковыми) — здесь он для пререндера 404.html.
export const NOT_FOUND = { path: '/404', file: '404.html', page: 'notfound', title: '404 · страница утеряна — Карелия Строй' }

export const findRoute = (pathname) =>
  PUBLIC_ROUTES.find((r) => r.path === pathname) ||
  PRIVATE_ROUTES.find((r) => r.path === pathname) ||
  null

export const isPublicPath = (pathname) => PUBLIC_ROUTES.some((r) => r.path === pathname)

export const canonicalUrl = (path) => SITE_URL + (path === '/' ? '/' : path)

/* Теги <head> страницы — ОДНО описание на две стороны: плагин сборки
   превращает его в HTML (пререндер), RouteMeta.jsx — в DOM при смене роута.
   title живёт отдельно от tags: <title> в документе один, его меняют через
   document.title, а tags целиком лежат между <!--seo:start--> и <!--seo:end-->.
   Публичная страница — description, canonical, Open Graph; всё остальное
   (непубличная, 404) — только robots: noindex. */
export function headSpec(route) {
  const pub = !!route && isPublicPath(route.path)
  if (!pub) return { title: route?.title ?? null, tags: [{ tag: 'meta', attrs: { name: 'robots', content: ROBOTS_NOINDEX } }] }
  const url = canonicalUrl(route.path)
  const meta = (key, name, content) => ({ tag: 'meta', attrs: { [key]: name, content } })
  return {
    title: route.title,
    tags: [
      meta('name', 'description', route.description),
      { tag: 'link', attrs: { rel: 'canonical', href: url } },
      meta('property', 'og:type', 'website'),
      meta('property', 'og:site_name', BRAND),
      meta('property', 'og:locale', 'ru_RU'),
      meta('property', 'og:url', url),
      meta('property', 'og:title', route.title),
      meta('property', 'og:description', route.description),
      meta('property', 'og:image', SITE_URL + OG_IMAGE.path),
      meta('property', 'og:image:type', 'image/jpeg'),
      meta('property', 'og:image:width', String(OG_IMAGE.width)),
      meta('property', 'og:image:height', String(OG_IMAGE.height)),
      meta('property', 'og:image:alt', OG_IMAGE.alt),
      meta('name', 'twitter:card', 'summary_large_image'),
    ],
  }
}
