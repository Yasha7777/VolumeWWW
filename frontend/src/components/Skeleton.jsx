// Каркас-«призрак» с бегущим бликом (shimmer). Повторяет размеры будущего
// контента → нулевой сдвиг вёрстки (CLS). Под prefers-reduced-motion блик гаснет.
export default function Skeleton({ w = '100%', h = 14, r = 8, className = '', style }) {
  return (
    <span
      className={`kb-sk ${className}`.trim()}
      style={{ width: w, height: h, borderRadius: r, ...style }}
      aria-hidden="true"
    />
  )
}

// Готовый скелетон карточки замера — визуально совпадает с MeasureCard.
export function MeasureCardSkeleton() {
  return (
    <div className="kh-card-sk">
      <div className="kh-card-sk__main">
        <Skeleton w={44} h={44} r={12} />
        <div className="kh-card-sk__lines">
          <Skeleton w="52%" h={15} />
          <Skeleton w="34%" h={12} />
        </div>
        <Skeleton w={84} h={26} r={999} />
      </div>
      <div className="kh-card-sk__thumbs">
        <Skeleton w={56} h={56} r={10} />
        <Skeleton w={56} h={56} r={10} />
        <Skeleton w={56} h={56} r={10} />
      </div>
    </div>
  )
}
