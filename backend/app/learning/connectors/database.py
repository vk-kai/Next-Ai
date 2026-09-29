"""数据库连接器：直接查询已部署项目的数据库来学习数据。

config 示例：
{
  "dsn": "postgresql+psycopg://user:pass@host/db",   # 或 sqlite:///path.db
  "query": "SELECT id, title, content FROM articles",
  "id_field": "id",
  "updated_field": "updated_at",
  "content_fields": ["title", "content"]
}

说明：需要目标数据库对应驱动（如 psycopg2-binary / pymysql），SQLite 开箱即用。
"""

from collections.abc import Iterator

from sqlalchemy import create_engine, text

from app.learning.connectors.base import (
    BaseConnector,
    Record,
    record_from_item,
    resolve_env,
)
from app.learning.connectors.base import register


@register("database")
class DatabaseConnector(BaseConnector):
    def fetch(self, config: dict) -> Iterator[Record]:
        dsn = resolve_env(config.get("dsn"))
        query = config.get("query")
        if not dsn or not query:
            raise ValueError("数据库数据源需要 dsn 和 query 配置")
        id_field = config.get("id_field")
        if not id_field:
            raise ValueError("数据库数据源缺少 id_field 配置")
        content_fields = config.get("content_fields") or None

        engine = create_engine(dsn)
        try:
            with engine.connect() as conn:
                rows = conn.execute(text(query))
                keys = list(rows.keys())
                for row in rows:
                    item = dict(zip(keys, row, strict=False))
                    yield record_from_item(item, id_field, content_fields)
        finally:
            engine.dispose()
