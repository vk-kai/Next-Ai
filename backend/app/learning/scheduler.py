"""增量同步调度器：按数据源配置的 cron 周期自动学习。"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.db import SessionLocal
from app.models import KnowledgeSource

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone="Asia/Shanghai")


def _run_job(source_id: int):
    """调度线程中执行：独立开 session，避免与请求线程互相影响。"""
    db = SessionLocal()
    try:
        source = db.get(KnowledgeSource, source_id)
        if not source or not source.enabled:
            return
        from app.learning.sync import run_source_sync

        report = run_source_sync(db, source, trigger="schedule")
        logger.info("数据源 %s 定时同步完成: %s", source.name, report.stats)
    except Exception:  # noqa: BLE001
        logger.exception("数据源 %s 定时同步异常", source_id)
    finally:
        db.close()


def add_source_job(source: KnowledgeSource):
    """为单个数据源注册/更新定时任务。"""
    if not source.schedule or not source.enabled:
        return
    try:
        trigger = CronTrigger.from_crontab(source.schedule)
    except ValueError:
        logger.warning("数据源 %s 的 cron 表达式无效: %s", source.name, source.schedule)
        return
    scheduler.add_job(
        _run_job,
        trigger,
        id=f"source-{source.id}",
        args=[source.id],
        replace_existing=True,
    )


def remove_source_job(source_id: int):
    job = scheduler.get_job(f"source-{source_id}")
    if job:
        job.remove()


def setup_scheduler():
    from app.db import init_db

    init_db()
    db = SessionLocal()
    try:
        for source in (
            db.query(KnowledgeSource)
            .filter(KnowledgeSource.enabled.is_(True))
            .all()
        ):
            add_source_job(source)
    finally:
        db.close()
    if not scheduler.running:
        scheduler.start()
