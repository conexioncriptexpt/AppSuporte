import os
import uuid
import hashlib
import secrets
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

import bcrypt
import jwt
import requests
from dotenv import load_dotenv
from fastapi import HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
JWT_SECRET = os.environ["JWT_SECRET"]
ACCESS_MIN = int(os.environ.get("ACCESS_TOKEN_MINUTES", "15"))
REFRESH_DAYS = int(os.environ.get("REFRESH_TOKEN_DAYS", "7"))
DEVICE_TOKEN_HOURS = 12

logging.basicConfig(level=logging.INFO, format='{"t":"%(asctime)s","lvl":"%(levelname)s","mod":"%(name)s","msg":"%(message)s"}')
log = logging.getLogger("conex")

DEFAULT_SETTINGS = {
    "id": "global",
    "retention_days": 180,
    "default_link_days": 30,
    "sound_enabled": True,
    "github_repo": "conexioncriptexpt/AppSuporte",
    "android_download_url": "",
    "windows_download_url": "",
}


def now():
    return datetime.now(timezone.utc)


def iso(dt=None):
    return (dt or now()).isoformat()


def new_id():
    return str(uuid.uuid4())


def sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(12)).decode()


def verify_pw(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), h.encode())
    except ValueError:
        return False


def create_access(user: dict) -> str:
    payload = {"sub": user["id"], "role": user["role"], "typ": "access", "exp": now() + timedelta(minutes=ACCESS_MIN)}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def create_device_token(device_id: str) -> str:
    payload = {"sub": device_id, "typ": "device", "exp": now() + timedelta(hours=DEVICE_TOKEN_HOURS)}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_token(token: str, typ: str):
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return data if data.get("typ") == typ else None


async def new_refresh(user_id: str, family: str = None) -> str:
    raw = secrets.token_urlsafe(48)
    await db.refresh_tokens.insert_one({
        "token_hash": sha(raw), "user_id": user_id, "family": family or new_id(),
        "expires_at": iso(now() + timedelta(days=REFRESH_DAYS)), "revoked": False, "created_at": iso(),
    })
    return raw


PUBLIC_USER = {"_id": 0, "password_hash": 0}


async def current_user(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    data = decode_token(auth[7:], "access") if auth.lower().startswith("bearer ") else None
    if not data:
        raise HTTPException(401, "Sessão expirada ou inválida")
    user = await db.users.find_one({"id": data["sub"]}, PUBLIC_USER)
    if not user or not user.get("active"):
        raise HTTPException(401, "Conta inativa")
    return user


async def super_admin(request: Request) -> dict:
    user = await current_user(request)
    if user["role"] != "super_admin":
        raise HTTPException(403, "Apenas o Super Admin pode realizar esta operação")
    return user


async def audit(actor: str, action: str, target: str = "", details: dict = None):
    await db.auditLogs.insert_one({"id": new_id(), "actor": actor, "action": action, "target": target,
                                   "details": details or {}, "at": iso()})
    log.info(f"audit action={action} actor={actor} target={target}")


async def get_settings() -> dict:
    s = await db.systemSettings.find_one({"id": "global"}, {"_id": 0})
    if not s:
        s = dict(DEFAULT_SETTINGS)
        await db.systemSettings.insert_one(dict(s))
        s.pop("_id", None)
    return {**DEFAULT_SETTINGS, **s}


def download_urls(s: dict) -> dict:
    repo = (s.get("github_repo") or "").strip().strip("/")
    base = f"https://github.com/{repo}/releases/latest/download" if repo else ""
    return {
        "android": s.get("android_download_url") or (f"{base}/CryptoConex.apk" if base else ""),
        "windows": s.get("windows_download_url") or (f"{base}/CryptoConexSetup.exe" if base else ""),
    }


_assets = {}


def _head_ok(url: str) -> bool:
    try:
        return requests.head(url, allow_redirects=True, timeout=6).status_code == 200
    except requests.RequestException:
        return False


async def asset_available(url: str) -> bool:
    """Checks (cached 5 min) whether a release file exists, so the site never sends users to a 404."""
    if not url:
        return False
    hit = _assets.get(url)
    if hit and (now() - hit[1]).total_seconds() < 300:
        return hit[0]
    ok = await asyncio.to_thread(_head_ok, url)
    _assets[url] = (ok, now())
    return ok


def _metered_credentials():
    domain, key = os.environ.get("METERED_DOMAIN"), os.environ.get("METERED_API_KEY")
    if not (domain and key):
        return None
    try:
        r = requests.get(f"https://{domain}/api/v1/turn/credentials", params={"apiKey": key}, timeout=8)
        r.raise_for_status()
        return r.json()
    except requests.RequestException:
        log.warning("metered temporary credentials failed, using static env credentials")
        return None


async def get_ice_servers() -> list:
    temp = await asyncio.to_thread(_metered_credentials)
    if temp:
        return temp
    urls = [u.strip() for u in os.environ.get("TURN_URLS", "").split(",") if u.strip()]
    user, cred = os.environ.get("TURN_USERNAME", ""), os.environ.get("TURN_CREDENTIAL", "")
    servers = []
    for u in urls:
        if u.startswith("stun:"):
            servers.append({"urls": u})
        else:
            servers.append({"urls": u, "username": user, "credential": cred})
    return servers or [{"urls": "stun:stun.l.google.com:19302"}]


_rate = {}


def rate_limit(key: str, limit: int, window_s: int):
    t = now().timestamp()
    hits = [h for h in _rate.get(key, []) if t - h < window_s]
    if len(hits) >= limit:
        raise HTTPException(429, "Demasiados pedidos. Tente novamente dentro de instantes.")
    hits.append(t)
    _rate[key] = hits


def client_ip(request: Request) -> str:
    # Right-most hop is the one appended by our own ingress; earlier hops are client-supplied.
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[-1].strip() if fwd else (request.client.host if request.client else "")
