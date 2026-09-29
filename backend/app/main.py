"""Next-AI 应用入口。启动：uvicorn app.main:app --port 8000"""

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import SessionLocal, init_db
from app.models import Collection

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with SessionLocal() as db:
        if not db.get(Collection, "default"):
            db.add(
                Collection(
                    name="default",
                    description="默认知识库。请修改此描述，告诉智能体当前项目是做什么的。",
                )
            )
            db.commit()
    from app.learning.scheduler import setup_scheduler

    setup_scheduler()
    yield
    from app.learning.scheduler import scheduler

    if scheduler.running:
        scheduler.shutdown(wait=False)


app = FastAPI(title="Next-AI", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip() for o in settings.cors_origins.split(",") if o.strip()
    ]
    or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.api import auth, chat, files, kb, settings, sources  # noqa: E402
from app.api.auth import require_auth  # noqa: E402

app.include_router(auth.router, prefix="/api")
# 以下接口全部需要登录
app.include_router(chat.router, prefix="/api", dependencies=[Depends(require_auth)])
app.include_router(files.router, prefix="/api", dependencies=[Depends(require_auth)])
app.include_router(kb.router, prefix="/api", dependencies=[Depends(require_auth)])
app.include_router(sources.router, prefix="/api", dependencies=[Depends(require_auth)])
app.include_router(settings.router, prefix="/api", dependencies=[Depends(require_auth)])


@app.get("/api/health")
def health():
    return {"status": "ok"}
