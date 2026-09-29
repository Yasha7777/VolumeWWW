import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import { IcoCalendar, IcoImages, IcoClock, IcoUser, IcoPin } from './icons'

/* Карточка обхода. Кликабельна целиком (роль checkbox), выбрать можно только
   готовый обход — остальные показывают статус и не отмечаются. */
export default function ObhodCard({ o, selected, onToggle, index = 0, animate = true }) {
  const ready = o.ready !== false
  const toggle = () => { if (ready) onToggle() }
  return (
    <motion.article
      className={'ks-card' + (selected ? ' is-selected' : '') + (ready ? '' : ' is-disabled')}
      onClick={toggle}
      role="checkbox"
      aria-checked={selected}
      aria-disabled={!ready}
      tabIndex={ready ? 0 : -1}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle() } }}
      initial={animate ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: .3, delay: animate ? .07 + index * .03 : 0, ease: [.22, 1, .36, 1] }}
    >
      <motion.div className="ks-card__photo" layoutId={'thumb-' + o.id}>
        {o.img ? <img src={o.img} alt="" draggable="false" loading="lazy" /> : <span className="ks-card__nophoto">нет превью</span>}
        <span className={'ks-check ks-check--photo' + (selected ? ' is-on' : '')} />
      </motion.div>
      <div className="ks-card__body">
        <span className={'ks-badge ks-badge--' + (o.statusKey || 'ready')}>{o.status}</span>
        <h4 className="ks-card__title" title={o.title}>{o.title}</h4>
        <div className="ks-card__row"><IcoCalendar /><span>{o.date}</span></div>
        <div className="ks-card__row">
          <IcoImages /><span>{o.photos} фото</span>
          {o.duration && <><span className="ks-card__clock"><IcoClock /></span><span>{o.duration}</span></>}
        </div>
        <div className="ks-card__row ks-card__row--gap"><IcoUser /><span>{o.author || '—'}</span></div>
        <div className="ks-card__row"><IcoPin /><span>{o.place || '—'}</span></div>
        <div className="ks-card__device">{o.device}</div>
      </div>
      {selected && <span className="ks-check ks-check--corner is-on"><Check size={12} strokeWidth={3} /></span>}
    </motion.article>
  )
}
