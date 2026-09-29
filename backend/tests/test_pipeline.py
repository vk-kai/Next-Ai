"""学习管线离线自测：mock Embedding，验证 解析->入库->去重/增量替换->检索 与 REST 连接器。

运行：cd backend && python -m pytest tests/ -q
"""

import os
import tempfile

# 必须在导入 app 模块前设置环境（config 在导入时读取）
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="nextai-test-")
os.environ["LLM_BASE_URL"] = ""
os.environ["EMBEDDING_BASE_URL"] = ""

import hashlib  # noqa: E402

import numpy as np  # noqa: E402

import app.db as app_db  # noqa: E402
from app.learning import ingest as ingest_mod  # noqa: E402
from app.learning.connectors.rest_api import RESTConnector  # noqa: E402

DIM = 64


def fake_embed(texts):
    out = []
    for t in texts:
        h = hashlib.md5(t.encode("utf-8")).digest()
        vec = np.frombuffer(h, dtype=np.uint8).astype(np.float32)[:DIM]
        out.append((vec / (np.linalg.norm(vec) + 1e-8)).tolist())
    return out


ingest_mod.embedding.embed_texts = fake_embed


def setup_module(_=None):
    app_db.init_db()


def test_chunker():
    from app.core.chunker import chunk_text

    text = "第一段。\n\n" + "这是一段很长的话。" * 200
    chunks = chunk_text(text)
    assert len(chunks) >= 2
    assert all(len(c) <= 900 for c in chunks)


def test_parse_markdown_like_text():
    from app.learning.parser import parse_document

    text = parse_document("notes.txt", "新闻网站聚合科技资讯\n板块: AI/互联网".encode())
    assert "新闻网站" in text


def test_ingest_dedupe_and_update():
    text = "Next-AI 是一个可挂载的智能体。它可以接入新闻网站等项目，自动抓取数据构建知识库。"
    with app_db.SessionLocal() as db:
        r1 = ingest_mod.ingest_text(db, "default", "t1", "file", "a.txt", text)
        assert r1["status"] == "new"
        r2 = ingest_mod.ingest_text(db, "default", "t1", "file", "a.txt", text)
        assert r2["status"] == "skipped"  # 内容没变 -> 跳过
        r3 = ingest_mod.ingest_text(
            db, "default", "t1", "file", "a.txt", text + " 新增了对话功能。"
        )
        assert r3["status"] == "updated"  # 同一来源内容变化 -> 替换旧版本
        db.commit()

        from app.models import Document

        docs = db.query(Document).filter(Document.source_ref == "a.txt").all()
        assert len(docs) == 1


def test_retrieve():
    with app_db.SessionLocal() as db:
        ingest_mod.ingest_text(
            db,
            "default",
            "新闻说明",
            "file",
            "news.md",
            "新闻网站每天聚合科技新闻，提供检索和订阅功能。天气预报不属于新闻网站范畴。",
        )
        db.commit()
        hits = ingest_mod.retrieve(db, "default", "新闻网站有什么功能", k=3)
        assert hits and "新闻" in hits[0]["text"]


def test_rest_connector_and_sync_flow():
    import httpx

    payload = {
        "data": {
            "items": [
                {"id": 1, "title": "AI 大会召开", "content": "首届 AI 大会在京召开。"},
                {"id": 2, "title": "新产品发布", "content": "公司发布新一代搜索产品。"},
            ]
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params["page"] == "1":
            return httpx.Response(200, json=payload)
        return httpx.Response(200, json={"data": {"items": []}})  # 第 2 页无数据

    connector = RESTConnector(transport=httpx.MockTransport(handler))
    config = {
        "url": "http://testserver/api/articles",
        "items_path": "data.items",
        "id_field": "id",
        "content_fields": ["title", "content"],
        "pagination": {"page_param": "page", "size_param": "page_size", "page_size": 2},
    }
    records = list(connector.fetch(config))
    assert len(records) == 2
    assert records[0].id == "1" and "AI 大会" in records[0].text

    # 走完整入库流程：第二次同步相同内容应全部 skipped
    with app_db.SessionLocal() as db:
        for record in records:
            ingest_mod.ingest_text(
                db, "default", record.title, "rest_api", f"rest_api:{record.id}", record.text
            )
        db.commit()
        for record in records:
            r = ingest_mod.ingest_text(
                db, "default", record.title, "rest_api", f"rest_api:{record.id}", record.text
            )
            assert r["status"] == "skipped"
