import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',   // свой sw.js (там sync + push в перспективе)
      srcDir: 'src',
      filename: 'sw.js',
      injectRegister: null,           // регистрируем вручную в main.jsx
      devOptions: { enabled: false }, // SW только в проде — не мешает dev-прокси на /api
      manifest: {
        name: 'Karelia Build AI — Объём и вес',
        short_name: 'Karelia Build',
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
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  server: { proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } },
  build: {
    chunkSizeWarningLimit: 1600,
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
