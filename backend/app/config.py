from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_key: str   # service_role — только backend
    supabase_jwt_secret: str    # из Settings → API → JWT Secret
    
    # РАСЧЁТНЫЙ СЕРВЕР (GPU). С 06.10.2026 бэкенд ходит на приёмник напрямую,
    # без n8n (см. gpu.py). Рабочие значения лежат в БД (таблица app_settings)
    # и правятся суперадмином в «Профиле»; переменные ниже — запасной вариант
    # на случай, когда в БД ничего нет (первый запуск, миграция не применена).
    gpu_server_url: str = ""    # GPU_SERVER_URL, напр. http://1.2.3.4:6007/run
    gpu_mode: str = "cube"      # GPU_MODE: cube | vio
    gpu_token: str = ""         # GPU_TOKEN — общий секрет с приёмником (RECEIVER_TOKEN)
    gpu_timeout: int = 3600     # GPU_TIMEOUT, с: приёмник отвечает, когда посчитал

    # n8n БОЛЬШЕ НЕ ИСПОЛЬЗУЕТСЯ. Поля оставлены необязательными только затем,
    # чтобы старый .env со строками N8N_* не мешал; читать их в коде нельзя.
    n8n_webhook_url: Optional[str] = None
    n8n_webhook_url_prod: Optional[str] = None
    n8n_timeout: int = 3600
    storage_bucket: str = "analysis-photos"

    # Вход через VK ID (routers/vk_auth.py). ID приложения публичный — он и так
    # виден в адресе страницы входа ВК, поэтому лежит здесь значением по
    # умолчанию. Приложение ВК «публичное»: обмен кода защищён PKCE, секрет
    # не нужен. Пустой VK_CLIENT_ID в .env выключает вход через ВК.
    vk_client_id: str = "54801219"
    vk_redirect_uri: str = "https://volumetric.gottland.ru/api/auth/vk/callback"
    vk_id_host: str = "https://id.vk.ru"
    # Куда возвращать браузер после входа (страница /login сайта).
    site_url: str = "https://volumetric.gottland.ru"

    class Config:
        env_file = ".env"
        case_sensitive = False
        # лишние строки в .env (устаревшие переменные) не должны ронять старт
        extra = "ignore"


settings = Settings()