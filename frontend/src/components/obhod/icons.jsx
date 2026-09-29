/* Мелкие залитые иконки строк карточки обхода (в мокапе они сплошные, а не
   контурные, как lucide). 16×16, цвет — currentColor. */
const base = { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true }

export const IcoCalendar = () => (
  <svg {...base}><path fillRule="evenodd" d="M5 1h1.5v2h3V1H11v2h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2V1Zm-1.5 6v5.5h9V7h-9Z" /></svg>
)
export const IcoImages = () => (
  <svg {...base}><path fillRule="evenodd" d="M5 2h8.5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1 8.5h7l-2.4-3.2-1.8 2.3-1.2-1.5L6 10.5Zm1.6-4.6a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4ZM1.5 5H3v8h8.5v1.5H2.5a1 1 0 0 1-1-1V5Z" /></svg>
)
export const IcoClock = () => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 4.8V8l2.2 1.4" /></svg>
)
export const IcoUser = () => (
  <svg {...base}><circle cx="8" cy="4.8" r="3" /><path d="M2.3 14.5c.3-3.2 2.8-5.3 5.7-5.3s5.4 2.1 5.7 5.3H2.3Z" /></svg>
)
export const IcoPin = () => (
  <svg {...base}><path fillRule="evenodd" d="M8 1a5 5 0 0 1 5 5c0 3.7-5 9-5 9S3 9.7 3 6a5 5 0 0 1 5-5Zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" /></svg>
)
