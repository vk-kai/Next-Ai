"""REST API 连接器：从已部署项目的 HTTP 接口抓取数据。

config 示例：
{
  "url": "https://news.example.com/api/articles",
  "method": "GET",
  "headers": {"Authorization": "env:NEWS_TOKEN"},
  "params": {"lang": "zh"},
  "items_path": "data.items",        # 返回 JSON 里记录列表的路径，空则把整个响应当列表
  "id_field": "id",                  # 记录唯一键，用于增量更新
  "updated_field": "updated_at",     # 可选
  "content_fields": ["title", "content"],  # 要学习的字段，空则序列化整个记录
  "pagination": {                    # 可选，不配则只请求一次
    "page_param": "page", "size_param": "page_size",
    "page_size": 100, "max_pages": 50
  }
}
"""

from collections.abc import Iterator

import httpx

from app.learning.connectors.base import (
    BaseConnector,
    Record,
    dig,
    record_from_item,
    resolve_env,
)
from app.learning.connectors.base import register


@register("rest_api")
class RESTConnector(BaseConnector):
    def __init__(self, transport: httpx.BaseTransport | None = None):
        self._transport = transport  # 供测试注入 MockTransport

    def _request(self, client: httpx.Client, config: dict, extra_params: dict | None = None):
        url = resolve_env(config["url"])
        method = (config.get("method") or "GET").upper()
        headers = {k: resolve_env(v) for k, v in (config.get("headers") or {}).items()}
        params = {k: resolve_env(v) for k, v in (config.get("params") or {}).items()}
        if extra_params:
            params.update(extra_params)
        resp = client.request(method, url, headers=headers, params=params)
        resp.raise_for_status()
        return resp.json()

    def fetch(self, config: dict) -> Iterator[Record]:
        id_field = config.get("id_field")
        if not id_field:
            raise ValueError("REST 数据源缺少 id_field 配置")
        items_path = config.get("items_path")
        content_fields = config.get("content_fields") or None

        with httpx.Client(timeout=30, transport=self._transport, trust_env=False) as client:
            pagination = config.get("pagination")
            if not pagination:
                data = self._request(client, config)
                items = dig(data, items_path)
                if items is None:
                    items = data if isinstance(data, list) else [data]
                for item in items:
                    yield record_from_item(item, id_field, content_fields)
                return

            page_param = pagination.get("page_param", "page")
            size_param = pagination.get("size_param", "page_size")
            page_size = int(pagination.get("page_size", 100))
            max_pages = int(pagination.get("max_pages", 100))
            for page in range(1, max_pages + 1):
                data = self._request(
                    client, config, {page_param: page, size_param: page_size}
                )
                items = dig(data, items_path) or []
                if not items:
                    break
                for item in items:
                    yield record_from_item(item, id_field, content_fields)
                if len(items) < page_size:
                    break
