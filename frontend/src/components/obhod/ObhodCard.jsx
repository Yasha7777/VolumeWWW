import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import { IcoCalendar, IcoImages, IcoClock, IcoUser, IcoPin } from './icons'

/* Карточка обхода. Кликабельна целиком (роль radio — выбирается один обход),
   выбрать можно только готовый обход — остальные показывают статус и не
   отмечаются. Пока идёт анализ, выбор заблокирован (disabled). */
export default function ObhodCard({ o, selected, onToggle, index = 0, animate = true, shared = true, disabled = false }) {
  const ready = o.ready !== false
  const toggle = () => { if (ready && !disabled) onToggle() }
  return (
    <motion.article
      className={'ks-card' + (selected ? ' is-selected' : '') + (ready ? '' : ' is-disabled') + (disabled && !selected ? ' is-locked' : '')}
      onClick={toggle}
      role="radio"
      aria-checked={selected}
      aria-disabled={!ready || disabled}
      tabIndex={ready && !disabled ? 0 : -1}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle() } }}
      initial={animate ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: .42, delay: animate ? .16 + index * .04 : 0, ease: [.5, 0, .2, 1] }}
    >
      <motion.div className="ks-card__photo" layoutId={shared ? 'thumb-' + o.id : undefined}>
        {o.img ? <img src={o.img} alt="" draggable="false" loading="lazy" /> : <span className="ks-card__nophoto">нет превью</span>}
        <span className={'ks-check ks-check--photo' + (selected ? ' is-on' : '')} />
      </motion.div>
      <div className="ks-card__body">
        <span className={'ks-badge ks-badge--' + (o.statusKey || 'ready')}>{o.status}</span>
        <h4 className="ks-card__title" title={o.title}>{o.title}</h4>
        <div className="ks-card__row"><IcoCalendar /><span>{o.date}</span></div>
        <div className="ks-card__row">
          <IcoImages /><span>{o.photos} фото</span>
          {/* длительность СЪЁМКИ обхода (сколько шла запись в приложении), не загрузки */}
          {o.duration && <><span className="ks-card__clock"><IcoClock /></span><span title="Длительность съёмки обхода">съёмка {o.duration}</span></>}
        </div>
        {o.author && <div className="ks-card__row ks-card__row--gap"><IcoUser /><span>{o.author}</span></div>}
        <div className={'ks-card__row' + (o.author ? '' : ' ks-card__row--gap')}><IcoPin /><span>{o.place || 'нет координат'}</span></div>
        {o.device && <div className="ks-card__device">{o.device}</div>}
      </div>
      {selected && <span className="ks-check ks-check--corner is-on"><Check size={12} strokeWidth={3} /></span>}
    </motion.article>
  )
}
