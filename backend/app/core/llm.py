"""LLM 客户端（OpenAI 兼容接口）。配置来自 appsettings（DB 优先，.env 兜底）。"""

import json
from collections.abc import AsyncIterator

import httpx

from app.core.appsettings import get_model_config


class LLMError(RuntimeError):
    pass


def _resolve() -> tuple[str, dict, str]:
    cfg = get_model_config()
    base, key, model = cfg["llm_base_url"], cfg["llm_api_key"], cfg["llm_model"]
    if not (base and key and model):
        raise LLMError(
            "LLM 服务未配置：请在「设置」页填写 LLM 服务地址、API Key 和模型名"
        )
    return base.rstrip("/"), {"Authorization": f"Bearer {key}"}, model


def llm_configured() -> bool:
    cfg = get_model_config()
    return bool(cfg["llm_base_url"] and cfg["llm_api_key"] and cfg["llm_model"])


async def chat_stream(messages: list[dict]) -> AsyncIterator[str]:
    """流式对话，逐段 yield 文本增量。"""
    base, headers, model = _resolve()
    payload = {"model": model, "messages": messages, "stream": True}
    timeout = httpx.Timeout(180, connect=10)
    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        async with client.stream(
            "POST", f"{base}/chat/completions", headers=headers, json=payload
        ) as resp:
            if resp.status_code != 200:
                body = (await resp.aread()).decode("utf-8", "ignore")
                raise LLMError(f"LLM 调用失败 HTTP {resp.status_code}: {body[:300]}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or [{}]
                content = (choices[0].get("delta") or {}).get("content")
                if content:
                    yield content


async def chat_once(messages: list[dict], max_tokens: int | None = None) -> str:
    """非流式调用，用于知识摘要、连通性测试等。"""
    base, headers, model = _resolve()
    payload = {"model": model, "messages": messages}
    if max_tokens:
        payload["max_tokens"] = max_tokens
    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=10), trust_env=False) as client:
        resp = await client.post(f"{base}/chat/completions", headers=headers, json=payload)
        if resp.status_code != 200:
            raise LLMError(f"LLM 调用失败 HTTP {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
        return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
