import inspect
import socketio

from core import db, decode_token, iso, now, new_id, audit, log, rate_limit, PUBLIC_USER

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", ping_interval=15, ping_timeout=30,
                           max_http_buffer_size=8_000_000)

SIDS = {}            # sid -> {"kind": "user"|"device", "id", "role"}
ONLINE_USERS = {}    # user_id -> set(sid)
ONLINE_DEVICES = {}  # device_id -> set(sid)
OPEN = ["pending", "assigned", "active"]
SENSITIVE_HINTS = ("password", "palavra", "senha", "pin", "cvv", "iban", "cartao", "cartão", "card")


async def _room(fn, sid, room):
    r = fn(sid, room)
    if inspect.isawaitable(r):
        await r


async def evict_user(user_id: str, session_id: str):
    """Remove a technician's sockets from a session room (after transfer)."""
    for sid in list(ONLINE_USERS.get(user_id, set())):
        if SIDS.get(sid, {}).get("role") != "super_admin":
            await _room(sio.leave_room, sid, f"session:{session_id}")


async def broadcast_queue(session: dict = None):
    """Tell CRM clients that queue/sessions changed."""
    data = {"session_id": session["id"] if session else None, "status": session.get("status") if session else None}
    await sio.emit("queue:changed", data, room="admin:global")
    if session:
        for tid in {session.get("technician_id"), session.get("target_technician_id")}:
            if tid:
                await sio.emit("queue:changed", data, room=f"technician:{tid}")


async def add_op(session_id: str, actor: str, text: str):
    op = {"at": iso(), "actor": actor, "text": text}
    await db.sessions.update_one({"id": session_id}, {"$push": {"operations": {"$each": [op], "$slice": -500}}})
    await sio.emit("session:op", {"session_id": session_id, **op}, room=f"session:{session_id}")


async def end_session(session_id: str, by: str):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0, "operations": 0, "messages": 0})
    if not s or s["status"] == "ended":
        return s
    ended = now()
    started = s.get("started_at")
    duration = 0
    if started:
        from datetime import datetime
        duration = int((ended - datetime.fromisoformat(started)).total_seconds())
    await db.sessions.update_one({"id": session_id}, {"$set": {
        "status": "ended", "ended_at": iso(ended), "duration_s": duration, "ended_by": by, "privacy": False,
        "connection_state": "terminada"}})
    await db.supportRequests.update_one({"session_id": session_id}, {"$set": {"status": "closed", "closed_at": iso(ended)}})
    await add_op(session_id, by, "Sessão terminada")
    payload = {"session_id": session_id, "by": by}
    await sio.emit("session:ended", payload, room=[f"session:{session_id}", f"device:{s['device_id']}"])
    s["status"] = "ended"
    await broadcast_queue(s)
    await audit(by, "session.end", session_id)
    return s


def technician_state(user_id: str, busy_ids: set) -> str:
    if user_id in busy_ids:
        return "ocupado"
    return "disponivel" if ONLINE_USERS.get(user_id) else "offline"


async def busy_technicians() -> set:
    return set(await db.sessions.distinct("technician_id", {"status": "active"}))


async def _access(sid: str, session_id: str):
    info = SIDS.get(sid)
    if not info or not session_id:
        return None, None
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0, "operations": 0, "messages": 0})
    if not s:
        return info, None
    if info["kind"] == "device":
        ok = s["device_id"] == info["id"]
    else:
        ok = info["role"] == "super_admin" or s.get("technician_id") == info["id"]
    return info, (s if ok else None)


async def _user_doc(info):
    return await db.users.find_one({"id": info["id"]}, PUBLIC_USER)


@sio.event
async def connect(sid, environ, auth):
    auth = auth or {}
    token = auth.get("token", "")
    if auth.get("kind") == "device":
        data = decode_token(token, "device")
        if not data or not await db.devices.find_one({"id": data["sub"]}):
            raise socketio.exceptions.ConnectionRefusedError("unauthorized")
        did = data["sub"]
        SIDS[sid] = {"kind": "device", "id": did, "role": "device"}
        ONLINE_DEVICES.setdefault(did, set()).add(sid)
        await _room(sio.enter_room, sid, f"device:{did}")
        await db.devices.update_one({"id": did}, {"$set": {"online": True, "last_seen": iso()}})
        await sio.emit("device:online", {"device_id": did}, room="admin:global")
        return True
    data = decode_token(token, "access")
    user = await db.users.find_one({"id": data["sub"]}, PUBLIC_USER) if data else None
    if not user or not user.get("active"):
        raise socketio.exceptions.ConnectionRefusedError("unauthorized")
    SIDS[sid] = {"kind": "user", "id": user["id"], "role": user["role"]}
    ONLINE_USERS.setdefault(user["id"], set()).add(sid)
    await _room(sio.enter_room, sid, f"technician:{user['id']}")
    if user["role"] == "super_admin":
        await _room(sio.enter_room, sid, "admin:global")
    await sio.emit("technicians:changed", {}, room="admin:global")
    return True


@sio.event
async def disconnect(sid, *args):
    info = SIDS.pop(sid, None)
    if not info:
        return
    if info["kind"] == "device":
        sids = ONLINE_DEVICES.get(info["id"], set())
        sids.discard(sid)
        if not sids:
            ONLINE_DEVICES.pop(info["id"], None)
            await db.devices.update_one({"id": info["id"]}, {"$set": {"online": False, "last_seen": iso()}})
            await sio.emit("device:offline", {"device_id": info["id"]}, room="admin:global")
            async for s in db.sessions.find({"device_id": info["id"], "status": "active"}, {"_id": 0, "id": 1}):
                await db.sessions.update_one({"id": s["id"]}, {"$set": {"connection_state": "desligado"}})
                await sio.emit("session:status", {"session_id": s["id"], "connection_state": "desligado"},
                               room=f"session:{s['id']}")
    else:
        sids = ONLINE_USERS.get(info["id"], set())
        sids.discard(sid)
        if not sids:
            ONLINE_USERS.pop(info["id"], None)
        await sio.emit("technicians:changed", {}, room="admin:global")


@sio.on("device:register")
async def device_register(sid, data):
    info = SIDS.get(sid)
    if not info or info["kind"] != "device":
        return {"ok": False}
    allowed = {k: str(v)[:80] for k, v in (data or {}).items() if k in ("os_version", "screen", "app_version")}
    if allowed:
        await db.devices.update_one({"id": info["id"]}, {"$set": allowed})
    return {"ok": True, "device_id": info["id"]}


@sio.on("support:request")
async def support_request(sid, data):
    info = SIDS.get(sid)
    if not info or info["kind"] != "device":
        return {"ok": False, "error": "Não autorizado"}
    data = data or {}
    try:
        rate_limit(f"req:{info['id']}", 10, 60)
    except Exception:
        return {"ok": False, "error": "Demasiados pedidos"}
    did = info["id"]
    existing = await db.sessions.find_one({"device_id": did, "status": {"$in": OPEN}},
                                          {"_id": 0, "operations": 0, "messages": 0})
    if existing:
        await _room(sio.enter_room, sid, f"session:{existing['id']}")
        if data.get("consent_screen"):
            await db.sessions.update_one({"id": existing["id"]}, {"$set": {"consent.screen": True, "connection_state": "ligado"}})
        await sio.emit("session:status", {"session_id": existing["id"], "connection_state": "ligado", "reconnected": True},
                       room=f"session:{existing['id']}")
        return {"ok": True, "session": existing, "resumed": True}
    device = await db.devices.find_one({"id": did}, {"_id": 0})
    target, link_id = None, None
    code = (data.get("link_code") or "").strip()
    if code:
        link = await db.technicianLinks.find_one({"code": code}, {"_id": 0})
        if link and not link.get("revoked") and (not link.get("expires_at") or link["expires_at"] > iso()):
            tech = await db.users.find_one({"id": link["technician_id"], "active": True}, {"_id": 0, "id": 1})
            if tech:
                target, link_id = tech["id"], link["id"]
                await db.technicianLinks.update_one({"id": link_id}, {"$inc": {"uses": 1}, "$set": {"last_used_at": iso()}})
    client_name = str(data.get("client_name") or "")[:60]
    sess_id, req_id = new_id(), new_id()
    session = {
        "id": sess_id, "request_id": req_id, "device_id": did, "device_name": device.get("name"),
        "device_os": device.get("os"), "platform": device.get("platform"), "client_name": client_name,
        "technician_id": None, "technician_name": None, "target_technician_id": target, "link_id": link_id,
        "status": "pending", "created_at": iso(), "assigned_at": None, "started_at": None, "ended_at": None,
        "duration_s": 0, "privacy": False, "connection_state": "ligado", "resolution": data.get("screen") or "",
        "quality": {}, "consent": {"screen": bool(data.get("consent_screen")), "screen_at": iso() if data.get("consent_screen") else None,
                                   "control": False, "control_at": None},
        "operations": [{"at": iso(), "actor": "cliente", "text": "Pedido de assistência criado"}], "messages": [],
    }
    await db.sessions.insert_one(dict(session))
    await db.supportRequests.insert_one({"id": req_id, "session_id": sess_id, "device_id": did, "link_id": link_id,
                                         "target_technician_id": target, "client_name": client_name,
                                         "status": "pending", "created_at": iso()})
    if client_name:
        await db.devices.update_one({"id": did}, {"$set": {"client_name": client_name}})
    await _room(sio.enter_room, sid, f"session:{sess_id}")
    await audit(f"device:{did}", "support.request", sess_id, {"link": bool(link_id), "consent_screen": session["consent"]["screen"]})
    alert = {"session_id": sess_id, "device_name": device.get("name"), "platform": device.get("platform"), "client_name": client_name}
    await sio.emit("support:request", alert, room="admin:global")
    if target:
        await sio.emit("support:request", alert, room=f"technician:{target}")
    await broadcast_queue(session)
    session.pop("operations"), session.pop("messages")
    return {"ok": True, "session": session}


@sio.on("session:join")
async def session_join(sid, data):
    info, s = await _access(sid, (data or {}).get("session_id"))
    if not s:
        return {"ok": False, "error": "Sem acesso a esta sessão"}
    await _room(sio.enter_room, sid, f"session:{s['id']}")
    return {"ok": True, "session": s}


@sio.on("support:accepted")
async def support_accepted(sid, data):
    info, s = await _access(sid, (data or {}).get("session_id"))
    if not s or info["kind"] != "user" or s.get("technician_id") != info["id"]:
        return {"ok": False, "error": "Sessão não atribuída a si"}
    if s["status"] == "assigned":
        await db.sessions.update_one({"id": s["id"]}, {"$set": {"status": "active", "started_at": iso()}})
        await db.supportRequests.update_one({"session_id": s["id"]}, {"$set": {"status": "accepted"}})
        await add_op(s["id"], s.get("technician_name") or "técnico", "Técnico aceitou o atendimento")
        await audit(info["id"], "session.accept", s["id"])
    elif s["status"] != "active":
        return {"ok": False, "error": "Sessão não disponível"}
    await _room(sio.enter_room, sid, f"session:{s['id']}")
    payload = {"session_id": s["id"], "technician_name": s.get("technician_name")}
    await sio.emit("session:started", payload, room=[f"session:{s['id']}", f"device:{s['device_id']}"])
    s["status"] = "active"
    await broadcast_queue(s)
    return {"ok": True}


@sio.on("support:rejected")
async def support_rejected(sid, data):
    info, s = await _access(sid, (data or {}).get("session_id"))
    if not s or info["kind"] != "user" or s.get("technician_id") != info["id"] or s["status"] != "assigned":
        return {"ok": False, "error": "Operação inválida"}
    await db.sessions.update_one({"id": s["id"]}, {"$set": {"status": "pending", "technician_id": None, "technician_name": None}})
    await db.supportRequests.update_one({"session_id": s["id"]}, {"$set": {"status": "pending"}})
    await add_op(s["id"], s.get("technician_name") or "técnico", "Técnico rejeitou o atendimento")
    await audit(info["id"], "session.reject", s["id"])
    await sio.emit("support:rejected", {"session_id": s["id"]}, room=f"device:{s['device_id']}")
    await broadcast_queue(s)
    return {"ok": True}


async def _relay(sid, event, data, require_active=True):
    data = data or {}
    info, s = await _access(sid, data.get("session_id"))
    if not s or (require_active and s["status"] != "active"):
        return {"ok": False, "error": "Sessão inválida"}
    data["from"] = info["kind"]
    await sio.emit(event, data, room=f"session:{s['id']}", skip_sid=sid)
    return {"ok": True}


@sio.on("webrtc:offer")
async def webrtc_offer(sid, data):
    return await _relay(sid, "webrtc:offer", data)


@sio.on("webrtc:answer")
async def webrtc_answer(sid, data):
    return await _relay(sid, "webrtc:answer", data)


@sio.on("webrtc:ice-candidate")
async def webrtc_ice(sid, data):
    return await _relay(sid, "webrtc:ice-candidate", data)


@sio.on("webrtc:request-offer")
async def webrtc_request_offer(sid, data):
    return await _relay(sid, "webrtc:request-offer", data)


@sio.on("remote:command")
async def remote_command(sid, data):
    data = data or {}
    info, s = await _access(sid, data.get("session_id"))
    if not s or info["kind"] != "user" or s["status"] != "active":
        return {"ok": False, "error": "Sessão inválida"}
    user = await _user_doc(info)
    if not user or not user.get("permissions", {}).get("control"):
        return {"ok": False, "error": "Sem permissão de controlo"}
    if not s.get("consent", {}).get("control"):
        return {"ok": False, "error": "O cliente não autorizou o controlo"}
    cmd = data.get("command") or {}
    ctype = str(cmd.get("type", ""))[:30]
    if ctype not in ("tap", "click", "move", "swipe", "scroll", "text", "key", "back", "home", "recents", "shortcut", "double_click", "right_click"):
        return {"ok": False, "error": "Comando não permitido"}
    await sio.emit("remote:command", {"session_id": s["id"], "command": cmd}, room=f"device:{s['device_id']}")
    if ctype not in ("move",):
        desc = f"Comando: {ctype}" + (f" ({len(str(cmd.get('text', '')))} caracteres)" if ctype == "text" else "")
        await add_op(s["id"], user["name"], desc)
    return {"ok": True}


@sio.on("accessibility:request")
async def accessibility_request(sid, data):
    data = data or {}
    info, s = await _access(sid, data.get("session_id"))
    if not s or info["kind"] != "user" or s["status"] != "active":
        return {"ok": False}
    user = await _user_doc(info)
    if not user.get("permissions", {}).get("accessibility"):
        return {"ok": False, "error": "Sem permissão de acessibilidade"}
    await sio.emit("accessibility:request", {"session_id": s["id"]}, room=f"device:{s['device_id']}")
    await add_op(s["id"], user["name"], "Pedido de leitura de acessibilidade")
    return {"ok": True}


@sio.on("accessibility:tree")
async def accessibility_tree(sid, data):
    return await _relay(sid, "accessibility:tree", data)


@sio.on("privacy:enable")
async def privacy_enable(sid, data):
    info, s = await _access(sid, (data or {}).get("session_id"))
    if not s or info["kind"] != "user" or s["status"] != "active":
        return {"ok": False, "error": "Sessão inválida"}
    user = await _user_doc(info)
    if not user.get("permissions", {}).get("privacy"):
        return {"ok": False, "error": "Sem permissão para modo de privacidade"}
    await db.sessions.update_one({"id": s["id"]}, {"$set": {"privacy": True}})
    await sio.emit("privacy:enabled", {"session_id": s["id"]}, room=[f"session:{s['id']}", f"device:{s['device_id']}"])
    await add_op(s["id"], user["name"], "Modo de privacidade ativado")
    return {"ok": True}


@sio.on("privacy:disable")
async def privacy_disable(sid, data):
    info, s = await _access(sid, (data or {}).get("session_id"))
    if not s:
        return {"ok": False}
    await db.sessions.update_one({"id": s["id"]}, {"$set": {"privacy": False}})
    await sio.emit("privacy:disabled", {"session_id": s["id"], "by": info["kind"]}, room=[f"session:{s['id']}", f"device:{s['device_id']}"])
    await add_op(s["id"], "cliente" if info["kind"] == "device" else "técnico", "Modo de privacidade desativado")
    return {"ok": True}


@sio.on("privacy:request-disable")
async def privacy_request_disable(sid, data):
    info, s = await _access(sid, (data or {}).get("session_id"))
    if not s or info["kind"] != "user":
        return {"ok": False}
    await sio.emit("privacy:request-disable", {"session_id": s["id"]}, room=f"device:{s['device_id']}")
    await add_op(s["id"], "técnico", "Pedido ao cliente para desativar o modo de privacidade")
    return {"ok": True}


@sio.on("chat:message")
async def chat_message(sid, data):
    data = data or {}
    info, s = await _access(sid, data.get("session_id"))
    text = str(data.get("text") or "").strip()[:1000]
    if not s or not text or s["status"] == "ended":
        return {"ok": False}
    if info["kind"] == "device":
        author = s.get("client_name") or "Cliente"
    else:
        author = (await _user_doc(info))["name"]
    msg = {"id": new_id(), "at": iso(), "from": info["kind"], "author": author, "text": text}
    await db.sessions.update_one({"id": s["id"]}, {"$push": {"messages": {"$each": [msg], "$slice": -300}}})
    await sio.emit("chat:message", {"session_id": s["id"], **msg}, room=f"session:{s['id']}")
    return {"ok": True}


@sio.on("session:status")
async def session_status(sid, data):
    data = data or {}
    info, s = await _access(sid, data.get("session_id"))
    if not s:
        return {"ok": False}
    upd = {}
    if info["kind"] == "device":
        if data.get("resolution"):
            upd["resolution"] = str(data["resolution"])[:30]
        if data.get("connection_state"):
            upd["connection_state"] = str(data["connection_state"])[:30]
        if "screen_sharing" in data:
            upd["screen_sharing"] = bool(data["screen_sharing"])
    elif isinstance(data.get("quality"), dict):
        upd["quality"] = {k: data["quality"][k] for k in ("rtt", "fps", "kbps", "state") if k in data["quality"]}
    if upd:
        await db.sessions.update_one({"id": s["id"]}, {"$set": upd})
    await sio.emit("session:status", {"session_id": s["id"], **upd}, room=f"session:{s['id']}", skip_sid=sid)
    return {"ok": True}


@sio.on("consent:update")
async def consent_update(sid, data):
    data = data or {}
    info, s = await _access(sid, data.get("session_id"))
    if not s or info["kind"] != "device":
        return {"ok": False}
    if data.get("control") and s.get("platform") == "browser":
        return {"ok": False, "error": "O navegador não permite controlo remoto"}
    upd = {}
    for k in ("screen", "control"):
        if k in data:
            upd[f"consent.{k}"] = bool(data[k])
            upd[f"consent.{k}_at"] = iso()
    await db.sessions.update_one({"id": s["id"]}, {"$set": upd})
    await add_op(s["id"], "cliente", "Consentimento atualizado: " + ", ".join(f"{k}={'sim' if data[k] else 'não'}" for k in ("screen", "control") if k in data))
    await audit(f"device:{info['id']}", "consent.update", s["id"], {k: data[k] for k in ("screen", "control") if k in data})
    await sio.emit("session:status", {"session_id": s["id"], "consent": {k: bool(data[k]) for k in ("screen", "control") if k in data}},
                   room=f"session:{s['id']}")
    return {"ok": True}


@sio.on("session:end")
async def session_end(sid, data):
    info, s = await _access(sid, (data or {}).get("session_id"))
    if not s:
        return {"ok": False}
    by = f"device:{info['id']}" if info["kind"] == "device" else info["id"]
    await end_session(s["id"], by)
    return {"ok": True}
