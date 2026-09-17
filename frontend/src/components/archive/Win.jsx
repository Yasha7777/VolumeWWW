import { useId, useState } from 'react'

/* ============================================================
   Win — «окно программы» темы «Архив».
   ------------------------------------------------------------
   Каждая панель оформлена как окно старой оболочки: шахматная
   иконка, имя с расширением .ПРГ, справа — метаданные и кнопки
   `— □ ×`. Скошенные борта и градиент заголовка заданы в CSS.

   Кнопки в углу — часть РИСУНКА окна (aria-hidden), а живая
   кнопка одна: сам заголовок. Клик по нему сворачивает и
   разворачивает тело — это единственное действие, которое в
   вебе имеет смысл и не теряет данные (закрывать окно с уже
   выбранными снимками нельзя). Высота заголовка ≥40px, как
   требует раздел «Доступность».
   ============================================================ */

export default function Win({
  name,                 // 'ВВОД_СНИМКОВ.ПРГ'
  meta = null,          // строка справа в заголовке: '0 / 100 · 0.0 МБ'
  dark = false,         // тёмное окно (журнал)
  defaultOpen = true,
  collapsible = true,
  className = '',
  bodyClassName = '',
  children,
}) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()

  const Title = collapsible ? 'button' : 'div'
  const titleProps = collapsible
    ? {
        type: 'button',
        onClick: () => setOpen((v) => !v),
        'aria-expanded': open,
        'aria-controls': bodyId,
        'aria-label': `${open ? 'Свернуть' : 'Развернуть'} окно ${name}`,
      }
    : {}

  return (
    <section
      className={`arc-win${dark ? ' arc-win--dark' : ''}${open ? '' : ' is-folded'} ${className}`}
    >
      <Title className="arc-win__hd" {...titleProps}>
        <span className="arc-win__ico" aria-hidden="true" />
        <span className="arc-win__name">{name}</span>
        {meta && <span className="arc-win__meta">{meta}</span>}
        <span className="arc-win__btns" aria-hidden="true">
          <i>—</i><i>□</i><i>×</i>
        </span>
      </Title>

      <div className={`arc-win__body ${bodyClassName}`} id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  )
}
