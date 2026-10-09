from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='backend/.env', extra='ignore')
    supabase_url: str = ''
    supabase_anon_key: str = ''
    openai_api_key: str = ''
    openai_model: str = 'gpt-6-luna'
    openai_image_model: str = 'gpt-image-1-mini'
    demo_mode: bool = False
    demo_db_path: str = 'backend/demo.sqlite3'
    cors_origins: str = 'http://localhost:8081,http://localhost:19006'


@lru_cache
def settings():
    return Settings()
