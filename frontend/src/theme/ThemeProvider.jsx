import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/* ============================================================
   ThemeProvider — две темы: 'light' | 'dark'
   ------------------------------------------------------------
   • light — кремовый дизайн (оверрайдов нет, styles.css).
   • dark  — тёмная версия того же дизайна (theme-dark.css).

   Переключение плавное, без переходных эффектов.
   data-theme на <html>; выбор хранится в localStorage.

   Готическая тема 'gtc' («свага») удалена полностью — сохранённый
   у пользователя выбор мигрирует в 'dark' (см. MIGRATE).
   ============================================================ */

const ThemeCtx = createContext(null);
export const useTheme = () => useContext(ThemeCtx);

const STORAGE_KEY   = 'kh-theme';
const DEFAULT_THEME = 'light';
const VALID   = ['light', 'dark'];
// старые значения из прошлых версий: 'normal' → light, 'swag'/'gtc' → dark
const MIGRATE = { normal: 'light', swag: 'dark', gtc: 'dark' };

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
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (_) {}
  }, [mode]);

  const setTheme = useCallback((target) => {
    if (!VALID.includes(target) || target === modeRef.current) return;
    modeRef.current = target;
    setModeState(target);
  }, []);

  const value = {
    mode,
    isLight: mode === 'light',
    isDark:  mode === 'dark',
    setTheme,
    reducedMotion: prefersReduced,
  };

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
