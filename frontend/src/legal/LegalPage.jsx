import { Link } from 'react-router-dom'

/* Общая вёрстка юридических страниц: /privacy, /consent, /terms.
   Тексты — в самих страницах (pages/Privacy.jsx, Consent.jsx, Terms.jsx).
   Редакция (дата) у всех трёх одна — LEGAL_EDITION; меняешь текст по существу →
   поменяй её и CONSENT_VERSION в legal/consent.js (тогда пользователей
   попросят согласиться заново).

   H1 на странице ровно один — этого требует пререндер (vite-plugin-seo.js). */
export const LEGAL_EDITION = '8 октября 2026 г.'
export const OPERATOR = 'Качалин Яков Дмитриевич'
// падежи — чтобы в тексте не выходило «согласие гражданину РФ Качалин…»
export const OPERATOR_DAT = 'Качалину Якову Дмитриевичу'     // кому
export const OPERATOR_INS = 'Качалиным Яковом Дмитриевичем'  // кем
export const OPERATOR_EMAIL = 'yakov.kachalin@mail.ru'
export const SERVICE = 'Volumetric Gottland'
export const SITE = 'volumetric.gottland.ru'

const H2 = { fontSize: 'inherit', lineHeight: 'inherit', marginTop: 0 }
const HR = { margin: '20px 0', border: 'none', borderTop: '1px solid var(--border)' }
const LINK = { color: 'var(--text)', textDecoration: 'underline' }

// Раздел документа: настоящий <h2> (иерархия для поиска и скринридеров),
// выглядит как жирная строка текста. Разделитель — перед каждым, кроме первого.
export function Sec({ title, first = false, children }) {
  return (
    <section>
      {!first && <hr style={HR} />}
      <h2 style={H2}>{title}</h2>
      {children}
    </section>
  )
}

export const UL = ({ children }) => <ul style={{ paddingLeft: 20, marginBottom: 16 }}>{children}</ul>
export const Mail = () => <strong>{OPERATOR_EMAIL}</strong>

const DOCS = [
  { to: '/privacy', label: 'Политика обработки персональных данных' },
  { to: '/consent', label: 'Согласие на обработку персональных данных' },
  { to: '/terms',   label: 'Пользовательское соглашение' },
]

export default function LegalPage({ path, title, children }) {
  return (
    <main className="page content" style={{ maxWidth: 800, margin: '0 auto', paddingBottom: 40 }}>
      <h1 className="page-title" style={{ marginBottom: 8, fontSize: 24 }}>{title}</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>Редакция от {LEGAL_EDITION}</p>

      <div className="card" style={{ padding: '24px 32px', fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
        {children}
      </div>

      <nav aria-label="Документы сервиса" style={{ marginTop: 20, fontSize: 13, lineHeight: 1.9, color: 'var(--muted)' }}>
        <Link to="/" style={LINK}>На главную</Link>
        {DOCS.filter((d) => d.to !== path).map((d) => (
          <span key={d.to}>{' · '}<Link to={d.to} style={LINK}>{d.label}</Link></span>
        ))}
      </nav>
    </main>
  )
}
