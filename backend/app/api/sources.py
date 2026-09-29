"""数据源管理接口：把已部署项目"挂载"给智能体自动学习。"""

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.db import SessionLocal
from app.learning.connectors.database import DatabaseConnector  # noqa: F401 注册连接器
from app.learning.connectors.rest_api import RESTConnector  # noqa: F401 注册连接器
from app.learning.scheduler import add_source_job, remove_source_job
from app.learning.sync import run_source_sync
from app.models import KnowledgeSource, SyncReport

router = APIRouter()


class SourceCreate(BaseModel):
    collection: str = "default"
    name: str
    type: str  # rest_api / database
    config: dict
    schedule: str | None = None


@router.get("/sources")
def list_sources(collection: str = "default"):
    with SessionLocal() as db:
        sources = (
            db.query(KnowledgeSource)
            .filter(KnowledgeSource.collection == collection)
            .order_by(KnowledgeSource.id.desc())
            .all()
        )
        return [
            {
                "id": s.id,
                "name": s.name,
                "type": s.type,
                "config": s.config,
                "schedule": s.schedule,
                "enabled": s.enabled,
                "last_sync_at": s.last_sync_at.isoformat() if s.last_sync_at else None,
            }
            for s in sources
        ]


@router.post("/sources")
def create_source(body: SourceCreate):
    if body.type not in ("rest_api", "database"):
        raise HTTPException(status_code=400, detail="type 必须是 rest_api 或 database")
    if body.schedule:
        from apscheduler.triggers.cron import CronTrigger

        try:
            CronTrigger.from_crontab(body.schedule)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"无效的 cron 表达式: {exc}")
    with SessionLocal() as db:
        source = KnowledgeSource(
            collection=body.collection,
            name=body.name,
            type=body.type,
            config=body.config,
            schedule=body.schedule,
            enabled=True,
        )
        db.add(source)
        db.commit()
        db.refresh(source)
        add_source_job(source)
        return {
            "id": source.id,
            "name": source.name,
            "type": source.type,
            "config": source.config,
            "schedule": source.schedule,
            "enabled": source.enabled,
            "last_sync_at": None,
        }


@router.delete("/sources/{source_id}", status_code=204)
def delete_source(source_id: int):
    with SessionLocal() as db:
        source = db.get(KnowledgeSource, source_id)
        if not source:
            raise HTTPException(status_code=404, detail="数据源不存在")
        db.delete(source)
        db.commit()
    remove_source_job(source_id)


@router.post("/sources/{source_id}/sync")
async def sync_source(source_id: int):
    with SessionLocal() as db:
        source = db.get(KnowledgeSource, source_id)
        if not source:
            raise HTTPException(status_code=404, detail="数据源不存在")
        # 放到线程池执行，避免阻塞事件循环（内部有网络请求与 LLM 调用）
        report = await run_in_threadpool(run_source_sync, db, source, "manual")
        return {
            "report": {
                "status": report.status,
                "stats": report.stats,
                "error": report.error,
            }
        }


@router.get("/sources/{source_id}/reports")
def list_reports(source_id: int):
    with SessionLocal() as db:
        reports = (
            db.query(SyncReport)
            .filter(SyncReport.source_id == source_id)
            .order_by(SyncReport.started_at.desc())
            .limit(20)
            .all()
        )
        return [
            {
                "id": r.id,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                "status": r.status,
                "stats": r.stats,
                "error": r.error,
            }
            for r in reports
        ]
