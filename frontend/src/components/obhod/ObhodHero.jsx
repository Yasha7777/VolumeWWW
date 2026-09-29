import { Fragment } from 'react'

const STEPS = ['Обход', '3D-реконструкция', 'Объём и вес']

export function ObhodHero() {
  return (
    <section className="ks-hero">
      <h1 className="ks-hero__title">
        <span className="ks-hero__l1">Фото — и готово</span>
        <span className="ks-hero__l2">материал, объём и вес</span>
      </h1>
      <p className="ks-hero__sub">
        Выберите обход из мобильного приложения — система получит фотографии, <br />
        траекторию и данные съёмки.
      </p>
    </section>
  )
}

// current: 1..3 — активный шаг; 4 — всё готово (все шаги с галочкой)
export function ObhodStepper({ current = 1, first = 'Обход' }) {
  return (
    <ol className="ks-steps" aria-label="Шаги анализа">
      {[first, ...STEPS.slice(1)].map((label, i) => {
        const n = i + 1
        const cls = n === current ? ' is-current' : n < current ? ' is-done' : ''
        return (
          <Fragment key={n}>
            <li className={'ks-step' + cls} aria-current={n === current ? 'step' : undefined}>
              <span className="ks-step__dot">
                {n < current
                  ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
                  : n}
              </span>
              <span className="ks-step__label">{label}</span>
              {i < STEPS.length - 1 && <span className="ks-step__arrow" aria-hidden>→</span>}
            </li>
          </Fragment>
        )
      })}
    </ol>
  )
}
