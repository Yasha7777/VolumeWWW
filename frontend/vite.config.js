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
      if (!id.includes('node_modules')) return undefined
      if (id.includes('@react-pdf')) return 'vendor-pdf'
      if (id.includes('@react-three') || id.includes('/three/') || id.includes('three-stdlib') || id.includes('three-mesh-bvh') || id.includes('troika')) return 'vendor-three'
      if (id.includes('@supabase')) return 'vendor-supabase'
      return undefined
    } } },
  },
})
