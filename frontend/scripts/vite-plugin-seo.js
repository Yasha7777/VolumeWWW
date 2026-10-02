/* ════════════════════════════════════════════════════════════════════════
   vite-plugin-seo — всё, что поиску нужно от сборки.

   Данные — src/seo/routes.js.

   • <head>: метку <!--seo--> в index.html заменяет блок тегов главной —
     title, description, canonical, Open Graph, twitter:card (и в dev тоже).
   • ПРЕРЕНДЕР (только `vite build`). Отдельная SSR-сборка
     src/prerender/entry-server.jsx → renderToString каждой публичной
     страницы → в dist лежит HTML с текстом, H1 и метой без выполнения JS:
       index.html   — лендинг (/)
       privacy.html — /privacy
       consent.html — /consent
       terms.html   — /terms
       404.html     — страница 404 (nginx отдаёт её со статусом 404)
     В <head> лендинга — JSON-LD из landingJsonLd() (routes.js).
       shell.html   — ПУСТАЯ оболочка с noindex для непубличных роутов
                      (/login, /app, …) и для service worker: иначе на /app до
                      старта JS мелькал бы лендинг из index.html.
     В браузере пререндер не гидрируется, а заменяется живым React
     (createRoot, см. main.jsx): пользователь из кэша авторизации у клиента
     есть, а на сборке его нет — гидрация бы разъехалась.
   • sitemap.xml — только публичные канонические адреса. lastmod — дата
     последнего коммита исходников страницы (а не дата сборки: та меняется
     при каждой пересборке, и Яндекс перестаёт lastmod верить). Исходники
     правятся прямо сейчас (есть незакоммиченные изменения) → сегодняшняя дата.

   • СВЕРКА РОУТОВ (buildStart, до всего остального): роуты App.jsx,
     src/seo/routes.js, белый список nginx.conf и Disallow в robots.txt
     обязаны совпадать. Новый роут, забытый в nginx, получил бы честный 404,
     забытый в routes.js — не получил бы ни меты, ни noindex.

   ПОРЯДОК ВАЖЕН. closeBundle здесь `order: 'pre'`: он обязан отработать
   ДО vite-plugin-pwa, который в своём closeBundle собирает service worker
   и глобом по dist/ составляет список прекэша. Всё, что мы пишем в dist
   позже него, в прекэш не попадёт.

   Любая ошибка здесь роняет сборку целиком — это намеренно: лучше не
   собраться, чем выкатить сайт без страниц.
   ════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build as viteBuild } from 'vite'
import react from '@vitejs/plugin-react'
import { PUBLIC_ROUTES, PRIVATE_ROUTES, NOT_FOUND, BRAND, canonicalUrl, headSpec, landingJsonLd } from '../src/seo/routes.js'

// Исходник страницы = ключ в манифесте клиентской сборки (по нему находим
// чанк и CSS страницы, чтобы подключить их прямо в HTML).
const PAGE_SRC = {
  landing: 'src/pages/Landing.jsx',
  privacy: 'src/pages/Privacy.jsx',
  consent: 'src/pages/Consent.jsx',
  terms: 'src/pages/Terms.jsx',
  notfound: 'src/pages/NotFound.jsx',
}
// Оболочка непубличных роутов: title — бренд (настоящий ставит RouteMeta
// после старта JS), headSpec для непубличного пути даёт noindex.
const SHELL = { path: '/shell', file: 'shell.html', title: BRAND }

// Шрифты первого экрана лендинга — preload, чтобы H1 и подзаголовок не ждали
// цепочку HTML → CSS → woff2. Только кириллица: весь текст первого экрана
// русский, латиница догрузится по unicode-range, если понадобится.
// Файлы — из src/fonts/files, Vite кладёт их в /assets/ с хэшем.
const LANDING_FONTS = [
  'cormorant-garamond-cyrillic',          // H1, прямое начертание
  'cormorant-garamond-italic-cyrillic',   // H1, золотая курсивная строка
  'onest-cyrillic',                       // навигация, подзаголовок, кнопки
]

function fontPreloads(outDir) {
  const files = readdirSync(resolve(outDir, 'assets'))
  return LANDING_FONTS.map((base) => {
    const f = files.find((n) => n.startsWith(`${base}-`) && n.endsWith('.woff2') && /^[A-Za-z0-9_-]{8}$/.test(n.slice(base.length + 1, -6)))
    if (!f) throw new Error(`kb-seo: не найден шрифт ${base}-*.woff2 в dist/assets`)
    return `<link rel="preload" href="/assets/${f}" as="font" type="font/woff2" crossorigin>`
  }).join('\n    ')
}

// Без JS анимации motion так и остаются в стартовом кадре (opacity:0, blur) —
// текст в DOM есть, но его не видно. Для тех, у кого JS выключен, снимаем
// стартовые стили. CSP разрешает inline-стили ('unsafe-inline' в style-src).
const NOSCRIPT_REVEAL =
  '<noscript><style>[style*="opacity:0"]{opacity:1!important;filter:none!important;transform:none!important}</style></noscript>'

const today = () => new Date().toISOString().slice(0, 10)

// JSON-LD — блок данных, а не скрипт: CSP script-src его не касается.
// `<` экранируем, чтобы строка с «</script>» не закрыла тег раньше времени.
const jsonLdTag = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`

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

// ── SSR-сборка entry-server.jsx ──────────────────────────────────────────
// context/AuthContext подменяется заглушкой «гость» (auth-stub.js):
// настоящий при импорте создаёт клиент Supabase и лезет в браузерные API.
function prerenderStubs(root) {
  const real = resolve(root, 'src/context/AuthContext.jsx')
  const stub = resolve(root, 'src/prerender/auth-stub.js')
  return {
    name: 'kb-prerender-stubs',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.includes('AuthContext')) return null
      const r = await this.resolve(source, importer, { ...options, skipSelf: true })
      return r?.id === real ? stub : null
    },
  }
}

async function buildRenderer(root, mode) {
  const outDir = resolve(root, 'node_modules/.cache/kb-prerender')
  await viteBuild({
    configFile: false,          // без PWA и без этого же плагина — никакой рекурсии
    root, mode, logLevel: 'warn',
    plugins: [react(), prerenderStubs(root)],
    build: {
      ssr: 'src/prerender/entry-server.jsx',
      outDir, emptyOutDir: true, copyPublicDir: false, minify: false,
    },
  })
  const mod = await import(`${pathToFileURL(resolve(outDir, 'entry-server.js')).href}?t=${Date.now()}`)
  return { render: mod.render, cleanup: () => rmSync(outDir, { recursive: true, force: true }) }
}

// JS-чанк страницы и весь её CSS (рекурсивно по статическим импортам) —
// чтобы пререндер пришёл сразу со стилями, а чанк качался параллельно с
// входным, а не после него. Входной чанк и то, что уже есть в шаблоне, — мимо.
function pageAssets(manifest, srcKey, template) {
  if (!manifest[srcKey]) throw new Error(`kb-seo: в манифесте сборки нет ${srcKey}`)
  const css = new Set(), js = new Set(), seen = new Set()
  const walk = (key) => {
    if (seen.has(key)) return
    seen.add(key)
    const e = manifest[key]
    if (!e || e.isEntry) return
    js.add(e.file)
    for (const c of e.css || []) css.add(c)
    for (const k of e.imports || []) walk(k)
  }
  walk(srcKey)
  const fresh = (f) => !template.includes(`/${f}"`) && !/vendor-(three|pdf)/.test(f)
  return [
    ...[...css].filter(fresh).map((f) => `<link rel="stylesheet" crossorigin href="/${f}">`),
    ...[...js].filter(fresh).map((f) => `<link rel="modulepreload" crossorigin href="/${f}">`),
  ].join('\n    ')
}

function assemble(template, { route, body = '', page = null, head = '' }) {
  const seoBlock = /<title>[\s\S]*?<!--seo:end-->/
  if (!seoBlock.test(template)) throw new Error('kb-seo: в шаблоне нет блока <title>…<!--seo:end-->')
  if (!template.includes('<div id="root"></div>')) throw new Error('kb-seo: в шаблоне нет <div id="root"></div>')
  return template
    .replace(seoBlock, headTags(route))
    .replace('</head>', head ? `  ${head}\n  </head>` : '</head>')
    .replace('<div id="root"></div>', `<div id="root"${page ? ` data-page="${page}"` : ''}>${body}</div>`)
}

// Страница без H1 или без текста — значит, пререндер сломался. Выкатывать
// такое нельзя: для поиска это снова пустая оболочка.
function assertRendered(name, body) {
  const h1 = (body.match(/<h1[\s>]/g) || []).length
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (h1 !== 1) throw new Error(`kb-seo: ${name} — H1 должен быть ровно один, найдено ${h1}`)
  if (text.length < 200) throw new Error(`kb-seo: ${name} — в пререндере почти нет текста (${text.length} симв.)`)
}

async function prerender(root, outDir, mode) {
  const templatePath = resolve(outDir, 'index.html')
  const manifestPath = resolve(outDir, '.vite/manifest.json')
  if (!existsSync(manifestPath)) throw new Error('kb-seo: нет .vite/manifest.json — в vite.config нужен build.manifest: true')
  const template = readFileSync(templatePath, 'utf8')   // читаем ДО перезаписи index.html
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

  const { render, cleanup } = await buildRenderer(root, mode)
  try {
    const pages = [...PUBLIC_ROUTES, NOT_FOUND]
    for (const route of pages) {
      const body = render(route.page, route.path)
      assertRendered(route.file, body)
      const head = [
        pageAssets(manifest, PAGE_SRC[route.page], template),
        NOSCRIPT_REVEAL,
        route.page === 'landing' ? fontPreloads(outDir) : '',
        route.page === 'landing' ? jsonLdTag(landingJsonLd()) : '',
      ].filter(Boolean).join('\n    ')
      writeFileSync(resolve(outDir, route.file), assemble(template, { route, body, page: route.page, head }))
    }
    writeFileSync(resolve(outDir, SHELL.file), assemble(template, { route: SHELL }))
  } finally {
    cleanup()
    rmSync(resolve(outDir, '.vite'), { recursive: true, force: true })   // манифест не публикуем
  }
}

// ── Сверка роутов ────────────────────────────────────────────────────────
function checkRoutes(root) {
  const read = (f) => readFileSync(resolve(root, f), 'utf8')
  const app = [...read('src/App.jsx').matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*')
  const nginx = read('nginx.conf')
  const ngPublic = [...nginx.matchAll(/location = (\/[a-z0-9-]*) \{\s*try_files \/[a-z0-9-]+\.html =404;/g)].map((m) => m[1])
  const ngPrivate = (nginx.match(/location ~ \^\/\(([a-z0-9|-]+)\)\$ \{\s*try_files \/shell\.html =404;/)?.[1] ?? '')
    .split('|').filter(Boolean).map((s) => `/${s}`)
  const robots = [...read('public/robots.txt').matchAll(/^Disallow: (\/[a-z0-9-]+)\$$/gm)].map((m) => m[1])

  const pub = PUBLIC_ROUTES.map((r) => r.path)
  const priv = PRIVATE_ROUTES.map((r) => r.path)
  const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
  const problems = []
  if (!same(app, [...pub, ...priv])) problems.push(`App.jsx: ${app.join(' ')}\n    routes.js: ${[...pub, ...priv].join(' ')}`)
  if (!same(ngPublic, pub)) problems.push(`nginx.conf, публичные (location = …): ${ngPublic.join(' ') || '—'}\n    routes.js PUBLIC_ROUTES: ${pub.join(' ')}`)
  if (!same(ngPrivate, priv)) problems.push(`nginx.conf, непубличные (→ shell.html): ${ngPrivate.join(' ') || '—'}\n    routes.js PRIVATE_ROUTES: ${priv.join(' ')}`)
  const notClosed = priv.filter((p) => !robots.includes(p))
  if (notClosed.length) problems.push(`robots.txt: нет «Disallow: <роут>$» для ${notClosed.join(' ')}`)
  if (problems.length) {
    throw new Error(`kb-seo: роуты разъехались — поправь, иначе на проде будут 404 или страницы без noindex:\n  - ${problems.join('\n  - ')}`)
  }
}

export default function seo() {
  let config
  return {
    name: 'kb-seo',
    configResolved(c) { config = c },
    buildStart() {
      if (config.command === 'build' && !config.build.ssr) checkRoutes(config.root)
    },
    // И в dev, и в сборке: шаблон получает теги главной (по умолчанию).
    transformIndexHtml(html) {
      if (!html.includes('<!--seo-->')) throw new Error('kb-seo: в index.html нет метки <!--seo-->')
      return html.replace('<!--seo-->', headTags(PUBLIC_ROUTES.find((r) => r.path === '/')))
    },
    closeBundle: {
      order: 'pre',
      sequential: true,
      async handler(error) {
        if (error || config.command !== 'build' || config.build.ssr) return
        const outDir = resolve(config.root, config.build.outDir)
        await prerender(config.root, outDir, config.mode)
        writeFileSync(resolve(outDir, 'sitemap.xml'), sitemapXml(config.root))
      },
    },
  }
}
