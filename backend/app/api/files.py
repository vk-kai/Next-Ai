"""文件上传学习接口：任意常见格式 -> 自动解析 -> 构建知识库。"""

import os
import re

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.config import settings
from app.core.embedding import EmbeddingError
from app.db import SessionLocal
from app.learning.ingest import build_digest, ingest_text
from app.learning.parser import parse_document

router = APIRouter()


def _safe_name(name: str) -> str:
    return re.sub(r"[^\w.\-\u4e00-\u9fff]+", "_", os.path.basename(name or "file"))[:120]


@router.post("/files/upload")
async def upload_files(
    files: list[UploadFile] = File(...),
    collection: str = Form("default"),
):
    results = []
    digest_texts: list[str] = []
    chunks_total = 0

    with SessionLocal() as db:
        save_dir = os.path.join(settings.data_dir, "files", collection)
        os.makedirs(save_dir, exist_ok=True)
        for f in files:
            data = await f.read()
            safe = _safe_name(f.filename or "file")
            saved_path = os.path.join(save_dir, safe)
            with open(saved_path, "wb") as fh:
                fh.write(data)
            try:
                text = parse_document(f.filename or safe, data)
            except Exception as exc:  # noqa: BLE001 解析失败要反馈到前端
                results.append(
                    {"title": f.filename, "status": "error", "error": str(exc)[:300]}
                )
                continue
            try:
                result = ingest_text(
                    db, collection, f.filename or safe, "file", saved_path, text
                )
            except EmbeddingError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            chunks_total += result.get("chunks", 0)
            if result["status"] in ("new", "updated"):
                digest_texts.append(text)
            results.append(
                {
                    "id": result.get("document_id"),
                    "title": f.filename,
                    "status": result["status"],
                    "chunks": result.get("chunks", 0),
                }
            )
        db.commit()

        digest = False
        if digest_texts:
            import asyncio

            from fastapi.concurrency import run_in_threadpool

            def _build_digest():
                # 在工作线程中运行（内含异步 LLM 调用），避免嵌套事件循环
                return asyncio.run(
                    build_digest(db, collection, f"文件学习({len(digest_texts)}篇)", digest_texts)
                )

            try:
                d = await run_in_threadpool(_build_digest)
                digest = bool(d)
                db.commit()
            except Exception:  # noqa: BLE001 摘要失败不影响原始知识
                db.rollback()

    return {
        "report": {
            "collection": collection,
            "chunks": chunks_total,
            "digest": digest,
            "documents": results,
        }
    }
