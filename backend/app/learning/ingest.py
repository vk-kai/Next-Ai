"""学习管线核心：文本 -> 分块 -> 向量化 -> 入库（按内容哈希去重、按 source_ref 增量替换）。

另外提供：
- retrieve(): 从知识库检索最相关知识块
- build_digest(): 用 LLM 把原始资料蒸馏成结构化知识摘要，一并入库
"""

import hashlib

import numpy as np
from sqlalchemy.orm import Session

from app.core import chunker, embedding
from app.core import llm as llm_client
from app.models import Chunk, Document

DIGEST_SOURCE_PREFIX = "digest:"


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def ingest_text(
    db: Session,
    collection: str,
    title: str,
    source_type: str,
    source_ref: str,
    text: str,
    doc_type: str = "raw",
) -> dict:
    """入库单篇文本。返回 {status: new|updated|skipped, document_id, chunks}。"""
    text = (text or "").strip()
    if not text:
        return {"status": "skipped", "reason": "empty", "chunks": 0}

    content_hash = _hash_text(text)
    same = (
        db.query(Document)
        .filter(Document.collection == collection, Document.content_hash == content_hash)
        .first()
    )
    if same:
        return {"status": "skipped", "document_id": same.id, "chunks": same.chunk_count}

    # 同一来源出现新版本内容时，替换旧文档
    old_docs = (
        db.query(Document)
        .filter(
            Document.collection == collection,
            Document.source_type == source_type,
            Document.source_ref == source_ref,
            Document.doc_type == doc_type,
            Document.id != (same.id if same else ""),
        )
        .all()
    )
    had_old = bool(old_docs)
    for old in old_docs:
        db.query(Chunk).filter(Chunk.document_id == old.id).delete()
        db.delete(old)

    chunks = chunker.chunk_text(text)
    vectors = embedding.embed_texts(chunks) if chunks else []

    doc = Document(
        collection=collection,
        title=(title or "未命名")[:500],
        source_type=source_type,
        source_ref=(source_ref or "")[:1000],
        doc_type=doc_type,
        content_hash=content_hash,
        chunk_count=len(chunks),
    )
    db.add(doc)
    db.flush()
    for i, (chunk, vec) in enumerate(zip(chunks, vectors)):
        db.add(
            Chunk(
                document_id=doc.id,
                collection=collection,
                ordinal=i,
                text=chunk,
                vector=np.asarray(vec, dtype=np.float32).tobytes(),
                vector_dim=len(vec),
            )
        )
    db.flush()
    return {
        "status": "updated" if had_old else "new",
        "document_id": doc.id,
        "chunks": len(chunks),
    }


def delete_document(db: Session, document_id: str) -> bool:
    doc = db.get(Document, document_id)
    if not doc:
        return False
    db.query(Chunk).filter(Chunk.document_id == doc.id).delete()
    db.delete(doc)
    return True


def retrieve(db: Session, collection: str, query: str, k: int = 5) -> list[dict]:
    """检索最相关的 k 个知识块，返回 [{title, text, score}]。"""
    if not query.strip():
        return []
    rows = db.query(Chunk).filter(Chunk.collection == collection).all()
    if not rows:
        return []
    qvec = np.asarray(embedding.embed_texts([query])[0], dtype=np.float32)
    mat = np.stack([np.frombuffer(r.vector, dtype=np.float32) for r in rows])
    if mat.shape[1] != qvec.shape[0]:
        raise embedding.EmbeddingError(
            "向量维度与库中不一致：可能更换过 Embedding 模型，请重建知识库后重试"
        )
    norms = np.linalg.norm(mat, axis=1) * np.linalg.norm(qvec) + 1e-8
    sims = mat @ qvec / norms
    top = np.argsort(-sims)[:k]

    doc_ids = {r.document_id for r in rows}
    titles = {
        d.id: d.title
        for d in db.query(Document).filter(Document.id.in_(doc_ids)).all()
    }
    return [
        {
            "title": titles.get(rows[i].document_id, "未知文档"),
            "text": rows[i].text,
            "score": round(float(sims[i]), 4),
        }
        for i in top
        if sims[i] > 0.1
    ]


async def build_digest(
    db: Session, collection: str, title: str, texts: list[str]
) -> dict | None:
    """知识蒸馏：把一批原始资料交给 LLM 提炼成结构化摘要，入库供检索。

    未配置 LLM 时返回 None（跳过摘要，不影响原始知识入库）。
    """
    if not texts or not llm_client.llm_configured():
        return None

    # map：分批总结
    batches: list[str] = []
    buf = ""
    for text in texts:
        piece = text[:4000]
        if len(buf) + len(piece) + 2 > 12000 and buf:
            batches.append(buf)
            buf = ""
        buf = f"{buf}\n\n{piece}"
    if buf.strip():
        batches.append(buf)

    summaries: list[str] = []
    for batch in batches[:10]:
        summary = await llm_client.chat_once(
            [
                {
                    "role": "system",
                    "content": "你是知识整理助手，负责把原始资料提炼成要点式知识点，供后续问答检索使用。",
                },
                {
                    "role": "user",
                    "content": f"请总结以下资料中的关键知识点（分条列出，保留事实、数字、结论）：\n\n{batch}",
                },
            ],
            max_tokens=1500,
        )
        if summary.strip():
            summaries.append(summary.strip())

    if not summaries:
        return None

    # reduce：合并为最终摘要
    if len(summaries) == 1:
        digest = summaries[0]
    else:
        digest = await llm_client.chat_once(
            [
                {"role": "system", "content": "你是知识整理助手。"},
                {
                    "role": "user",
                    "content": "请把以下几份要点合并整理成一份结构化知识摘要（按主题分节，去除重复）：\n\n"
                    + "\n\n".join(summaries),
                },
            ],
            max_tokens=2000,
        )
    digest = digest.strip() or "\n\n".join(summaries)

    source_ref = f"{DIGEST_SOURCE_PREFIX}{title}"
    result = ingest_text(
        db, collection, f"【知识摘要】{title}", "digest", source_ref, digest, doc_type="digest"
    )
    return result
