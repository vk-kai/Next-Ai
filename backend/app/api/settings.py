"""智能体配置接口：人设、模型服务（LLM/Embedding），前端可视化配置。"""

import asyncio

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.core import llm as llm_client
from app.core.appsettings import (
    AGENT_KEY,
    MODEL_CONFIG_KEY,
    _load_setting,
    get_agent_config,
    get_model_config,
    has_custom_config,
    save_setting,
)
from app.core.embedding import embed_texts

router = APIRouter()


class ModelService(BaseModel):
    base_url: str = ""
    api_key: str = ""  # 空字符串 = 保持不变
    model: str = ""


class AgentConfig(BaseModel):
    name: str = ""
    persona: str = ""


class SettingsBody(BaseModel):
    agent: AgentConfig = AgentConfig()
    llm: ModelService = ModelService()
    embedding: ModelService = ModelService()


def _service_payload(cfg: dict, prefix: str) -> dict:
    return {
        "base_url": cfg[f"{prefix}_base_url"],
        "model": cfg[f"{prefix}_model"],
        "has_api_key": bool(cfg[f"{prefix}_api_key"]),
    }


@router.get("/settings")
def get_settings():
    return {
        "agent": get_agent_config(),
        "llm": _service_payload(get_model_config(), "llm"),
        "embedding": _service_payload(get_model_config(), "embedding"),
        "customized": has_custom_config(),
    }


@router.put("/settings")
def update_settings(body: SettingsBody):
    merged = dict(_load_setting(MODEL_CONFIG_KEY))
    merged.update(
        {
            "llm_base_url": body.llm.base_url.strip(),
            "llm_model": body.llm.model.strip(),
            "embedding_base_url": body.embedding.base_url.strip(),
            "embedding_model": body.embedding.model.strip(),
        }
    )
    # api_key 仅在非空时更新（空 = 保持不变）
    if body.llm.api_key:
        merged["llm_api_key"] = body.llm.api_key
    if body.embedding.api_key:
        merged["embedding_api_key"] = body.embedding.api_key
    save_setting(MODEL_CONFIG_KEY, merged)
    save_setting(
        AGENT_KEY,
        {"name": body.agent.name.strip(), "persona": body.agent.persona.strip()},
    )
    return get_settings()


@router.post("/settings/test")
async def test_settings():
    async def test_llm():
        try:
            reply = await llm_client.chat_once(
                [{"role": "user", "content": "请只回复两个字：正常"}], max_tokens=10
            )
            return {"ok": True, "message": f"连接正常，模型返回: {reply.strip()[:50]}"}
        except Exception as exc:  # noqa: BLE001 测试要返回失败原因而不是 500
            return {"ok": False, "message": str(exc)[:300]}

    async def test_embedding():
        try:
            vecs = await run_in_threadpool(lambda: embed_texts(["连通性测试"]))
            return {"ok": True, "message": f"连接正常，向量维度: {len(vecs[0])}"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "message": str(exc)[:300]}

    llm_result, embedding_result = await asyncio.gather(test_llm(), test_embedding())
    return {"llm": llm_result, "embedding": embedding_result}
