from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='backend/.env', extra='ignore')
    supabase_url: str = ''
    supabase_anon_key: str = ''
    supabase_service_role_key: str = ''
    free_trial_uses: int = Field(default=3, ge=1)
    ai_text_input_usd_per_million: float = 0.10
    ai_text_output_usd_per_million: float = 0.50
    ai_image_text_usd_per_million: float = 5.0
    ai_image_output_usd_per_million: float = 30.0
    ai_daily_budget_usd: float = Field(default=10.0, gt=0, allow_inf_nan=False)
    ai_generate_reserve_usd: float = Field(default=0.1, gt=0, allow_inf_nan=False)
    ai_recognize_reserve_usd: float = Field(default=0.02, gt=0, allow_inf_nan=False)
    ai_image_reserve_usd: float = Field(default=0.05, gt=0, allow_inf_nan=False)
    openai_api_key: str = ''
    openai_model: str = 'gpt-6-luna'
    openai_image_model: str = 'gpt-image-2.5-flare'
    image_spool_max_bytes: int = Field(default=67_108_864, ge=5_242_880)
    image_spool_dir: str = '/tmp/fridgechef-image-spool'
    demo_mode: bool = False
    demo_db_path: str = 'backend/demo.sqlite3'
    cors_origins: str = 'http://localhost:8081,http://localhost:19006'


@lru_cache
def settings():
    return Settings()
