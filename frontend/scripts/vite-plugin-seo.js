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
import { PUBLIC_ROUTES, canonicalUrl, headSpec } from '../src/seo/routes.js'

const today = () => new Date().toISOString().slice(0, 10)

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// <title> + блок тегов между метками seo:start/seo:end (описание — headSpec
// в routes.js, общее с RouteMeta.jsx). По меткам пререндер находит блок и
// переписывает его под конкретную страницу.
export function headTags(route) {
  const { title, tags } = headSpec(route)
  const attrs = (a) => Object.entries(a).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')
  const lines = tags.map((t) => `<${t.tag} ${attrs(t.attrs)} />`)
  return `<title>${esc(title)}</title>\n    <!--seo:start-->\n    ${lines.join('\n    ')}\n    <!--seo:end-->`
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
