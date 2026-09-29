"""认证与配置接口自测（TestClient 走完整 HTTP 栈，LLM/Embedding 用假服务）。"""

import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="nextai-auth-test-"))
os.environ["LLM_BASE_URL"] = "http://127.0.0.1:9999/v1"
os.environ["LLM_API_KEY"] = "test-key"
os.environ["LLM_MODEL"] = "test-model"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_auth_and_settings_flow():
    with TestClient(app) as client:
        # 未登录访问受保护接口 -> 401
        assert client.get("/api/kb/collections").status_code == 401

        # 初始化管理员
        status = client.get("/api/auth/status").json()
        if status["has_users"]:
            client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
            return
        r = client.post(
            "/api/auth/register", json={"username": "admin", "password": "admin123"}
        )
        assert r.status_code == 200, r.text
        token = r.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 已初始化后不能重复注册
        assert (
            client.post(
                "/api/auth/register", json={"username": "x", "password": "xxxxxx"}
            ).status_code
            == 403
        )
        # 错误密码 -> 401
        assert (
            client.post(
                "/api/auth/login", json={"username": "admin", "password": "wrong"}
            ).status_code
            == 401
        )
        # me 校验
        assert client.get("/api/auth/me", headers=headers).json()["username"] == "admin"
        # 登录后受保护接口可访问
        assert client.get("/api/kb/collections", headers=headers).status_code == 200

        # 保存智能体配置（含 api_key）
        r = client.put(
            "/api/settings",
            headers=headers,
            json={
                "agent": {"name": "新闻助手", "persona": "你是新闻知识助手，回答简洁。"},
                "llm": {"base_url": "http://127.0.0.1:9999/v1", "api_key": "sk-test-1", "model": "test-model"},
                "embedding": {"base_url": "", "api_key": "", "model": ""},
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["agent"]["name"] == "新闻助手"
        assert body["llm"]["has_api_key"] is True
        assert "api_key" not in body["llm"]  # 明文 key 不回传

        # 再次保存时 api_key 留空 -> 保持不变
        r = client.put(
            "/api/settings",
            headers=headers,
            json={
                "agent": {"name": "新闻助手", "persona": ""},
                "llm": {"base_url": "http://127.0.0.1:9999/v1", "api_key": "", "model": "test-model"},
                "embedding": {"base_url": "", "api_key": "", "model": ""},
            },
        )
        assert r.json()["llm"]["has_api_key"] is True

        # 连通性测试（走假 LLM 服务）
        r = client.post("/api/settings/test", headers=headers)
        assert r.status_code == 200
        assert r.json()["llm"]["ok"] is True

        # 修改密码后用新密码登录
        r = client.post(
            "/api/auth/change-password",
            headers=headers,
            json={"old_password": "admin123", "new_password": "newpass456"},
        )
        assert r.status_code == 204
        assert (
            client.post(
                "/api/auth/login", json={"username": "admin", "password": "newpass456"}
            ).status_code
            == 200
        )
