"""密码哈希（scrypt，标准库）与 JWT 令牌。"""

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from app.config import settings

_TOKEN_ALGO = "HS256"
_TOKEN_EXPIRE_DAYS = 7
_SECRET_FILE = None  # 延迟初始化，指向 data_dir/secret.key


def _secret() -> str:
    """JWT 密钥：首次生成并持久化到 data_dir/secret.key。"""
    global _SECRET_FILE
    if _SECRET_FILE is None:
        _SECRET_FILE = os.path.join(settings.data_dir, "secret.key")
    if os.path.exists(_SECRET_FILE):
        with open(_SECRET_FILE, encoding="utf-8") as fh:
            return fh.read().strip()
    secret = secrets.token_hex(32)
    with open(_SECRET_FILE, "w", encoding="utf-8") as fh:
        fh.write(secret)
    return secret


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.scrypt(
            password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32
        )
        return secrets.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def create_token(username: str) -> str:
    payload = {
        "sub": username,
        "exp": datetime.now(timezone.utc) + timedelta(days=_TOKEN_EXPIRE_DAYS),
    }
    return jwt.encode(payload, _secret(), algorithm=_TOKEN_ALGO)


def decode_token(token: str) -> str | None:
    """返回 username；无效/过期返回 None。"""
    try:
        payload = jwt.decode(token, _secret(), algorithms=[_TOKEN_ALGO])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None
