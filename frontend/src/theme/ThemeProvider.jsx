import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/* ============================================================
   ThemeProvider — три темы: 'light' | 'dark' | 'archive'
   ------------------------------------------------------------
   • light   — кремовый дизайн (оверрайдов нет, styles.css).
   • dark    — тёмная версия того же дизайна (theme-dark.css).
   • archive — «Архив»: бумажный терминал полевого анализа
               (theme-archive.css + components/archive/*).

   Переключение плавное, без переходных эффектов.
   data-theme на <html>; выбор хранится в localStorage.

   Готическая тема 'gtc' («свага») удалена полностью — сохранённый
   у пользователя выбор мигрирует в 'dark' (см. MIGRATE). 'archive'
   к ней отношения не имеет: это НЕ возврат gtc, а отдельный слой
   представления с собственными компонентами.
   ============================================================ */

const ThemeCtx = createContext(null);
export const useTheme = () => useContext(ThemeCtx);

const STORAGE_KEY   = 'kh-theme';
const DEFAULT_THEME = 'light';
const VALID   = ['light', 'dark', 'archive'];
// старые значения из прошлых версий: 'normal' → light, 'swag'/'gtc' → dark
const MIGRATE = { normal: 'light', swag: 'dark', gtc: 'dark' };

/* ── Шрифты темы «Архив» — Play / Jura / IBM Plex Mono ───────────────────
   Подключаются ТОЛЬКО когда тема реально включена: @import в CSS тянул бы
   три семейства при каждой загрузке сайта, в том числе на логине, где из
   них не нужен ни один. Файлы — свои (src/fonts/fonts-archive.css), не
   Google Fonts: см. шапку src/fonts/fonts.css. Динамический import CSS —
   Vite сам вставит <link> один раз, повторные вызовы ничего не делают. */
const ensureArchiveFonts = () => {
  if (typeof document === 'undefined') return;
  import('../fonts/fonts-archive.css').catch(() => {});
};

const prefersReduced =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const readInitial = () => {
  try {
    let v = localStorage.getItem(STORAGE_KEY);
    if (v && MIGRATE[v]) v = MIGRATE[v];
    if (VALID.includes(v)) return v;
  } catch (_) {}
  return DEFAULT_THEME;
};

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readInitial);

  // зеркало для синхронного чтения в setTheme()
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // отражаем тему на <html> + сохраняем выбор (в т.ч. результат миграции)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    if (mode === 'archive') ensureArchiveFonts();
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (_) {}
  }, [mode]);

  const setTheme = useCallback((target) => {
    if (!VALID.includes(target) || target === modeRef.current) return;
    modeRef.current = target;
    setModeState(target);
  }, []);

  const value = {
    mode,
    isLight:   mode === 'light',
    isDark:    mode === 'dark',
    isArchive: mode === 'archive',
    setTheme,
    reducedMotion: prefersReduced,
  };

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
