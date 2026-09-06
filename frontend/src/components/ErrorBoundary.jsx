import { Component } from 'react'

/* ============================================================
   ErrorBoundary — универсальная страховка от белого экрана.
   ------------------------------------------------------------
   ЗАЧЕМ. <Suspense> ловит ТОЛЬКО ожидание (ленивый чанк, ресурс),
   но НЕ исключения рендера. Любая ошибка без boundary поднимается
   до корня, React размонтирует всё дерево — и страница становится
   белой. Два реальных сценария, оба наблюдались:

   1) Лежит Supabase. `useLoader(PLYLoader, …)` в сцене «Движка»
      получает 502 со storage и бросает В РЕНДЕРЕ. Публичный лендинг
      целиком гас из-за декоративного облака точек.
   2) Деплой во время открытой вкладки. index.html закеширован
      браузером, ссылается на чанк, которого в новой сборке уже нет
      → динамический import падает 404 → тот же белый экран
      (см. политику кэша в nginx.conf).

   Второй случай лечится только перезагрузкой, поэтому корневой
   fallback её и предлагает.

   ИСПОЛЬЗОВАНИЕ:
     <ErrorBoundary fallback={null}>…</ErrorBoundary>   — тихо погасить блок
     <ErrorBoundary>…</ErrorBoundary>                   — экран с перезагрузкой
   ============================================================ */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    // Наружу ничего не пробрасываем: колбэки в родителя из boundary уже
    // однажды давали вечный спиннер (см. ViewerErrorBoundary). Только лог.
    console.warn(`[ErrorBoundary${this.props.name ? ' · ' + this.props.name : ''}]`, error, info?.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    // fallback может быть законным null — поэтому проверяем именно undefined.
    if (this.props.fallback !== undefined) return this.props.fallback

    return (
      <div className="kb-crash" role="alert">
        <h1 className="kb-crash__title">Что-то пошло не так</h1>
        <p className="kb-crash__text">
          Страница не смогла отрисоваться. Обычно помогает перезагрузка —
          особенно если сайт только что обновился.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          Перезагрузить
        </button>
      </div>
    )
  }
}
