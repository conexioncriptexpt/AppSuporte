# Realtime (Socket.IO) tests: support request, assign, accept, chat, privacy, security, transfer, end, resume
import time
import requests
import socketio
import pytest
from conftest import API, BASE_URL, register_device

TRANSPORTS = ["polling"]


def connect(token, kind=None):
    c = socketio.Client(reconnection=False)
    events = []
    c.on("*", lambda ev, data=None: events.append((ev, data)))
    c.events = events
    auth = {"token": token}
    if kind:
        auth["kind"] = kind
    c.connect(BASE_URL, socketio_path="/api/socket.io", auth=auth, transports=TRANSPORTS, wait_timeout=15)
    return c


def got(c, ev, timeout=6, pred=lambda d: True):
    end = time.time() + timeout
    while time.time() < end:
        for e, d in c.events:
            if e == ev and pred(d):
                return d
        time.sleep(0.2)
    return None


@pytest.fixture(scope="module")
def flow(admin, t1, t2):
    dev = register_device()
    link = t1.post(f"{API}/links", json={"days": 1}).json()
    a = connect(admin.token)
    u1 = connect(t1.token)
    u2 = connect(t2.token)
    d = connect(dev["device_token"], "device")
    ctx = {"dev": dev, "link": link, "a": a, "u1": u1, "u2": u2, "d": d}
    yield ctx
    for k in ("a", "u1", "u2", "d"):
        try:
            ctx[k].disconnect()
        except Exception:
            pass
    sid = ctx.get("sid")
    if sid:
        admin.post(f"{API}/sessions/{sid}/end")
    t1.post(f"{API}/links/{link['id']}/revoke")
    admin.delete(f"{API}/devices/{dev['device_id']}")


def test_bad_device_token_refused():
    with pytest.raises(Exception):
        connect("garbage", "device")


def test_full_flow(flow, admin, t1, t2):
    d, a, u1, u2 = flow["d"], flow["a"], flow["u1"], flow["u2"]
    ack = d.call("support:request", {"link_code": flow["link"]["code"], "consent_screen": True, "client_name": "TEST_Cliente"}, timeout=10)
    assert ack["ok"], ack
    sid = ack["session"]["id"]
    flow["sid"] = sid
    assert ack["session"]["target_technician_id"] == t1.user["id"]
    assert got(a, "support:request", pred=lambda x: x["session_id"] == sid), "admin did not receive support:request"
    assert got(u1, "support:request", pred=lambda x: x["session_id"] == sid), "target tech did not receive support:request"
    q = admin.get(f"{API}/sessions").json()
    assert any(s["id"] == sid and s["status"] == "pending" for s in q)

    # device online
    dv = admin.get(f"{API}/devices/{flow['dev']['device_id']}").json()
    assert dv["online"] is True

    # assign to t1
    r = admin.post(f"{API}/sessions/{sid}/assign", json={"technician_id": t1.user["id"]})
    assert r.status_code == 200 and r.json()["status"] == "assigned"
    assert got(d, "support:assigned"), "device didn't get support:assigned"

    # tech2 security
    assert t2.get(f"{API}/sessions/{sid}").status_code == 404
    j = u2.call("session:join", {"session_id": sid}, timeout=10)
    assert j["ok"] is False
    assert u2.call("support:accepted", {"session_id": sid}, timeout=10)["ok"] is False

    # t1 joins & accepts
    assert u1.call("session:join", {"session_id": sid}, timeout=10)["ok"]
    assert u1.call("support:accepted", {"session_id": sid}, timeout=10)["ok"]
    assert got(d, "session:started")
    s = t1.get(f"{API}/sessions/{sid}").json()
    assert s["status"] == "active" and s["started_at"]

    # chat both ways
    assert d.call("chat:message", {"session_id": sid, "text": "TEST_ola do cliente"}, timeout=10)["ok"]
    assert got(u1, "chat:message", pred=lambda m: m["text"] == "TEST_ola do cliente")
    assert u1.call("chat:message", {"session_id": sid, "text": "TEST_ola do tecnico"}, timeout=10)["ok"]
    assert got(d, "chat:message", pred=lambda m: m["text"] == "TEST_ola do tecnico")
    assert u2.call("chat:message", {"session_id": sid, "text": "intruder"}, timeout=10)["ok"] is False

    # privacy
    assert u1.call("privacy:enable", {"session_id": sid}, timeout=10)["ok"]
    assert got(d, "privacy:enabled")
    assert d.call("privacy:disable", {"session_id": sid}, timeout=10)["ok"]
    assert got(u1, "privacy:disabled", pred=lambda x: x.get("by") == "device")
    assert u2.call("privacy:enable", {"session_id": sid}, timeout=10)["ok"] is False

    # remote control: consent false -> refused
    r = u1.call("remote:command", {"session_id": sid, "command": {"type": "tap", "x": 1, "y": 1}}, timeout=10)
    assert r["ok"] is False and "autorizou" in r["error"]
    r = u2.call("remote:command", {"session_id": sid, "command": {"type": "tap"}}, timeout=10)
    assert r["ok"] is False
    # consent true -> allowed, then remove permission -> refused
    assert d.call("consent:update", {"session_id": sid, "control": True}, timeout=10)["ok"]
    r = u1.call("remote:command", {"session_id": sid, "command": {"type": "tap", "x": 1, "y": 1}}, timeout=10)
    assert r["ok"] is True, r
    assert got(d, "remote:command")
    r = u1.call("remote:command", {"session_id": sid, "command": {"type": "rm -rf"}}, timeout=10)
    assert r["ok"] is False
    perms = t1.user.get("permissions") or {"control": True, "privacy": True, "accessibility": True}
    admin.patch(f"{API}/users/{t1.user['id']}", json={"permissions": {**perms, "control": False}})
    try:
        r = u1.call("remote:command", {"session_id": sid, "command": {"type": "tap"}}, timeout=10)
        assert r["ok"] is False and "permissão" in r["error"]
    finally:
        admin.patch(f"{API}/users/{t1.user['id']}", json={"permissions": {**perms, "control": True}})

    # device delete refused while open
    assert admin.delete(f"{API}/devices/{flow['dev']['device_id']}").status_code == 409

    # reconnection resumes
    d.disconnect()
    time.sleep(1.5)
    assert admin.get(f"{API}/devices/{flow['dev']['device_id']}").json()["online"] is False
    d2 = connect(flow["dev"]["device_token"], "device")
    flow["d"] = d2
    ack = d2.call("support:request", {"link_code": flow["link"]["code"], "consent_screen": True}, timeout=10)
    assert ack["ok"] and ack.get("resumed") is True and ack["session"]["id"] == sid

    # transfer to t2 (by t1)
    r = t1.post(f"{API}/sessions/{sid}/transfer", json={"technician_id": t2.user["id"]})
    assert r.status_code == 200 and r.json()["technician_id"] == t2.user["id"] and r.json()["status"] == "active"
    assert got(u1, "session:transferred")
    assert t1.get(f"{API}/sessions/{sid}").status_code == 404
    assert t2.get(f"{API}/sessions/{sid}").status_code == 200
    assert u2.call("session:join", {"session_id": sid}, timeout=10)["ok"]

    # end by device
    assert d2.call("session:end", {"session_id": sid}, timeout=10)["ok"]
    assert got(u2, "session:ended")
    hist = admin.get(f"{API}/sessions", params={"scope": "history"}).json()
    h = next(x for x in hist if x["id"] == sid)
    assert h["status"] == "ended" and h["ended_at"] and h["duration_s"] >= 0
    assert any(x["id"] == sid for x in t2.get(f"{API}/sessions", params={"scope": "history"}).json())
    # chat after end refused
    assert d2.call("chat:message", {"session_id": sid, "text": "late"}, timeout=10)["ok"] is False
    # device delete now allowed (fixture cleans)
    full = admin.get(f"{API}/sessions/{sid}").json()
    assert len(full["messages"]) >= 2 and len(full["operations"]) >= 5


def test_old_tech_removed_from_room_after_transfer(admin, t1, t2):
    """After transfer t1 -> t2, t1's socket must no longer receive session chat."""
    dev = register_device()
    d = connect(dev["device_token"], "device")
    u1 = connect(t1.token)
    sid = None
    try:
        sid = d.call("support:request", {"consent_screen": True}, timeout=10)["session"]["id"]
        admin.post(f"{API}/sessions/{sid}/assign", json={"technician_id": t1.user["id"]})
        assert u1.call("support:accepted", {"session_id": sid}, timeout=10)["ok"]
        assert t1.post(f"{API}/sessions/{sid}/transfer", json={"technician_id": t2.user["id"]}).status_code == 200
        u1.events.clear()
        d.call("chat:message", {"session_id": sid, "text": "TEST_secret_after_transfer"}, timeout=10)
        leaked = got(u1, "chat:message", timeout=3, pred=lambda m: m["text"] == "TEST_secret_after_transfer")
        assert leaked is None, "previous technician still receives session chat after transfer (still in session room)"
    finally:
        if sid:
            admin.post(f"{API}/sessions/{sid}/end")
        d.disconnect(); u1.disconnect()
        admin.delete(f"{API}/devices/{dev['device_id']}")
