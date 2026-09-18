/* ============================================================
   bus.js — крошечная шина событий темы «Архив».
   ------------------------------------------------------------
   Нужна ровно для одного требования ТЗ: кнопки панели задач
   обязаны РАБОТАТЬ. Панель задач живёт в Layout (ArchiveChrome),
   а «программы», которые она открывает, — внутри страниц
   (ArchiveAnalyze). Тянуть ради этого общий стейт-менеджер
   нельзя («никаких изменений в стейт-менеджменте»), поэтому
   здесь 30 строк подписки.

   Отдельная тонкость — переход между разделами. Нажатие
   «ВВОД_СНИМКОВ.ПРГ» из архива должно сперва увести на /app и
   только потом открыть выбор файлов, а подписчика в этот момент
   ещё нет. Поэтому событие, которое никто не принял, кладётся в
   `pending` и доигрывается, как только подписчик появится.
   ============================================================ */

const subs = new Map();       // тип → Set<fn>
const pending = new Map();    // тип → payload (событие «в долг»)

export function onArchive(type, fn) {
  let set = subs.get(type);
  if (!set) { set = new Set(); subs.set(type, set); }
  set.add(fn);

  // подписались после того, как событие уже случилось — доигрываем
  if (pending.has(type)) {
    const payload = pending.get(type);
    pending.delete(type);
    // микротаск: подписка обычно идёт из useEffect, дать React домонтировать
    queueMicrotask(() => fn(payload));
  }

  return () => {
    set.delete(fn);
    if (!set.size) subs.delete(type);
  };
}

export function emitArchive(type, payload) {
  const set = subs.get(type);
  if (set && set.size) {
    set.forEach((fn) => { try { fn(payload); } catch (_) {} });
    return true;
  }
  // принять некому — запоминаем до появления подписчика
  pending.set(type, payload);
  return false;
}

/* Названия событий держим здесь, чтобы опечатка в строке
   не превращалась в молча неработающую кнопку. */
export const EV = {
  FILES: 'files',   // подвести страницу к зоне ввода снимков
  CUBE:  'cube',    // развернуть СВОЙСТВА_КУБА и подвести к ним
};

/* Общая доводка до элемента: прокрутить так, чтобы окно оказалось
   в поле зрения, и мигнуть рамкой — иначе кнопка панели задач на
   длинной странице «ничего не делает». Учитывает липкую шапку
   темы (её высота лежит в --sys-h/--nav-h) и prefers-reduced-motion. */
export function revealEl(el) {
  if (!el) return;
  const css = getComputedStyle(document.documentElement);
  const px = (name, fallback) => parseInt(css.getPropertyValue(name), 10) || fallback;
  const offset = px('--sys-h', 44) + px('--nav-h', 34) + 16;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });

  el.classList.remove('arc-flash');
  // перезапуск анимации: без чтения offsetWidth браузер склеит снятие
  // и возврат класса в один кадр, и вспышки не будет
  void el.offsetWidth;
  el.classList.add('arc-flash');
  setTimeout(() => el.classList.remove('arc-flash'), 1200);
}
