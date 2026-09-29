"""认证接口与鉴权依赖。首个用户通过 /auth/register 初始化，之后只能登录。"""

import re

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core.security import create_token, decode_token, hash_password, verify_password
from app.db import SessionLocal
from app.models import User

router = APIRouter()

_bearer = HTTPBearer(auto_error=False)


def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """FastAPI 依赖：校验 Bearer token，返回 username。"""
    token = credentials.credentials if credentials else None
    username = decode_token(token) if token else None
    if not username:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    return username


class Credentials(BaseModel):
    username: str
    password: str


class ChangePassword(BaseModel):
    old_password: str
    new_password: str


def _validate(username: str, password: str):
    if not re.fullmatch(r"[\w.\-\u4e00-\u9fff]{2,64}", username):
        raise HTTPException(status_code=400, detail="用户名需为 2-64 位字母/数字/中文/._-")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")


def _has_users() -> bool:
    with SessionLocal() as db:
        return db.query(User).count() > 0


@router.get("/auth/status")
def auth_status():
    return {"has_users": _has_users()}


@router.post("/auth/register")
def register(body: Credentials):
    if _has_users():
        raise HTTPException(status_code=403, detail="系统已初始化，请直接登录")
    _validate(body.username, body.password)
    with SessionLocal() as db:
        user = User(username=body.username, password_hash=hash_password(body.password))
        db.add(user)
        db.commit()
    return {"token": create_token(body.username), "username": body.username}


@router.post("/auth/login")
def login(body: Credentials):
    with SessionLocal() as db:
        user = db.query(User).filter(User.username == body.username).first()
        if not user or not verify_password(body.password, user.password_hash):
            raise HTTPException(status_code=401, detail="用户名或密码错误")
    return {"token": create_token(body.username), "username": body.username}


@router.get("/auth/me")
def me(username: str = Depends(require_auth)):
    return {"username": username}


@router.post("/auth/change-password")
def change_password(
    body: ChangePassword, username: str = Depends(require_auth)
):
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")
    with SessionLocal() as db:
        user = db.query(User).filter(User.username == username).first()
        if not user or not verify_password(body.old_password, user.password_hash):
            raise HTTPException(status_code=400, detail="旧密码错误")
        user.password_hash = hash_password(body.new_password)
        db.commit()
    return Response(status_code=204)
