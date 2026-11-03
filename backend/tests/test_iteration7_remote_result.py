# Iteration 7: remote:result relay (device -> technician), remote:command consent regression, /open regression
import time
import socketio
from conftest import API, BASE_URL, register_device

CREATED_DEVICES = []


def _client(token, kind, events):
    c = socketio.Client(reconnection=False)
    c.on("*", lambda ev, data=None: events.append((ev, data)))
    c.connect(BASE_URL, socketio_path="/api/socket.io", auth={"token": token, "kind": kind},
              transports=["polling"], wait_timeout=15)
    return c


def _session(control=True, platform="android"):
    dev = register_device(name=f"TEST_it7_{platform}", platform=platform)
    CREATED_DEVICES.append(dev["device_id"])
    ev = []
    c = _client(dev["device_token"], "device", ev)
    ack = c.call("support:request", {"consent_screen": True, "consent_control": control}, timeout=10)
    assert ack["ok"] is True, ack
    return dev, c, ev, ack["session"]


def _cleanup(admin, sid, *clients):
    admin.post(f"{API}/sessions/{sid}/end", timeout=20)
    for c in clients:
        try:
            c.disconnect()
        except Exception:
            pass


# --- remote:result ---
def test_remote_result_relayed_to_tech_and_truncated(admin):
    dev, c, ev, s = _session()
    sid = s["id"]
    uev = []
    u = _client(admin.token, "user", uev)
    try:
        assert admin.post(f"{API}/sessions/{sid}/open", timeout=20).status_code == 200
        j = u.call("session:join", {"session_id": sid}, timeout=10)
        assert j.get("ok") is not False, j
        r = c.call("remote:result", {"session_id": sid, "ok": False, "error": "X" * 500}, timeout=10)
        assert r["ok"] is True, r
        time.sleep(1.5)
        res = [d for e, d in uev if e == "remote:result"]
        assert res, [e for e, _ in uev]
        assert res[0]["session_id"] == sid and res[0]["ok"] is False
        assert len(res[0]["error"]) == 200
        assert res[0]["from"] == "device"
    finally:
        _cleanup(admin, sid, u, c)


def test_remote_result_when_not_active(admin):
    dev, c, ev, s = _session()
    sid = s["id"]
    uev = []
    u = _client(admin.token, "user", uev)
    try:
        u.call("session:join", {"session_id": sid}, timeout=10)  # super_admin may join pending
        r = c.call("remote:result", {"session_id": sid, "ok": False, "error": "TEST pend"}, timeout=10)
        assert r["ok"] is True, r
        time.sleep(1.5)
        assert any(e == "remote:result" and d.get("error") == "TEST pend" for e, d in uev), [e for e, _ in uev]
    finally:
        _cleanup(admin, sid, u, c)


def test_remote_result_from_user_rejected(admin):
    dev, c, ev, s = _session()
    sid = s["id"]
    u = _client(admin.token, "user", [])
    try:
        admin.post(f"{API}/sessions/{sid}/open", timeout=20)
        r = u.call("remote:result", {"session_id": sid, "ok": False, "error": "spoof"}, timeout=10)
        assert r["ok"] is False
        time.sleep(1)
        assert not any(e == "remote:result" for e, _ in ev)
    finally:
        _cleanup(admin, sid, u, c)


def test_remote_result_other_device_rejected(admin):
    dev, c, ev, s = _session()
    sid = s["id"]
    dev2 = register_device(name="TEST_it7_other", platform="android")
    CREATED_DEVICES.append(dev2["device_id"])
    c2 = _client(dev2["device_token"], "device", [])
    uev = []
    u = _client(admin.token, "user", uev)
    try:
        admin.post(f"{API}/sessions/{sid}/open", timeout=20)
        u.call("session:join", {"session_id": sid}, timeout=10)
        r = c2.call("remote:result", {"session_id": sid, "ok": False, "error": "x"}, timeout=10)
        assert r["ok"] is False
        time.sleep(1)
        assert not any(e == "remote:result" for e, _ in uev)
    finally:
        _cleanup(admin, s["id"], u, c, c2)


# --- remote:command regression ---
def test_remote_command_control_true_relays(admin):
    dev, c, ev, s = _session(control=True)
    sid = s["id"]
    u = _client(admin.token, "user", [])
    try:
        assert admin.post(f"{API}/sessions/{sid}/open", timeout=20).json()["status"] == "active"
        r = u.call("remote:command", {"session_id": sid, "command": {"type": "back"}}, timeout=10)
        assert r["ok"] is True, r
        time.sleep(1.5)
        cmds = [d for e, d in ev if e == "remote:command"]
        assert len(cmds) == 1 and cmds[0]["command"]["type"] == "back"
    finally:
        _cleanup(admin, sid, u, c)


def test_remote_command_control_false_refused(admin):
    dev, c, ev, s = _session(control=False)
    sid = s["id"]
    u = _client(admin.token, "user", [])
    try:
        assert s["consent"]["control"] is False
        assert admin.post(f"{API}/sessions/{sid}/open", timeout=20).json()["status"] == "active"
        r = u.call("remote:command", {"session_id": sid, "command": {"type": "back"}}, timeout=10)
        assert r["ok"] is False and r["error"] == "O cliente não autorizou o controlo", r
        time.sleep(1)
        assert not any(e == "remote:command" for e, _ in ev)
    finally:
        _cleanup(admin, sid, u, c)


def test_cleanup_devices(admin):
    for did in CREATED_DEVICES:
        r = admin.delete(f"{API}/devices/{did}", timeout=20)
        assert r.status_code in (200, 204, 404, 400), r.text
