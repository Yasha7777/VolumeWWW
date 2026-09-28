// Заглушка context/AuthContext для пререндера (см. entry-server.jsx):
// пререндер всегда рисует страницу для гостя. Подменяется плагином
// kb-prerender-stubs в scripts/vite-plugin-seo.js — только в SSR-сборке.
export function AuthProvider({ children }) { return children }
export const useAuth = () => ({ user: null, loading: false, degraded: false })
