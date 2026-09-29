from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # LLM（OpenAI 兼容接口，用于对话与知识摘要）
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = ""

    # Embedding（OpenAI 兼容接口，用于知识库向量化）
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = ""
    embedding_batch_size: int = 32

    # 应用
    data_dir: str = "./data"
    cors_origins: str = "*"


settings = Settings()
