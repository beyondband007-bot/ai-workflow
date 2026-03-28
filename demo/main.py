from datetime import datetime
from pathlib import Path

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

import auth
import models
import schemas
from database import Base, engine, get_db

Base.metadata.create_all(bind=engine)

BASE_DIR = Path(__file__).resolve().parent
PORTAL_DIR = BASE_DIR.parent / "client-portal"
AUTH_DIR = BASE_DIR / "case-前端页面设计" / "login-app" / "build"

app = FastAPI(title="登录系统 Demo", version="1.0.0")
bearer_scheme = HTTPBearer()
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
if PORTAL_DIR.exists():
    app.mount("/portal", StaticFiles(directory=PORTAL_DIR, html=True), name="portal")
if AUTH_DIR.exists():
    app.mount("/auth", StaticFiles(directory=AUTH_DIR, html=True), name="auth")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/ui", include_in_schema=False)
def login_page():
    if AUTH_DIR.exists():
        return FileResponse(AUTH_DIR / "index.html")
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.post("/register", response_model=schemas.UserResponse, status_code=201)
def register(body: schemas.RegisterRequest, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.email == body.email).first():
        raise HTTPException(status_code=400, detail="邮箱已被注册")

    if db.query(models.User).filter(models.User.username == body.username).first():
        raise HTTPException(status_code=400, detail="用户名已被占用")

    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码长度不能少于 6 位")

    user = models.User(
        email=body.email,
        username=body.username,
        password_hash=auth.hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    point_account_result = db.execute(
        text(
            """
            INSERT IGNORE INTO point_accounts (
                user_id,
                available_points,
                frozen_points,
                total_recharged_points,
                total_consumed_points
            ) VALUES (:user_id, 1000, 0, 1000, 0)
            """
        ),
        {"user_id": user.id},
    )

    if point_account_result.rowcount == 1:
        db.execute(
            text(
                """
                INSERT INTO points_transactions (
                    user_id,
                    type,
                    points,
                    balance_after,
                    remark
                ) VALUES (:user_id, 'manual_adjust', 1000, 1000, :remark)
                """
            ),
            {
                "user_id": user.id,
                "remark": "Initial signup points for client portal",
            },
        )
        db.commit()

    return user


@app.post("/login", response_model=schemas.TokenResponse)
def login(body: schemas.LoginRequest, db: Session = Depends(get_db)):
    identifier = body.identifier.strip()
    user = (
        db.query(models.User)
        .filter(
            or_(
                models.User.email == identifier,
                models.User.username == identifier,
            )
        )
        .first()
    )

    if not user or not auth.verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名/邮箱或密码错误")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="账号已被禁用")

    user.last_login_at = datetime.utcnow()
    db.commit()

    token = auth.create_access_token(user.id, user.email)
    return {"access_token": token}


@app.get("/me", response_model=schemas.UserResponse)
def get_me(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    try:
        payload = auth.decode_access_token(credentials.credentials)
        user_id = int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已过期，请重新登录")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token 无效")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    return user


@app.get("/", include_in_schema=False)
def landing_page():
    return FileResponse(BASE_DIR / "fristlog.html")


@app.get("/health")
def health_check():
    return {"status": "ok", "message": "登录系统运行正常"}
