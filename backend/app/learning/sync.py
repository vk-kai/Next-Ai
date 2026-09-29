"""数据源同步执行器：抓取 -> 入库 -> 生成学习报告（+ 知识摘要）。"""

from datetime import datetime

from sqlalchemy.orm import Session

from app.learning.connectors import get_connector
from app.learning.ingest import build_digest, ingest_text
from app.models import KnowledgeSource, SyncReport


def run_source_sync(db: Session, source: KnowledgeSource, trigger: str = "manual") -> SyncReport:
    report = SyncReport(
        source_id=source.id,
        collection=source.collection,
        trigger=trigger,
        started_at=datetime.now(),
        status="running",
    )
    db.add(report)
    db.commit()

    stats = {
        "fetched": 0,
        "new": 0,
        "updated": 0,
        "skipped": 0,
        "chunks": 0,
        "digest": False,
    }
    changed_texts: list[str] = []
    try:
        connector = get_connector(source.type)
        for record in connector.fetch(source.config or {}):
            stats["fetched"] += 1
            result = ingest_text(
                db,
                source.collection,
                record.title or record.id,
                source.type,
                f"{source.type}:{record.id}",
                record.text,
            )
            if result["status"] == "new":
                stats["new"] += 1
                stats["chunks"] += result.get("chunks", 0)
                changed_texts.append(record.text)
            elif result["status"] == "updated":
                stats["updated"] += 1
                stats["chunks"] += result.get("chunks", 0)
                changed_texts.append(record.text)
            else:
                stats["skipped"] += 1

        # 有新知识时做知识蒸馏（未配置 LLM 时自动跳过）。
        # 本函数运行在工作线程（调度器/线程池）中，无运行中的事件循环，可直接 asyncio.run
        if changed_texts:
            import asyncio

            digest = asyncio.run(
                build_digest(db, source.collection, source.name, changed_texts)
            )
            stats["digest"] = bool(digest)

        report.status = "success"
    except Exception as exc:  # noqa: BLE001 单条同步失败要记录进报告，而不是炸掉服务
        report.status = "error"
        report.error = str(exc)[:2000]

    report.stats = stats
    report.finished_at = datetime.now()
    source.last_sync_at = report.finished_at
    db.commit()
    db.refresh(report)
    return report
