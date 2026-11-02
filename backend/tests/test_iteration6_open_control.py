# Iteration 6: POST /sessions/{sid}/open auto-activation, consent_control on support:request, remote:command relay
import time
import requests
import socketio
import pytest
from conftest import API, BASE_URL, register_device


def _dev_client(dev, events):
    c = socketio.Client(reconnection=False)
    c.on("*", lambda ev, data=None: events.append((ev, data)))
    c.connect(BASE_URL, socketio_path="/api/socket.io", auth={"token": dev["device_token"], "kind": "device"},
              transports=["polling"], wait_timeout=15)
    return c


def _user_client(token, events=None):
    c = socketio.Client(reconnection=False)
    if events is not None:
        c.on("*", lambda ev, data=None: events.append((ev, data)))
    c.connect(BASE_URL, socketio_path="/api/socket.io", auth={"token": token, "kind": "user"},
              transports=["polling"], wait_timeout=15)
    return c


def _new_session(platform="android", payload=None):
    dev = register_device(name=f"TEST_it6_{platform}", platform=platform)
    ev = []
    c = _dev_client(dev, ev)
    ack = c.call("support:request", payload or {"consent_screen": True, "consent_control": True}, timeout=10)
    assert ack["ok"] is True, ack
    return dev, c, ev, ack


# --- Open endpoint ---
class TestOpenSession:
    def test_open_pending_activates(self, admin):
        dev, c, ev, ack = _new_session()
        sid = ack["session"]["id"]
        try:
            assert ack["session"]["consent"]["control"] is True
            r = admin.post(f"{API}/sessions/{sid}/open", timeout=20)
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["status"] == "active" and d["technician_id"] == admin.user["id"] and d["started_at"]
            time.sleep(1.5)
            names = [e[0] for e in ev]
            assert "session:started" in names, names
            g = admin.get(f"{API}/sessions/{sid}", timeout=20).json()
            assert g["status"] == "active" and g["consent"]["control"] is True
            # idempotent on active
            started = g["started_at"]
            r2 = admin.post(f"{API}/sessions/{sid}/open", timeout=20)
            assert r2.status_code == 200 and r2.json()["status"] == "active" and r2.json()["started_at"] == started
            # ended -> 400
            admin.post(f"{API}/sessions/{sid}/end", timeout=20)
            r3 = admin.post(f"{API}/sessions/{sid}/open", timeout=20)
            assert r3.status_code == 400, r3.text
        finally:
            admin.post(f"{API}/sessions/{sid}/end", timeout=20)
            c.disconnect()

    def test_open_assigned_activates(self, admin, t1):
        dev, c, ev, ack = _new_session()
        sid = ack["session"]["id"]
        try:
            r = admin.post(f"{API}/sessions/{sid}/assign", json={"technician_id": t1.user["id"]}, timeout=20)
            assert r.status_code == 200 and r.json()["status"] == "assigned", r.text
            r = t1.post(f"{API}/sessions/{sid}/open", timeout=20)
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "active" and r.json()["technician_id"] == t1.user["id"]
        finally:
            admin.post(f"{API}/sessions/{sid}/end", timeout=20)
            c.disconnect()

    def test_open_out_of_scope_404(self, admin, t2):
        dev, c, ev, ack = _new_session()
        sid = ack["session"]["id"]
        try:
            r = t2.post(f"{API}/sessions/{sid}/open", timeout=20)
            assert r.status_code == 404, r.text
            g = admin.get(f"{API}/sessions/{sid}", timeout=20).json()
            assert g["status"] == "pending"
        finally:
            admin.post(f"{API}/sessions/{sid}/end", timeout=20)
            c.disconnect()

    def test_open_requires_auth(self):
        r = requests.post(f"{API}/sessions/nonexistent/open", timeout=20)
        assert r.status_code in (401, 403)


# --- consent_control on support:request ---
class TestConsentControl:
    def test_browser_never_control(self, admin):
        dev, c, ev, ack = _new_session(platform="browser")
        sid = ack["session"]["id"]
        try:
            assert ack["session"]["consent"]["control"] is False
        finally:
            admin.post(f"{API}/sessions/{sid}/end", timeout=20)
            c.disconnect()

    def test_resumed_updates_control(self, admin):
        dev, c, ev, ack = _new_session(payload={"consent_screen": True, "consent_control": False})
        sid = ack["session"]["id"]
        try:
            assert ack["session"]["consent"]["control"] is False
            ack2 = c.call("support:request", {"consent_screen": True, "consent_control": True}, timeout=10)
            assert ack2["ok"] and ack2["resumed"] is True and ack2["session"]["id"] == sid
            assert ack2["session"]["consent"]["control"] is True
            g = admin.get(f"{API}/sessions/{sid}", timeout=20).json()
            assert g["consent"]["control"] is True
        finally:
            admin.post(f"{API}/sessions/{sid}/end", timeout=20)
            c.disconnect()


# --- remote:command relay ---
def test_remote_command_relay(admin):
    dev, c, ev, ack = _new_session()
    sid = ack["session"]["id"]
    u = _user_client(admin.token)
    try:
        # before open: invalid
        r0 = u.call("remote:command", {"session_id": sid, "command": {"type": "tap", "x": 0.5, "y": 0.5}}, timeout=10)
        assert r0["ok"] is False
        assert admin.post(f"{API}/sessions/{sid}/open", timeout=20).status_code == 200
        r = u.call("remote:command", {"session_id": sid, "command": {"type": "tap", "x": 0.5, "y": 0.5}}, timeout=10)
        assert r["ok"] is True, r
        r2 = u.call("remote:command", {"session_id": sid, "command": {"type": "rm_rf"}}, timeout=10)
        assert r2["ok"] is False
        time.sleep(1.5)
        cmds = [d for e, d in ev if e == "remote:command"]
        assert cmds and cmds[0]["command"]["type"] == "tap" and cmds[0]["session_id"] == sid
        assert len(cmds) == 1
    finally:
        admin.post(f"{API}/sessions/{sid}/end", timeout=20)
        u.disconnect()
        c.disconnect()


# --- Link-targeted technician: mimics useViewer (session:join BEFORE /open, no re-join after) ---
def test_targeted_tech_receives_offer_after_open(admin, t1):
    link = t1.post(f"{API}/links", json={"days": 1}, timeout=20).json()
    dev, c, ev, ack = _new_session(payload={"consent_screen": True, "consent_control": True, "link_code": link["code"]})
    sid = ack["session"]["id"]
    tev = []
    u = _user_client(t1.token, tev)
    try:
        assert ack["session"]["target_technician_id"] == t1.user["id"]
        j = u.call("session:join", {"session_id": sid}, timeout=10)
        print("join before open:", j)
        assert t1.post(f"{API}/sessions/{sid}/open", timeout=20).status_code == 200
        ro = u.call("webrtc:request-offer", {"session_id": sid}, timeout=10)
        assert ro["ok"] is True, ro
        time.sleep(1)
        assert any(e == "webrtc:request-offer" for e, _ in ev)
        c.call("webrtc:offer", {"session_id": sid, "sdp": {"type": "offer", "sdp": "x"}}, timeout=10)
        time.sleep(1.5)
        assert any(e == "webrtc:offer" for e, _ in tev), f"tech never got webrtc:offer; events={[e for e,_ in tev]}"
    finally:
        admin.post(f"{API}/sessions/{sid}/end", timeout=20)
        t1.post(f"{API}/links/{link['id']}/revoke", timeout=20)
        u.disconnect()
        c.disconnect()
