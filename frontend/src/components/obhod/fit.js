import { useEffect, useState } from 'react'

/* Макет «Анализа» — кадр 1536×1024: шапка, заголовок и раскрытая панель
   целиком в одном экране. На ноутбуке окно ниже (1440×~780 у MacBook Air),
   и в натуральную величину панель уходит за край, а заголовок занимает
   полэкрана — картинка «не как в макете». Поэтому на широких, но невысоких
   окнах страница «Анализ» ужимается (CSS zoom) так, чтобы раскрытая панель
   влезала целиком. Не мельче 0.8 — дальше мелкий текст карточек плохо читается.
   На планшетах и телефонах (уже 1100 px) своя вёрстка — там 1. */
const CONTENT_H = 900 // от верха .ks-scope до низа раскрытой панели, px
const CANVAS_W = 1536

export function fitZoom(w = window.innerWidth, h = window.innerHeight) {
  if (w < 1100) return 1
  const z = Math.min((h - 64) / CONTENT_H, w / CANVAS_W, 1)
  return z > 0.97 ? 1 : Math.max(0.8, Math.round(z * 100) / 100)
}

export function useFitZoom() {
  const [z, setZ] = useState(() => (typeof window === 'undefined' ? 1 : fitZoom()))
  useEffect(() => {
    let raf = 0
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setZ(fitZoom())) }
    window.addEventListener('resize', on)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', on) }
  }, [])
  return z
}

// масштаб элемента на экране (zoom предков): видимая ширина / CSS-ширина
export const zoomOf = (el) => {
  const r = el.getBoundingClientRect()
  return el.offsetWidth ? r.width / el.offsetWidth : 1
}
