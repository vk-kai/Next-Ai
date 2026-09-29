"""连接器基类：定义“从已部署项目取数据”的统一接口。"""

from collections.abc import Iterator
from typing import NamedTuple


class Record(NamedTuple):
    id: str
    text: str
    title: str | None = None


class BaseConnector:
    def fetch(self, config: dict) -> Iterator[Record]:
        raise NotImplementedError


def resolve_env(value):
    """支持 "env:VAR_NAME" 形式从环境变量读取敏感配置。"""
    if isinstance(value, str) and value.startswith("env:"):
        import os

        return os.environ.get(value[4:], "")
    return value


def dig(data, path: str | None):
    """按 a.b.c 点路径从嵌套 dict 中取值；path 为空返回原数据。"""
    if not path:
        return data
    cur = data
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def record_from_item(
    item: dict, id_field: str, content_fields: list[str] | None
) -> Record:
    rid = str(item.get(id_field, ""))
    if content_fields:
        lines = [f"{field}: {item.get(field)}" for field in content_fields if field in item]
        text = "\n".join(lines)
    else:
        import json

        text = json.dumps(item, ensure_ascii=False, default=str)
    title = item.get("title") or item.get("name") or rid
    return Record(id=rid, text=text, title=str(title))


_CONNECTORS: dict[str, type[BaseConnector]] = {}


def register(name: str):
    def deco(cls):
        _CONNECTORS[name] = cls
        return cls

    return deco


def get_connector(source_type: str) -> BaseConnector:
    cls = _CONNECTORS.get(source_type)
    if not cls:
        raise ValueError(f"不支持的数据源类型: {source_type}（支持: {', '.join(_CONNECTORS)}）")
    return cls()
