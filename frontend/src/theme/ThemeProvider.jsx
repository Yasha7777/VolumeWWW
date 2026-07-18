import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/* ============================================================
   ThemeProvider — три темы: 'light' | 'dark' | 'gtc'
   ------------------------------------------------------------
   • light — кремовый дизайн (оверрайдов нет).
   • dark  — тёмная версия того же дизайна (swag.css).
   • gtc   — готическая «свага» (фон, вуаль, металл-заголовки).

   Переход В gtc сопровождается полноэкранным «разломом» (flipping).
   Свет↔тьма переключаются плавно, без разлома.
   data-theme на <html>; выбор хранится в localStorage. Интро-вуаль —
   при загрузке, только если активна gtc и не включён reduced-motion.

   Имена файлов исторически swag.* / components/swag/ — значение
   темы теперь 'gtc'.
   ============================================================ */

const ThemeCtx = createContext(null);
export const useTheme = () => useContext(ThemeCtx);

const STORAGE_KEY   = 'kh-theme';
const DEFAULT_THEME = 'light';                 // ← поменяй на 'light' для нейтрального логина
const VALID   = ['light', 'dark', 'gtc'];
const MIGRATE = { normal: 'light', swag: 'gtc' };  // старые значения из прошлых версий

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
  const [flipping, setFlipping] = useState(false);
  const [intro, setIntro] = useState(() => mode === 'gtc' && !prefersReduced);

  // зеркала для синхронного чтения в setTheme()
  const modeRef = useRef(mode);
  const flipRef = useRef(false);
  const timers = useRef([]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // отражаем тему на <html> + сохраняем выбор
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (_) {}
  }, [mode]);

  // авто-закрытие интро-вуали (один раз за загрузку)
  useEffect(() => {
    if (!intro) return;
    const t = setTimeout(() => setIntro(false), 3400);
    return () => clearTimeout(t);
  }, [intro]);

  // чистим хвостовые таймеры разлома при размонтировании
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const skipIntro = useCallback(() => setIntro(false), []);

  const setTheme = useCallback((target) => {
    if (!VALID.includes(target) || flipRef.current || target === modeRef.current) return;

    // драматичный разлом — только на ВХОД в gtc
    const dramatic = target === 'gtc' && !prefersReduced;
    if (dramatic) {
      flipRef.current = true;
      setFlipping(true);
      const t1 = setTimeout(() => { modeRef.current = target; setModeState(target); }, 470);
      const t2 = setTimeout(() => { flipRef.current = false; setFlipping(false); }, 960);
      timers.current.push(t1, t2);
    } else {
      modeRef.current = target;
      setModeState(target);   // свет↔тьма (и выход из gtc) — плавно
    }
  }, []);

  const value = {
    mode,
    isLight: mode === 'light',
    isDark:  mode === 'dark',
    isGtc:   mode === 'gtc',
    flipping,
    setTheme,
    intro,
    skipIntro,
    reducedMotion: prefersReduced,
  };

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
