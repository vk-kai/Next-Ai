import os

import sqlalchemy as sa
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


# 模块导入时即初始化引擎，避免各处延迟绑定拿到 None
os.makedirs(settings.data_dir, exist_ok=True)
engine = sa.create_engine(
    f"sqlite:///{os.path.join(settings.data_dir, 'nextai.db')}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app import models  # noqa: F401 确保模型已注册

    Base.metadata.create_all(engine)
