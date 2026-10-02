from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_key: str   # service_role — только backend
    supabase_jwt_secret: str    # из Settings → API → JWT Secret
    
    # Ссылки для n8n
    n8n_webhook_url: str        # Автоматически подтянет N8N_WEBHOOK_URL (Test)
    n8n_webhook_url_prod: str   # Автоматически подтянет N8N_WEBHOOK_URL_Prod (Prod)
    
    n8n_timeout: int = 3600     # 1 час
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


settings = Settings()