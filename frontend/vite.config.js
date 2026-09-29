import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import seo from './scripts/vite-plugin-seo.js'

export default defineConfig({
  plugins: [
    react(),
    // sitemap / пререндер / сверка роутов. closeBundle у него `order: 'pre'` —
    // успевает до сборки service worker, см. шапку плагина.
    seo(),
    VitePWA({
      strategies: 'injectManifest',   // свой sw.js (там sync + push в перспективе)
      srcDir: 'src',
      filename: 'sw.js',
      injectRegister: null,           // регистрируем вручную в main.jsx
      devOptions: { enabled: false }, // SW только в проде — не мешает dev-прокси на /api
      manifest: {
        // 168-ФЗ: имя приложения — по-русски (его видно при установке PWA и
        // под иконкой на домашнем экране).
        name: 'Карелия Строй',
        short_name: 'Карелия Строй',
        description: 'Фотограмметрия строительных материалов: объём, тип, вес.',
        lang: 'ru',
        theme_color: '#122018',
        background_color: '#122018',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // Кешируем ВСЮ оболочку, включая vendor-three / vendor-pdf.
        // Раньше их исключал globIgnores — из-за этого офлайн рвал module-граф
        // (three статически подтягивается через SwagAtmosphere) → белый экран.
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        // Шрифты темы «Архив» (src/fonts/fonts-archive.css) — не в прекэш: они
        // нужны только тем, кто включил эту тему, а это ~200 КБ фоновой загрузки
        // при установке PWA каждому. Их CSS в прекэше есть; без сети тема
        // покажется системными шрифтами — как было, пока шрифты шли с Google.
        globIgnores: ['**/assets/play-*.woff2', '**/assets/jura-*.woff2', '**/assets/ibm-plex-mono-*.woff2'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  // /api в dev: локальный бэкенд (uvicorn :8000) или боевой — VITE_API_PROXY=https://volumetric.gottland.ru
  // в frontend/.env.local; тогда `npm run dev` работает с настоящим входом и данными.
  server: { proxy: { '/api': { target: process.env.VITE_API_PROXY || loadEnv('development', process.cwd(), '').VITE_API_PROXY || 'http://localhost:8000', changeOrigin: true, secure: true } } },
  build: {
    chunkSizeWarningLimit: 1600,
    // Декор «Анализа» — десятки мелких webp: инлайн раздул бы JS страницы
    // (и тёмная тема качала бы камни светлой). Отдаём файлами, грузится только
    // активная тема. Остальное — по умолчанию Vite (≤ 4 КБ инлайнится).
    assetsInlineLimit: (file) => (/components[\\/]obhod[\\/]img[\\/]/.test(file) ? false : undefined),
    // Манифест нужен пререндеру (vite-plugin-seo): по нему он находит чанк и
    // CSS страницы. После пререндера dist/.vite удаляется — наружу не уходит.
    manifest: true,
    // three/pdf тяжёлые и нужны только для 3D-вьювера и PDF. Убираем их из
    // стартового modulepreload, чтобы не грузились при каждом заходе —
    // подтянутся лениво при открытии соответствующего экрана.
    modulePreload: {
      resolveDependencies: (url, deps) => deps.filter(d => !/vendor-(three|pdf)/.test(d)),
    },
    rollupOptions: { output: { manualChunks(id) {
      // Хелпер предзагрузки Vite (__vitePreload) — ВИРТУАЛЬНЫЙ модуль, слова
      // node_modules в его id нет, поэтому проверка обязана стоять ДО общего
      // guard'а ниже. Без неё rollup клал хелпер в vendor-three, а он нужен
      // entry для КАЖДОГО динамического импорта → entry статически тянул
      // three на всех страницах. Кладём его к react: тот грузится всегда.
      if (id.includes('preload-helper')) return 'vendor-react'
      if (!id.includes('node_modules')) return undefined
      // `buffer` — общая зависимость polyfills.js и @react-pdf. Без явного
      // правила rollup клал её в vendor-pdf, а polyfills.js — ПЕРВЫЙ импорт
      // main.jsx, поэтому entry статически тянул 1.45 МБ pdf на каждой
      // странице. Свой крошечный чанк разрывает эту связь.
      if (/[\\/]node_modules[\\/](buffer|base64-js|ieee754)[\\/]/.test(id)) return 'vendor-polyfill'
      // ─────────────────────────────────────────────────────────────────────
      // React ВЫДЕЛЕН ЯВНО И ПЕРВЫМ — это не косметика, а починка бага.
      // Раньше правила для react здесь не было, и rollup был волен положить
      // его куда угодно. Он клал его в vendor-three (тот требует react первым),
      // ВМЕСТЕ с vite-хелпером предзагрузки. В результате entry-чанк получал
      // СТАТИЧЕСКИЙ `import {r,j,_} from "./vendor-three-*.js"`, и 1.12 МБ
      // three грузились на КАЖДОЙ странице — включая публичный лендинг и
      // форму входа, которым три-дэ не нужно вовсе (замерено в проде:
      // vendor-three 1119 kB + vendor-pdf 1455 kB на лендинге).
      // Приоритет строк здесь ЗНАЧИМ: react должен «застолбить» себя раньше,
      // чем его засосёт первый принудительный чанк.
      // ─────────────────────────────────────────────────────────────────────
      if (/[\\/]node_modules[\\/](react-router-dom|react-router|react-dom|scheduler|react)[\\/]/.test(id)) return 'vendor-react'
      if (id.includes('@react-pdf')) return 'vendor-pdf'
      if (id.includes('@react-three') || id.includes('/three/') || id.includes('three-stdlib') || id.includes('three-mesh-bvh') || id.includes('troika')) return 'vendor-three'
      if (id.includes('@supabase')) return 'vendor-supabase'
      return undefined
    } } },
  },
})
