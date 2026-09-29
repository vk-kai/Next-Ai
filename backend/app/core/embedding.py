"""Embedding 客户端（OpenAI 兼容接口 /embeddings）。配置来自 appsettings。"""

import httpx

from app.core.appsettings import get_model_config


class EmbeddingError(RuntimeError):
    pass


def _check_config() -> tuple[str, dict, str]:
    cfg = get_model_config()
    base, key, model = (
        cfg["embedding_base_url"],
        cfg["embedding_api_key"],
        cfg["embedding_model"],
    )
    if not (base and key and model):
        raise EmbeddingError(
            "Embedding 服务未配置：请在「设置」页填写 Embedding 服务地址、API Key 和模型名"
        )
    return base.rstrip("/"), {"Authorization": f"Bearer {key}"}, model


def embedding_configured() -> bool:
    cfg = get_model_config()
    return bool(
        cfg["embedding_base_url"] and cfg["embedding_api_key"] and cfg["embedding_model"]
    )


def embed_texts(texts: list[str]) -> list[list[float]]:
    """批量向量化。空文本会替换为空格以兼容部分接口。"""
    if not texts:
        return []
    base, headers, model = _check_config()
    from app.config import settings

    out: list[list[float]] = []
    batch = max(1, settings.embedding_batch_size)
    with httpx.Client(timeout=60, trust_env=False) as client:
        for i in range(0, len(texts), batch):
            part = [t if t and t.strip() else " " for t in texts[i : i + batch]]
            resp = client.post(
                f"{base}/embeddings",
                headers=headers,
                json={"model": model, "input": part},
            )
            if resp.status_code != 200:
                raise EmbeddingError(
                    f"Embedding 调用失败 HTTP {resp.status_code}: {resp.text[:300]}"
                )
            data = resp.json().get("data") or []
            if len(data) != len(part):
                raise EmbeddingError(
                    f"Embedding 返回数量不一致：期望 {len(part)}，实际 {len(data)}"
                )
            out.extend(item["embedding"] for item in data)
    return out
