"""对话接口：知识库检索 + LLM 流式回答（SSE）。"""

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core import llm as llm_client
from app.core.appsettings import get_agent_config
from app.core.embedding import EmbeddingError
from app.core.llm import LLMError
from app.db import SessionLocal
from app.learning.ingest import retrieve
from app.models import Collection

router = APIRouter()

SYSTEM_TEMPLATE = (
    "你是 {agent_name} 智能体，当前挂载在项目「{name}」上。\n"
    "项目介绍：{description}\n"
    "{persona}\n"
    "回答要求：\n"
    "1. 优先依据下方知识库检索结果回答用户问题，并保持准确、简洁；\n"
    "2. 知识库没有相关内容且你不确定时，如实说明，不要编造；\n"
    "3. 使用与用户相同的语言回答。\n\n"
    "=== 知识库检索结果 ===\n{context}"
)

NO_CONTEXT = "（知识库中暂无相关内容，请基于你的通用能力谨慎回答）"


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    collection: str = "default"
    messages: list[ChatMessage]


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@router.post("/chat")
async def chat(req: ChatRequest):
    async def gen():
        try:
            if not llm_client.llm_configured():
                raise LLMError(
                    "LLM 服务未配置：请在 backend/.env 中设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 后重启服务"
                )
            user_query = next(
                (m.content for m in reversed(req.messages) if m.role == "user"), ""
            )
            with SessionLocal() as db:
                collection = db.get(Collection, req.collection)
                hits = retrieve(db, req.collection, user_query, k=5)
                name = collection.name if collection else req.collection
                description = (
                    collection.description if collection else "（未设置项目介绍）"
                )

            yield _sse(
                {
                    "type": "sources",
                    "sources": [
                        {"title": h["title"], "score": h["score"]} for h in hits
                    ],
                }
            )

            context = (
                "\n\n".join(f"[来源: {h['title']}]\n{h['text']}" for h in hits)
                if hits
                else NO_CONTEXT
            )
            agent = get_agent_config()
            messages = (
                [
                    {
                        "role": "system",
                        "content": SYSTEM_TEMPLATE.format(
                            agent_name=agent["name"],
                            name=name,
                            description=description,
                            persona=f"角色设定：{agent['persona']}" if agent["persona"] else "",
                            context=context,
                        ),
                    }
                ]
                + [m.model_dump() for m in req.messages]
            )
            async for delta in llm_client.chat_stream(messages):
                yield _sse({"type": "delta", "content": delta})
            yield _sse({"type": "done"})
        except (LLMError, EmbeddingError) as exc:
            yield _sse({"type": "error", "message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            yield _sse({"type": "error", "message": f"处理失败: {exc}"})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
