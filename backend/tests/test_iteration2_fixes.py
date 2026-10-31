# Iteration 2 retests: links days=0, transfer eviction, XFF rate limit, reset lockout scope, atomic refresh, browser consent
import uuid
import time
import threading
import requests
import pytest
from conftest import API, PW, login, register_device
from test_realtime import connect, got


# ---- Links: days=0 => no expiry
def test_link_days_zero_persisted(t1):
    r = t1.post(f"{API}/links", json={"days": 0})
    assert r.status_code == 200, r.text
    link = r.json()
    assert link["expires_at"] is None
    lst = t1.get(f"{API}/links").json()
    assert any(l["id"] == link["id"] and l["expires_at"] is None for l in lst)
    pc = requests.get(f"{API}/public/config", params={"code": link["code"]}).json()
    assert pc["link"]["valid"] is True
    t1.post(f"{API}/links/{link['id']}/revoke")


def test_link_days_negative_rejected(t1):
    assert t1.post(f"{API}/links", json={"days": -1}).status_code == 422


# ---- temp users fixture
@pytest.fixture(scope="module")
def temp_users(admin):
    made = []

    def mk(pw="TmpPass#12345"):
        email = f"test_it2_{uuid.uuid4().hex[:6]}@cryptoconex-teste.pt"
        r = admin.post(f"{API}/users", json={"name": "TEST_It2", "email": email, "password": pw})
        assert r.status_code == 200, r.text
        made.append(r.json()["id"])
        return {"id": r.json()["id"], "email": email, "pw": pw}
    yield mk
    for uid in made:
        admin.delete(f"{API}/users/{uid}")


# ---- XFF spoofing no longer bypasses per IP+email limit (10/5min)
def test_xff_spoof_does_not_bypass_rate_limit(temp_users):
    u = temp_users()
    codes = []
    for i in range(11):
        r = requests.post(f"{API}/auth/login", json={"email": u["email"], "password": u["pw"]},
                          headers={"X-Forwarded-For": f"9.9.{i}.{i}"}, timeout=20)
        codes.append(r.status_code)
    print("codes", codes)
    assert codes[:10] == [200] * 10, codes
    assert codes[10] == 429, codes
    # other email from same IP still OK (per-IP limit is 60)
    u2 = temp_users()
    assert login(u2["email"], u2["pw"]).status_code == 200


# ---- /auth/reset clears only that user's lockout
def test_reset_only_clears_own_lockout(admin, temp_users):
    a, b = temp_users(), temp_users()
    for _ in range(5):
        login(b["email"], "wrongwrong")
    r = login(b["email"], b["pw"])
    assert r.status_code == 429 and "bloqueada" in r.json()["detail"]
    tok = admin.post(f"{API}/users/{a['id']}/reset-link").json()["token"]
    assert requests.post(f"{API}/auth/reset", json={"token": tok, "new_password": "ResetPass#123"}).json()["ok"]
    assert login(a["email"], "ResetPass#123").status_code == 200
    r = login(b["email"], b["pw"])
    assert r.status_code == 429 and "bloqueada" in r.json()["detail"], f"B lockout cleared by A's reset: {r.status_code}"


# ---- atomic refresh
def test_parallel_refresh_only_one_succeeds(temp_users):
    u = temp_users()
    rt = login(u["email"], u["pw"]).json()["refresh_token"]
    res = []
    barrier = threading.Barrier(2)

    def go():
        barrier.wait()
        res.append(requests.post(f"{API}/auth/refresh", json={"refresh_token": rt}, timeout=20))
    th = [threading.Thread(target=go) for _ in range(2)]
    [t.start() for t in th]
    [t.join() for t in th]
    codes = sorted(r.status_code for r in res)
    assert codes == [200, 401], codes
    winner = next(r for r in res if r.status_code == 200).json()["refresh_token"]
    # reuse detection revoked the family -> winner's new token is dead too
    assert requests.post(f"{API}/auth/refresh", json={"refresh_token": winner}).status_code == 401


# ---- transfer eviction: chat/op/webrtc no longer reach previous technician
def test_transfer_evicts_previous_tech(admin, t1, t2):
    dev = register_device(platform="android")
    d = connect(dev["device_token"], "device")
    u1 = connect(t1.token)
    u2 = connect(t2.token)
    sid = None
    try:
        sid = d.call("support:request", {"consent_screen": True}, timeout=10)["session"]["id"]
        admin.post(f"{API}/sessions/{sid}/assign", json={"technician_id": t1.user["id"]})
        assert u1.call("support:accepted", {"session_id": sid}, timeout=10)["ok"]
        assert t1.post(f"{API}/sessions/{sid}/transfer", json={"technician_id": t2.user["id"]}).status_code == 200
        assert got(u1, "session:transferred", pred=lambda x: x["session_id"] == sid)
        assert u2.call("session:join", {"session_id": sid}, timeout=10)["ok"]
        u1.events.clear()
        assert d.call("chat:message", {"session_id": sid, "text": "TEST_after_tr"}, timeout=10)["ok"]
        assert d.call("webrtc:offer", {"session_id": sid, "sdp": "x"}, timeout=10)["ok"]
        assert d.call("webrtc:ice-candidate", {"session_id": sid, "candidate": "c"}, timeout=10)["ok"]
        assert got(u2, "chat:message", pred=lambda m: m["text"] == "TEST_after_tr")
        assert got(u2, "webrtc:offer")
        time.sleep(2)
        leaked = [e for e, _ in u1.events if e in ("chat:message", "session:op", "webrtc:offer", "webrtc:ice-candidate")]
        assert not leaked, f"old tech still receives: {leaked}"
        # old tech cannot rejoin nor relay
        assert u1.call("session:join", {"session_id": sid}, timeout=10)["ok"] is False
        assert u1.call("webrtc:answer", {"session_id": sid, "sdp": "x"}, timeout=10)["ok"] is False
        assert u1.call("chat:message", {"session_id": sid, "text": "x"}, timeout=10)["ok"] is False
    finally:
        if sid:
            admin.post(f"{API}/sessions/{sid}/end")
        for c in (d, u1, u2):
            c.disconnect()
        admin.delete(f"{API}/devices/{dev['device_id']}")


# ---- consent:update control=true rejected for browser platform
def test_browser_consent_control_rejected(admin, t1):
    dev = register_device(platform="browser")
    d = connect(dev["device_token"], "device")
    u1 = connect(t1.token)
    sid = None
    try:
        sid = d.call("support:request", {"consent_screen": True}, timeout=10)["session"]["id"]
        admin.post(f"{API}/sessions/{sid}/assign", json={"technician_id": t1.user["id"]})
        assert u1.call("support:accepted", {"session_id": sid}, timeout=10)["ok"]
        ack = d.call("consent:update", {"session_id": sid, "control": True}, timeout=10)
        assert ack["ok"] is False, ack
        assert d.call("consent:update", {"session_id": sid, "screen": True}, timeout=10)["ok"]
        r = u1.call("remote:command", {"session_id": sid, "command": {"type": "tap", "x": 1, "y": 1}}, timeout=10)
        assert r["ok"] is False
        s = admin.get(f"{API}/sessions/{sid}").json()
        assert not (s.get("consent") or {}).get("control")
    finally:
        if sid:
            admin.post(f"{API}/sessions/{sid}/end")
        d.disconnect(); u1.disconnect()
        admin.delete(f"{API}/devices/{dev['device_id']}")
