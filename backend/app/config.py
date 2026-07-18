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

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()