"""有效配置：前端在 AppSetting 表里保存的配置优先，.env 作为默认值。

键：
- model_config: {llm_base_url, llm_api_key, llm_model, embedding_base_url, embedding_api_key, embedding_model}
- agent: {name, persona}
"""

from app.db import SessionLocal
from app.models import AppSetting

MODEL_CONFIG_KEY = "model_config"
AGENT_KEY = "agent"


def _env_defaults() -> dict:
    from app.config import settings

    return {
        "llm_base_url": settings.llm_base_url,
        "llm_api_key": settings.llm_api_key,
        "llm_model": settings.llm_model,
        "embedding_base_url": settings.embedding_base_url,
        "embedding_api_key": settings.embedding_api_key,
        "embedding_model": settings.embedding_model,
    }


def _load_setting(key: str) -> dict:
    with SessionLocal() as db:
        row = db.get(AppSetting, key)
        return (row.value or {}) if row else {}


def get_model_config() -> dict:
    """合并后的模型服务配置（env 兜底，DB 非空值覆盖）。"""
    merged = _env_defaults()
    for key, value in _load_setting(MODEL_CONFIG_KEY).items():
        if value:  # 空字符串/None 不覆盖
            merged[key] = value
    return merged


def get_agent_config() -> dict:
    """智能体配置：名称与人设。"""
    cfg = _load_setting(AGENT_KEY)
    return {"name": cfg.get("name") or "Next-AI", "persona": cfg.get("persona") or ""}


def save_setting(key: str, value: dict) -> None:
    with SessionLocal() as db:
        row = db.get(AppSetting, key)
        if row:
            row.value = value
        else:
            row = AppSetting(key=key, value=value)
            db.add(row)
        db.commit()


def has_custom_config() -> bool:
    with SessionLocal() as db:
        return db.get(AppSetting, MODEL_CONFIG_KEY) is not None
