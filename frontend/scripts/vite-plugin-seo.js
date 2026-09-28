/* ════════════════════════════════════════════════════════════════════════
   vite-plugin-seo — всё, что поиску нужно от сборки.

   Данные — src/seo/routes.js.

   • <head>: метку <!--seo--> в index.html заменяет блок тегов главной —
     title, description, canonical, Open Graph, twitter:card (и в dev тоже).
   • sitemap.xml (только `vite build`) — только публичные канонические адреса. lastmod — дата
     последнего коммита исходников страницы (а не дата сборки: та меняется
     при каждой пересборке, и Яндекс перестаёт lastmod верить). Исходники
     правятся прямо сейчас (есть незакоммиченные изменения) → сегодняшняя дата.

   ПОРЯДОК ВАЖЕН. closeBundle здесь `order: 'pre'`: он обязан отработать
   ДО vite-plugin-pwa, который в своём closeBundle собирает service worker
   и глобом по dist/ составляет список прекэша. Всё, что мы пишем в dist
   позже него, в прекэш не попадёт.

   Любая ошибка здесь роняет сборку целиком — это намеренно: лучше не
   собраться, чем выкатить сайт без страниц.
   ════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PUBLIC_ROUTES, BRAND, OG_IMAGE, SITE_URL, ROBOTS_NOINDEX, canonicalUrl } from '../src/seo/routes.js'

const today = () => new Date().toISOString().slice(0, 10)

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Блок <head> страницы. Обёрнут метками seo:start/seo:end — по ним пререндер
// находит и заменяет блок под конкретную страницу. Публичная страница получает
// canonical и Open Graph; непубличная — только title и noindex.
export function headTags(route, { noindex = false } = {}) {
  const t = []
  t.push(`<title>${esc(route.title)}</title>`)
  if (noindex) {
    t.push(`<meta name="robots" content="${ROBOTS_NOINDEX}" />`)
  } else {
    const url = canonicalUrl(route.path)
    const img = SITE_URL + OG_IMAGE.path
    t.push(
      `<meta name="description" content="${esc(route.description)}" />`,
      `<link rel="canonical" href="${url}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${esc(BRAND)}" />`,
      `<meta property="og:locale" content="ru_RU" />`,
      `<meta property="og:url" content="${url}" />`,
      `<meta property="og:title" content="${esc(route.title)}" />`,
      `<meta property="og:description" content="${esc(route.description)}" />`,
      `<meta property="og:image" content="${img}" />`,
      `<meta property="og:image:type" content="image/jpeg" />`,
      `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
      `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
      `<meta property="og:image:alt" content="${esc(OG_IMAGE.alt)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
    )
  }
  return `<!--seo:start-->\n    ${t.join('\n    ')}\n    <!--seo:end-->`
}

function lastmod(root, sources) {
  try {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
    if (git(['status', '--porcelain', '--', ...sources])) return today()
    return git(['log', '-1', '--format=%cs', '--', ...sources]) || today()
  } catch {
    return today()   // сборка вне git-репозитория
  }
}

function sitemapXml(root) {
  const urls = PUBLIC_ROUTES.map((r) =>
    `  <url>\n    <loc>${canonicalUrl(r.path)}</loc>\n    <lastmod>${lastmod(root, r.sources)}</lastmod>\n  </url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

export default function seo() {
  let config
  return {
    name: 'kb-seo',
    configResolved(c) { config = c },
    // И в dev, и в сборке: шаблон получает теги главной (по умолчанию).
    transformIndexHtml(html) {
      if (!html.includes('<!--seo-->')) throw new Error('kb-seo: в index.html нет метки <!--seo-->')
      return html.replace('<!--seo-->', headTags(PUBLIC_ROUTES.find((r) => r.path === '/')))
    },
    closeBundle: {
      order: 'pre',
      sequential: true,
      async handler() {
        if (config.command !== 'build' || config.build.ssr) return
        const outDir = resolve(config.root, config.build.outDir)
        writeFileSync(resolve(outDir, 'sitemap.xml'), sitemapXml(config.root))
      },
    },
  }
}
