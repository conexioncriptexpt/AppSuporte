import os
import secrets
from datetime import timedelta, datetime
from typing import Optional, List
from zoneinfo import ZoneInfo

import socketio
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

from core import (db, client, now, iso, new_id, sha, hash_pw, verify_pw, create_access, create_device_token,
                  decode_token, new_refresh, current_user, super_admin, audit, get_settings, download_urls, asset_available,
                  get_ice_servers, rate_limit, client_ip, log, PUBLIC_USER, DEFAULT_SETTINGS)
from realtime import sio, end_session, broadcast_queue, add_op, technician_state, busy_technicians, evict_user, ONLINE_DEVICES, OPEN

LISBON = ZoneInfo("Europe/Lisbon")
fastapi_app = FastAPI(title="Crypto Conex API")
api = APIRouter(prefix="/api")
NO_BIG = {"_id": 0, "operations": 0, "messages": 0}
DEFAULT_PERMS = {"control": True, "privacy": True, "accessibility": True}


# ---------- models ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class ChangePwIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10)


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    new_password: str = Field(min_length=10)


class Perms(BaseModel):
    control: bool = True
    privacy: bool = True
    accessibility: bool = True


class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=10)
    permissions: Perms = Perms()


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=80)
    email: Optional[EmailStr] = None
    active: Optional[bool] = None
    permissions: Optional[Perms] = None


class PasswordSet(BaseModel):
    password: str = Field(min_length=10)


class DeviceRegister(BaseModel):
    install_id: str = Field(min_length=8, max_length=80)
    platform: str = Field(pattern="^(browser|android|windows)$")
    os: str = Field(max_length=40)
    os_version: str = Field("", max_length=60)
    name: str = Field("", max_length=80)


class RenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class AssignIn(BaseModel):
    technician_id: str


class LinkCreate(BaseModel):
    technician_id: Optional[str] = None
    days: Optional[int] = Field(None, ge=0, le=365)


class SettingsIn(BaseModel):
    retention_days: int = Field(ge=7, le=3650)
    default_link_days: int = Field(ge=0, le=365)
    sound_enabled: bool
    github_repo: str = Field("", max_length=120)
    android_download_url: str = Field("", max_length=300)
    windows_download_url: str = Field("", max_length=300)


# ---------- auth ----------
@api.post("/auth/login")
async def login(body: LoginIn, request: Request):
    ip = client_ip(request)
    email = body.email.lower()
    rate_limit(f"login:{ip}", 60, 300)
    rate_limit(f"login:{ip}:{email}", 10, 300)
    att = await db.login_attempts.find_one({"email": email}, {"_id": 0})
    if att and att.get("locked_until") and att["locked_until"] > iso():
        raise HTTPException(429, "Conta temporariamente bloqueada após várias tentativas. Tente dentro de 15 minutos.")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_pw(body.password, user["password_hash"]):
        count = (att or {}).get("count", 0) + 1
        upd = {"count": count, "last": iso()}
        if count >= 5:
            upd = {"count": 0, "locked_until": iso(now() + timedelta(minutes=15))}
        await db.login_attempts.update_one({"email": email}, {"$set": upd}, upsert=True)
        await audit(email, "auth.login_failed", "", {"ip": ip})
        raise HTTPException(401, "Email ou palavra-passe incorretos")
    if not user.get("active"):
        raise HTTPException(403, "Conta desativada. Contacte o administrador.")
    await db.login_attempts.delete_one({"email": email})
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login": iso()}})
    await audit(user["id"], "auth.login", "", {"ip": ip})
    user.pop("password_hash")
    return {"access_token": create_access(user), "refresh_token": await new_refresh(user["id"]), "user": user}


@api.post("/auth/refresh")
async def refresh(body: RefreshIn):
    h = sha(body.refresh_token)
    doc = await db.refresh_tokens.find_one_and_update({"token_hash": h, "revoked": False}, {"$set": {"revoked": True}},
                                                      projection={"_id": 0})
    if not doc:
        doc = await db.refresh_tokens.find_one({"token_hash": h}, {"_id": 0})
        if not doc:
            raise HTTPException(401, "Sessão inválida")
        await db.refresh_tokens.update_many({"family": doc["family"]}, {"$set": {"revoked": True}})
        await audit(doc["user_id"], "auth.refresh_reuse_detected")
        raise HTTPException(401, "Sessão revogada")
    if doc["expires_at"] < iso():
        raise HTTPException(401, "Sessão expirada")
    user = await db.users.find_one({"id": doc["user_id"]}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("active"):
        raise HTTPException(401, "Conta inativa")
    return {"access_token": create_access(user), "refresh_token": await new_refresh(user["id"], doc["family"]), "user": user}


@api.post("/auth/logout")
async def logout(body: RefreshIn):
    doc = await db.refresh_tokens.find_one({"token_hash": sha(body.refresh_token)}, {"_id": 0})
    if doc:
        await db.refresh_tokens.update_many({"family": doc["family"]}, {"$set": {"revoked": True}})
        await audit(doc["user_id"], "auth.logout")
    return {"ok": True}


@api.get("/auth/me")
async def me(user=Depends(current_user)):
    return user


@api.post("/auth/change-password")
async def change_password(body: ChangePwIn, user=Depends(current_user)):
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not verify_pw(body.current_password, full["password_hash"]):
        raise HTTPException(400, "Palavra-passe atual incorreta")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_pw(body.new_password)}})
    await db.refresh_tokens.update_many({"user_id": user["id"]}, {"$set": {"revoked": True}})
    await audit(user["id"], "auth.password_changed")
    return {"ok": True}


@api.post("/auth/forgot")
async def forgot(body: ForgotIn, request: Request):
    rate_limit(f"forgot:{client_ip(request)}", 5, 600)
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0, "id": 1, "name": 1, "email": 1})
    if user:
        await db.reset_requests.update_one({"user_id": user["id"]}, {"$set": {
            "user_id": user["id"], "name": user["name"], "email": user["email"], "at": iso(), "handled": False}}, upsert=True)
        await audit(user["id"], "auth.reset_requested")
        await sio.emit("reset:requested", {"email": user["email"]}, room="admin:global")
    return {"ok": True, "message": "Se o email existir, o administrador foi notificado para lhe enviar um link seguro de recuperação."}


@api.post("/auth/reset")
async def reset(body: ResetIn):
    doc = await db.password_resets.find_one({"token_hash": sha(body.token)}, {"_id": 0})
    if not doc or doc["used"] or doc["expires_at"] < iso():
        raise HTTPException(400, "Link de recuperação inválido ou expirado")
    await db.users.update_one({"id": doc["user_id"]}, {"$set": {"password_hash": hash_pw(body.new_password)}})
    await db.password_resets.update_one({"token_hash": doc["token_hash"]}, {"$set": {"used": True}})
    await db.refresh_tokens.update_many({"user_id": doc["user_id"]}, {"$set": {"revoked": True}})
    await db.reset_requests.update_one({"user_id": doc["user_id"]}, {"$set": {"handled": True}})
    target = await db.users.find_one({"id": doc["user_id"]}, {"_id": 0, "email": 1})
    if target:
        await db.login_attempts.delete_one({"email": target["email"]})
    await audit(doc["user_id"], "auth.password_reset")
    return {"ok": True}


# ---------- users / technicians ----------
@api.get("/users")
async def list_users(admin=Depends(super_admin)):
    busy = await busy_technicians()
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(500)
    out = []
    for u in users:
        out.append({**u, "state": technician_state(u["id"], busy),
                    "sessions_total": await db.sessions.count_documents({"technician_id": u["id"]})})
    return out


@api.get("/technicians")
async def list_technicians(user=Depends(current_user)):
    busy = await busy_technicians()
    users = await db.users.find({"active": True}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(500)
    return [{**u, "state": technician_state(u["id"], busy)} for u in users]


@api.post("/users")
async def create_user(body: UserCreate, admin=Depends(super_admin)):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Já existe uma conta com este email")
    u = {"id": new_id(), "name": body.name.strip(), "email": email, "password_hash": hash_pw(body.password),
         "role": "technician", "active": True, "permissions": body.permissions.model_dump(), "created_at": iso(), "last_login": None}
    await db.users.insert_one(dict(u))
    await audit(admin["id"], "user.create", u["id"], {"email": email})
    u.pop("password_hash")
    return u


@api.patch("/users/{uid}")
async def update_user(uid: str, body: UserUpdate, admin=Depends(super_admin)):
    target = await db.users.find_one({"id": uid}, PUBLIC_USER)
    if not target:
        raise HTTPException(404, "Utilizador não encontrado")
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "email" in upd:
        upd["email"] = upd["email"].lower()
        if await db.users.find_one({"email": upd["email"], "id": {"$ne": uid}}):
            raise HTTPException(409, "Email já utilizado")
    if target["role"] == "super_admin" and upd.get("active") is False:
        raise HTTPException(400, "Não é possível desativar o Super Admin")
    if upd:
        await db.users.update_one({"id": uid}, {"$set": upd})
    if upd.get("active") is False:
        await db.refresh_tokens.update_many({"user_id": uid}, {"$set": {"revoked": True}})
    await audit(admin["id"], "user.update", uid, {k: v for k, v in upd.items() if k != "permissions"})
    updated = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    return updated


@api.post("/users/{uid}/password")
async def set_password(uid: str, body: PasswordSet, admin=Depends(super_admin)):
    r = await db.users.update_one({"id": uid}, {"$set": {"password_hash": hash_pw(body.password)}})
    if not r.matched_count:
        raise HTTPException(404, "Utilizador não encontrado")
    await db.refresh_tokens.update_many({"user_id": uid}, {"$set": {"revoked": True}})
    await audit(admin["id"], "user.password_set", uid)
    return {"ok": True}


@api.post("/users/{uid}/reset-link")
async def reset_link(uid: str, admin=Depends(super_admin)):
    if not await db.users.find_one({"id": uid}):
        raise HTTPException(404, "Utilizador não encontrado")
    raw = secrets.token_urlsafe(32)
    await db.password_resets.insert_one({"token_hash": sha(raw), "user_id": uid, "used": False,
                                         "expires_at": iso(now() + timedelta(hours=1)), "created_at": iso()})
    await audit(admin["id"], "user.reset_link", uid)
    return {"token": raw, "expires_in_minutes": 60}


@api.get("/reset-requests")
async def reset_requests(admin=Depends(super_admin)):
    return await db.reset_requests.find({"handled": False}, {"_id": 0}).sort("at", -1).to_list(100)


@api.delete("/users/{uid}")
async def delete_user(uid: str, admin=Depends(super_admin)):
    target = await db.users.find_one({"id": uid}, PUBLIC_USER)
    if not target:
        raise HTTPException(404, "Utilizador não encontrado")
    if target["role"] == "super_admin":
        raise HTTPException(400, "Não é possível eliminar o Super Admin")
    if await db.sessions.count_documents({"technician_id": uid, "status": {"$in": ["assigned", "active"]}}):
        raise HTTPException(409, "O técnico tem atendimentos em curso. Transfira-os primeiro.")
    await db.users.delete_one({"id": uid})
    await db.technicianLinks.update_many({"technician_id": uid}, {"$set": {"revoked": True}})
    await db.refresh_tokens.update_many({"user_id": uid}, {"$set": {"revoked": True}})
    await audit(admin["id"], "user.delete", uid, {"email": target["email"]})
    return {"ok": True}


@api.get("/users/{uid}/activity")
async def user_activity(uid: str, admin=Depends(super_admin)):
    logs = await db.auditLogs.find({"actor": uid}, {"_id": 0}).sort("at", -1).to_list(100)
    sessions = await db.sessions.find({"technician_id": uid}, NO_BIG).sort("created_at", -1).to_list(50)
    return {"logs": logs, "sessions": sessions}


# ---------- dashboard ----------
def scope_for(user):
    if user["role"] == "super_admin":
        return {}
    return {"$or": [{"technician_id": user["id"]}, {"target_technician_id": user["id"], "status": "pending"}]}


@api.get("/dashboard")
async def dashboard(user=Depends(current_user)):
    await cleanup_retention()
    sc = scope_for(user)
    dev_q = {} if user["role"] == "super_admin" else {"id": {"$in": await db.sessions.distinct("device_id", {"technician_id": user["id"]})}}
    busy = await busy_technicians()
    techs = await db.users.find({"active": True}, {"_id": 0, "id": 1}).to_list(500)
    states = [technician_state(t["id"], busy) for t in techs]
    today = datetime.now(LISBON).replace(hour=0, minute=0, second=0, microsecond=0)
    chart = []
    for i in range(6, -1, -1):
        d0 = today - timedelta(days=i)
        d1 = d0 + timedelta(days=1)
        n = await db.sessions.count_documents({**sc, "created_at": {"$gte": d0.isoformat(), "$lt": d1.isoformat()}})
        chart.append({"day": d0.strftime("%d/%m"), "total": n})
    ended = await db.sessions.find({**sc, "status": "ended", "duration_s": {"$gt": 0}}, {"_id": 0, "duration_s": 1}).to_list(2000)
    return {
        "devices_total": await db.devices.count_documents(dev_q),
        "devices_online": await db.devices.count_documents({**dev_q, "online": True}),
        "pending": await db.sessions.count_documents({**sc, "status": {"$in": ["pending", "assigned"]}}),
        "active": await db.sessions.count_documents({**sc, "status": "active"}),
        "history_total": await db.sessions.count_documents({**sc, "status": "ended"}),
        "techs_available": states.count("disponivel"),
        "techs_busy": states.count("ocupado"),
        "avg_duration_s": int(sum(e["duration_s"] for e in ended) / len(ended)) if ended else 0,
        "chart": chart,
    }


_last_cleanup = {"at": None}


async def cleanup_retention():
    if _last_cleanup["at"] and (now() - _last_cleanup["at"]).total_seconds() < 3600:
        return
    _last_cleanup["at"] = now()
    s = await get_settings()
    cutoff = iso(now() - timedelta(days=s["retention_days"]))
    r1 = await db.sessions.delete_many({"status": "ended", "ended_at": {"$lt": cutoff}})
    r2 = await db.auditLogs.delete_many({"at": {"$lt": cutoff}})
    await db.refresh_tokens.delete_many({"expires_at": {"$lt": iso()}})
    if r1.deleted_count or r2.deleted_count:
        log.info(f"retention cleanup sessions={r1.deleted_count} logs={r2.deleted_count}")


# ---------- sessions / queue ----------
@api.get("/sessions")
async def list_sessions(scope: str = "active", user=Depends(current_user)):
    sc = scope_for(user)
    statuses = ["ended"] if scope == "history" else OPEN
    sort = ("ended_at" if scope == "history" else "created_at", -1 if scope == "history" else 1)
    items = await db.sessions.find({**sc, "status": {"$in": statuses}}, NO_BIG).sort(*sort).to_list(500)
    for s in items:
        s["device_online"] = s["device_id"] in ONLINE_DEVICES
    return items


async def get_scoped_session(sid: str, user: dict, full=False) -> dict:
    proj = {"_id": 0} if full else NO_BIG
    s = await db.sessions.find_one({"id": sid, **scope_for(user)}, proj)
    if not s:
        raise HTTPException(404, "Sessão não encontrada")
    return s


@api.get("/sessions/{sid}")
async def get_session(sid: str, user=Depends(current_user)):
    s = await get_scoped_session(sid, user, full=True)
    s["device"] = await db.devices.find_one({"id": s["device_id"]}, {"_id": 0})
    s["device_online"] = s["device_id"] in ONLINE_DEVICES
    return s


async def _assign(s: dict, tech_id: str, actor: dict, action: str):
    tech = await db.users.find_one({"id": tech_id, "active": True}, PUBLIC_USER)
    if not tech:
        raise HTTPException(404, "Técnico não encontrado ou inativo")
    status = "active" if s["status"] == "active" else "assigned"
    await db.sessions.update_one({"id": s["id"]}, {"$set": {"technician_id": tech_id, "technician_name": tech["name"],
                                                            "status": status, "assigned_at": iso()}})
    await db.supportRequests.update_one({"session_id": s["id"]}, {"$set": {"status": "assigned", "technician_id": tech_id}})
    await db.devices.update_one({"id": s["device_id"]}, {"$set": {"last_technician_id": tech_id, "last_technician_name": tech["name"]}})
    await add_op(s["id"], actor["name"], f"{'Transferido' if action == 'transfer' else 'Atribuído'} a {tech['name']}")
    await audit(actor["id"], f"session.{action}", s["id"], {"technician_id": tech_id})
    payload = {"session_id": s["id"], "technician_id": tech_id, "technician_name": tech["name"]}
    await sio.emit("support:assigned", payload, room=f"technician:{tech_id}")
    await sio.emit("support:assigned", payload, room=f"device:{s['device_id']}")
    if s.get("technician_id") and s["technician_id"] != tech_id:
        await evict_user(s["technician_id"], s["id"])
        await sio.emit("session:transferred", payload, room=f"technician:{s['technician_id']}")
    s.update({"technician_id": tech_id, "status": status})
    await broadcast_queue(s)
    return await db.sessions.find_one({"id": s["id"]}, NO_BIG)


@api.post("/sessions/{sid}/assign")
async def assign(sid: str, body: AssignIn, admin=Depends(super_admin)):
    s = await get_scoped_session(sid, admin)
    if s["status"] not in ("pending", "assigned"):
        raise HTTPException(400, "Só é possível atribuir pedidos pendentes")
    return await _assign(s, body.technician_id, admin, "assign")


@api.post("/sessions/{sid}/take")
async def take(sid: str, user=Depends(current_user)):
    s = await get_scoped_session(sid, user)
    if s["status"] != "pending":
        raise HTTPException(400, "Este pedido já não está pendente")
    return await _assign(s, user["id"], user, "take")


@api.post("/sessions/{sid}/transfer")
async def transfer(sid: str, body: AssignIn, user=Depends(current_user)):
    s = await get_scoped_session(sid, user)
    if s["status"] not in ("assigned", "active"):
        raise HTTPException(400, "Só é possível transferir atendimentos em curso")
    if user["role"] != "super_admin" and s.get("technician_id") != user["id"]:
        raise HTTPException(403, "Sem permissão")
    return await _assign(s, body.technician_id, user, "transfer")


@api.post("/sessions/{sid}/end")
async def end(sid: str, user=Depends(current_user)):
    s = await get_scoped_session(sid, user)
    if user["role"] != "super_admin" and s.get("technician_id") != user["id"]:
        raise HTTPException(403, "Sem permissão")
    await end_session(sid, user["id"])
    return {"ok": True}


@api.post("/sessions/{sid}/discard")
async def discard(sid: str, admin=Depends(super_admin)):
    s = await get_scoped_session(sid, admin)
    if s["status"] != "pending":
        raise HTTPException(400, "Só é possível descartar pedidos pendentes")
    await end_session(sid, admin["id"])
    await db.sessions.update_one({"id": sid}, {"$set": {"discarded": True}})
    return {"ok": True}


# ---------- devices ----------
async def device_scope(user):
    if user["role"] == "super_admin":
        return {}
    return {"id": {"$in": await db.sessions.distinct("device_id", {"technician_id": user["id"]})}}


@api.get("/devices")
async def list_devices(q: str = "", os: str = "", status: str = "", user=Depends(current_user)):
    query = await device_scope(user)
    if q:
        import re
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"name": rx}, {"client_name": rx}, {"os": rx}, {"id": rx}]
    if os:
        query["platform"] = os
    if status in ("online", "offline"):
        query["online"] = status == "online"
    items = await db.devices.find(query, {"_id": 0, "install_id": 0}).sort("last_seen", -1).to_list(1000)
    for d in items:
        d["sessions_total"] = await db.sessions.count_documents({"device_id": d["id"]})
    return items


@api.get("/devices/{did}")
async def get_device(did: str, user=Depends(current_user)):
    d = await db.devices.find_one({"id": did, **(await device_scope(user))}, {"_id": 0, "install_id": 0})
    if not d:
        raise HTTPException(404, "Dispositivo não encontrado")
    sq = {"device_id": did} if user["role"] == "super_admin" else {"device_id": did, "technician_id": user["id"]}
    d["sessions"] = await db.sessions.find(sq, NO_BIG).sort("created_at", -1).to_list(200)
    return d


@api.patch("/devices/{did}")
async def rename_device(did: str, body: RenameIn, user=Depends(current_user)):
    r = await db.devices.update_one({"id": did, **(await device_scope(user))}, {"$set": {"name": body.name.strip()}})
    if not r.matched_count:
        raise HTTPException(404, "Dispositivo não encontrado")
    await db.sessions.update_many({"device_id": did}, {"$set": {"device_name": body.name.strip()}})
    await audit(user["id"], "device.rename", did, {"name": body.name})
    return await db.devices.find_one({"id": did}, {"_id": 0, "install_id": 0})


@api.delete("/devices/{did}")
async def delete_device(did: str, admin=Depends(super_admin)):
    if await db.sessions.count_documents({"device_id": did, "status": {"$in": OPEN}}):
        raise HTTPException(409, "O dispositivo tem uma sessão em curso. Termine-a primeiro.")
    r = await db.devices.delete_one({"id": did})
    if not r.deleted_count:
        raise HTTPException(404, "Dispositivo não encontrado")
    await audit(admin["id"], "device.delete", did)
    return {"ok": True}


# ---------- links ----------
@api.get("/links")
async def list_links(user=Depends(current_user)):
    q = {} if user["role"] == "super_admin" else {"technician_id": user["id"]}
    links = await db.technicianLinks.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    names = {u["id"]: u["name"] for u in await db.users.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(500)}
    for l in links:
        l["technician_name"] = names.get(l["technician_id"], "—")
        l["expired"] = bool(l.get("expires_at") and l["expires_at"] < iso())
    return links


@api.post("/links")
async def create_link(body: LinkCreate, user=Depends(current_user)):
    tid = body.technician_id if (user["role"] == "super_admin" and body.technician_id) else user["id"]
    if not await db.users.find_one({"id": tid, "active": True}):
        raise HTTPException(404, "Técnico não encontrado")
    days = body.days if body.days is not None else (await get_settings())["default_link_days"]
    link = {"id": new_id(), "code": secrets.token_urlsafe(9).replace("-", "x").replace("_", "y"), "technician_id": tid,
            "created_at": iso(), "expires_at": iso(now() + timedelta(days=days)) if days else None,
            "revoked": False, "uses": 0, "last_used_at": None, "created_by": user["id"]}
    await db.technicianLinks.insert_one(dict(link))
    await audit(user["id"], "link.create", link["id"], {"technician_id": tid, "days": days})
    return link


@api.post("/links/{lid}/revoke")
async def revoke_link(lid: str, user=Depends(current_user)):
    q = {"id": lid} if user["role"] == "super_admin" else {"id": lid, "technician_id": user["id"]}
    r = await db.technicianLinks.update_one(q, {"$set": {"revoked": True, "revoked_at": iso()}})
    if not r.matched_count:
        raise HTTPException(404, "Link não encontrado")
    await audit(user["id"], "link.revoke", lid)
    return {"ok": True}


# ---------- public / devices auth ----------
@api.get("/public/config")
async def public_config(code: str = ""):
    s = await get_settings()
    urls = download_urls(s)
    out = {"downloads": urls, "available": {k: await asset_available(u) for k, u in urls.items()},
           "sound_enabled": s["sound_enabled"], "link": None}
    if code:
        link = await db.technicianLinks.find_one({"code": code}, {"_id": 0})
        valid = bool(link and not link.get("revoked") and (not link.get("expires_at") or link["expires_at"] > iso()))
        tech = await db.users.find_one({"id": link["technician_id"], "active": True}, {"_id": 0, "name": 1}) if valid else None
        out["link"] = {"valid": bool(tech), "technician_name": tech["name"] if tech else None}
    return out


@api.post("/device/register")
async def device_register(body: DeviceRegister, request: Request):
    rate_limit(f"devreg:{client_ip(request)}", 30, 300)
    d = await db.devices.find_one({"install_id": body.install_id}, {"_id": 0})
    if not d:
        d = {"id": new_id(), "install_id": body.install_id, "name": body.name or f"{body.os} ({body.platform})",
             "platform": body.platform, "os": body.os, "os_version": body.os_version, "first_seen": iso(),
             "last_seen": iso(), "online": False, "client_name": "", "last_technician_id": None, "last_technician_name": None}
        await db.devices.insert_one(dict(d))
        await audit(f"device:{d['id']}", "device.first_contact", d["id"], {"platform": body.platform})
    else:
        await db.devices.update_one({"id": d["id"]}, {"$set": {"os": body.os, "os_version": body.os_version, "last_seen": iso()}})
    return {"device_id": d["id"], "device_token": create_device_token(d["id"])}


@api.get("/ice-servers")
async def ice_servers(request: Request):
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if not (decode_token(token, "access") or decode_token(token, "device")):
        raise HTTPException(401, "Não autorizado")
    return {"iceServers": await get_ice_servers()}


# ---------- settings / audit ----------
@api.get("/settings")
async def read_settings(admin=Depends(super_admin)):
    s = await get_settings()
    return {**s, "downloads": download_urls(s)}


@api.put("/settings")
async def write_settings(body: SettingsIn, admin=Depends(super_admin)):
    await db.systemSettings.update_one({"id": "global"}, {"$set": body.model_dump()}, upsert=True)
    _last_cleanup["at"] = None
    await audit(admin["id"], "settings.update", "global")
    s = await get_settings()
    return {**s, "downloads": download_urls(s)}


@api.get("/audit")
async def read_audit(limit: int = 200, admin=Depends(super_admin)):
    logs = await db.auditLogs.find({}, {"_id": 0}).sort("at", -1).to_list(min(limit, 1000))
    names = {u["id"]: u["name"] for u in await db.users.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    return [{**l, "actor_name": names.get(l["actor"], l["actor"])} for l in logs]


@api.get("/health")
async def health():
    return {"ok": True, "time": iso()}


# ---------- startup ----------
@fastapi_app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.devices.create_index("id", unique=True)
    await db.devices.create_index("install_id", unique=True)
    await db.sessions.create_index("id", unique=True)
    await db.sessions.create_index([("technician_id", 1), ("status", 1)])
    await db.sessions.create_index([("device_id", 1), ("status", 1)])
    await db.supportRequests.create_index("session_id")
    await db.technicianLinks.create_index("code", unique=True)
    await db.auditLogs.create_index("at")
    await db.refresh_tokens.create_index("token_hash", unique=True)
    await db.password_resets.create_index("token_hash", unique=True)
    await db.devices.update_many({}, {"$set": {"online": False}})
    await get_settings()
    email, pw = os.environ.get("SUPER_ADMIN_EMAIL", "").lower(), os.environ.get("SUPER_ADMIN_PASSWORD", "")
    if email and pw:
        u = await db.users.find_one({"email": email}, {"_id": 0})
        if not u:
            await db.users.insert_one({"id": new_id(), "name": "Super Admin", "email": email, "password_hash": hash_pw(pw),
                                       "role": "super_admin", "active": True, "permissions": DEFAULT_PERMS, "seed_pw_sha": sha(pw),
                                       "created_at": iso(), "last_login": None})
            log.info("super admin created")
        else:
            # Env password applies only when the env value itself changes; CRM password changes are kept otherwise.
            upd = {"role": "super_admin", "active": True}
            if u.get("seed_pw_sha") != sha(pw):
                upd.update({"password_hash": hash_pw(pw), "seed_pw_sha": sha(pw)})
            await db.users.update_one({"email": email}, {"$set": upd})
    else:
        log.warning("SUPER_ADMIN_PASSWORD not set: super admin not seeded")


@fastapi_app.on_event("shutdown")
async def shutdown():
    client.close()


fastapi_app.include_router(api)
fastapi_app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
                           allow_methods=["*"], allow_headers=["*"])

app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app, socketio_path="api/socket.io")
