/* ============================================================
   ArcPlate — служебная «таблица» на месте ещё не загруженного
   растра. Рисуется SVG, ассетов не тянет.
   ------------------------------------------------------------
   ПОЧЕМУ НЕ ФОТОГРАФИЯ. Два довода, и оба перевешивают красоту.

   1. Предмет. Система меряет объём ЛЮБОГО навала — щебень,
      песок, грунт, отвал, снег, опилки, лом. Любая конкретная
      фотография в заглушке молча сообщает «мы про щебень» и
      сужает продукт до одного материала. Обобщение здесь — не
      вкусовщина, а точность формулировки.
   2. Жанр. Это измерительный прибор. Заглушка обязана читаться
      как заглушка: фотореалистичный кадр в рамке, где через
      секунду будет НАСТОЯЩИЙ кадр объекта, путает данные с
      оформлением. Служебная таблица так не путается никогда.

   Отсюда и рисунок: не предмет, а ПРОЦЕДУРА — сетка высот
   (ровно то, что строит пайплайн из снимков) и приводочные
   метки съёмки. Форма нарочно безымянная: насыпь без материала.
   ============================================================ */

const VB_W = 320
const VB_H = 200

/* Иллюстрации темы. Лежат в public/archive/, отдаются со своего
   домена (внешних картинок CSP не пустит) и сжаты в webp под
   реальный экранный размер слота. */
export const ART = {
  mesh:   '/archive/mesh-crt.webp',      // ретро-рендер поля высот на сетке
  manual: '/archive/plate-manual.webp',  // печатная плата из справочника
  sample: '/archive/shot-sample.webp',   // образцовый кадр съёмки
}

/* ── поле высот ───────────────────────────────────────────────
   Сумма трёх АНИЗОТРОПНЫХ гауссиан: разные σ по осям дают
   вытянутый вал с гребнем и двумя подсыпками сбоку. Круглые
   гауссианы давали ровный колокол — он читался как график
   функции, а не как навал.

   Никакой случайности: рисунок обязан быть одним и тем же в
   каждой сборке, иначе заглушка «мигает» между рендерами. */
const height = (u, v) => {
  const g = (cu, cv, su, sv, a) =>
    a * Math.exp(-(((u - cu) ** 2) / (2 * su * su) + ((v - cv) ** 2) / (2 * sv * sv)))
  return (
    g(0.48, 0.50, 0.27, 0.145, 1) +
    g(0.72, 0.40, 0.11, 0.095, 0.42) +
    g(0.26, 0.63, 0.10, 0.120, 0.30)
  )
}

/* Индекс линии, идущей по хребту. Вал вытянут вдоль u, значит
   гребень — это линия постоянного v. */
const CREST_V = 0.50

const N = 16
const KX = 128, KY = 45, KZ = 68, OX = 160, OY = 56

const project = (u, v) => {
  const h = height(u, v)
  return [
    OX + (u - v) * KX,
    OY + (u + v) * KY - h * KZ,
  ]
}
const path = (points) =>
  points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')

function MeshPlate() {
  const lines = []
  const crestIdx = Math.round(N * CREST_V)
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const along = [], across = []
    for (let j = 0; j <= N; j++) {
      const s = j / N
      along.push(project(t, s))
      across.push(project(s, t))
    }
    // Подсвечена ОДНА линия — та, что идёт по хребту. Раньше
    // подсвечивались обе оси сразу, и вместо гребня выходил
    // яркий крест поперёк формы.
    lines.push({ d: path(along), crest: false })
    lines.push({ d: path(across), crest: i === crestIdx })
  }

  // основание: контур площадки, по которому считается объём
  const base = [
    [0, 0], [1, 0], [1, 1], [0, 1], [0, 0],
  ].map(([u, v]) => [OX + (u - v) * KX, OY + (u + v) * KY])

  return (
    <svg className="arc-plate__art" viewBox={`0 0 ${VB_W} ${VB_H}`} aria-hidden="true">
      <path className="arc-plate__base" d={path(base)} />
      {lines.map((l, i) => (
        <path key={i} className={`arc-plate__mesh${l.crest ? ' is-crest' : ''}`} d={l.d} />
      ))}
      {/* масштабная линейка под основанием */}
      <g className="arc-plate__scale">
        <line x1="40" y1="176" x2="280" y2="176" />
        {Array.from({ length: 13 }, (_, i) => (
          <line key={i} x1={40 + i * 20} y1={172} x2={40 + i * 20} y2={i % 4 ? 176 : 168} />
        ))}
      </g>
    </svg>
  )
}

function FramePlate() {
  const wedge = Array.from({ length: 7 }, (_, i) => i / 6)
  return (
    <svg className="arc-plate__art" viewBox={`0 0 ${VB_W} ${VB_H}`} aria-hidden="true">
      {/* кадрирующая рамка */}
      <rect className="arc-plate__crop" x="26" y="22" width="268" height="156" />
      {[[26, 22], [294, 22], [26, 178], [294, 178]].map(([x, y], i) => (
        <g key={i} className="arc-plate__corner">
          <line x1={x - 9} y1={y} x2={x + 9} y2={y} />
          <line x1={x} y1={y - 9} x2={x} y2={y + 9} />
        </g>
      ))}

      {/* приводочная мишень по центру */}
      <g className="arc-plate__target">
        <circle cx="160" cy="88" r="26" />
        <circle cx="160" cy="88" r="12" />
        <line x1="160" y1="50" x2="160" y2="126" />
        <line x1="122" y1="88" x2="198" y2="88" />
      </g>

      {/* ступенчатый клин плотности — как на контрольной шкале сканера */}
      <g className="arc-plate__wedge">
        {wedge.map((t, i) => (
          <rect
            key={i}
            x={90 + i * 20} y="134" width="20" height="20"
            fill={`rgba(158,190,199,${(0.10 + t * 0.80).toFixed(2)})`}
          />
        ))}
        <rect x="90" y="134" width="140" height="20" />
      </g>
    </svg>
  )
}

/**
 * @param {'mesh'|'frame'} kind  mesh — восстановленная геометрия,
 *                               frame — место под кадр объекта
 * @param {string} [src]         готовая иллюстрация темы вместо рисунка.
 *   Сюда идут ТОЛЬКО заведомо синтетические кадры (ретро-рендер,
 *   печатная плата из справочника) — то, что нельзя перепутать с
 *   замером пользователя. Документальную фотографию в слот, где
 *   через секунду будет настоящий кадр объекта, класть нельзя.
 * @param {string} caption       подпись капсом
 * @param {string} [hint]        вторая строка помельче
 */
export default function ArcPlate({
  kind = 'mesh', src, caption, hint, as = 'div', className = '', ...rest
}) {
  const Tag = as
  // className именно ДОПИСЫВАЕТСЯ, а не приходит через ...rest:
  // в spread он перекрыл бы базовые классы целиком, и таблица
  // осталась бы без собственной вёрстки.
  return (
    <Tag
      className={`arc-plate arc-plate--${kind}${src ? ' arc-plate--img' : ''} ${className}`}
      {...rest}
    >
      {src
        ? <img className="arc-plate__img" src={src} alt="" loading="lazy" />
        : kind === 'mesh' ? <MeshPlate /> : <FramePlate />}
      <span className="arc-plate__cap">{caption}</span>
      {hint && <i className="arc-plate__hint">{hint}</i>}
    </Tag>
  )
}
