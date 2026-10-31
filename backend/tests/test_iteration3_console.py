# Iteration 3: Live Console backend paths (header counters, console nav commands to android device, privacy, chat, end, public config)
import time
import pytest
from conftest import API, register_device
from test_realtime import connect, got


def test_public_config_assets_unavailable():
    import requests
    d = requests.get(f"{API}/public/config", timeout=20).json()
    assert "conexioncriptexpt/AppSuporte" in d["downloads"]["android"]
    assert d["downloads"]["android"].endswith("CryptoConex.apk")
    assert d["downloads"]["windows"].endswith("CryptoConexSetup.exe")
    assert d["available"] == {"android": False, "windows": False}


def test_technician_cannot_manage_users(t1):
    assert t1.get(f"{API}/users").status_code in (401, 403)


@pytest.fixture(scope="module")
def cflow(admin, t1):
    dev = register_device(name="TEST_console_android", platform="android")
    a = connect(admin.token)
    d = connect(dev["device_token"], "device")
    ctx = {"dev": dev, "a": a, "d": d}
    yield ctx
    for k in ("a", "d"):
        try:
            ctx[k].disconnect()
        except Exception:
            pass
    if ctx.get("sid"):
        admin.post(f"{API}/sessions/{ctx['sid']}/end")
    admin.delete(f"{API}/devices/{dev['device_id']}")


def test_console_flow(cflow, admin):
    a, d = cflow["a"], cflow["d"]
    base = admin.get(f"{API}/dashboard").json()
    ack = d.call("support:request", {"client_name": "TEST_Console", "consent_screen": True, "screen": "1080x2400"}, timeout=10)
    assert ack["ok"], ack
    sid = ack["session"]["id"]
    cflow["sid"] = sid
    assert got(a, "queue:changed", pred=lambda x: x["session_id"] == sid)
    dash = admin.get(f"{API}/dashboard").json()
    assert dash["pending"] == base["pending"] + 1
    assert dash["devices_online"] >= 1
    # pending appears in console list (scope=active)
    lst = admin.get(f"{API}/sessions", params={"scope": "active"}).json()
    assert any(s["id"] == sid and s["status"] == "pending" for s in lst)
    # 'Atender eu' -> assign to self
    r = admin.post(f"{API}/sessions/{sid}/assign", json={"technician_id": admin.user["id"]})
    assert r.status_code == 200, r.text
    assert a.call("session:join", {"session_id": sid}, timeout=10)["ok"]
    assert a.call("support:accepted", {"session_id": sid}, timeout=10)["ok"]
    dash2 = admin.get(f"{API}/dashboard").json()
    assert dash2["active"] == base["active"] + 1
    assert dash2["pending"] == base["pending"]
    # control refused before consent
    r = a.call("remote:command", {"session_id": sid, "command": {"type": "back"}}, timeout=10)
    assert r["ok"] is False
    assert d.call("consent:update", {"session_id": sid, "control": True}, timeout=10)["ok"]
    cmds = [
        {"type": "back"}, {"type": "home"}, {"type": "tap", "x": 540 / 1080, "y": 1200 / 2400},
        {"type": "scroll", "x": 0.5, "y": 0.5, "dy": -1}, {"type": "scroll", "x": 0.5, "y": 0.5, "dy": 1},
        {"type": "right_click", "x": 0.25, "y": 0.75},
        {"type": "swipe", "x1": 0.8, "y1": 0.5, "x2": 0.2, "y2": 0.5, "duration": 300},
        {"type": "recents"}, {"type": "text", "text": "TEST_ola"},
    ]
    for c in cmds:
        r = a.call("remote:command", {"session_id": sid, "command": c}, timeout=10)
        assert r["ok"], (c, r)
        rec = got(d, "remote:command", pred=lambda x, c=c: x["command"] == c)
        assert rec, f"device did not receive {c}"
    # privacy on/off
    assert a.call("privacy:enable", {"session_id": sid}, timeout=10)["ok"]
    assert got(d, "privacy:enabled")
    assert admin.get(f"{API}/sessions/{sid}").json()["privacy"] is True
    assert a.call("privacy:disable", {"session_id": sid}, timeout=10)["ok"]
    assert got(d, "privacy:disabled")
    # guided message
    assert a.call("chat:message", {"session_id": sid, "text": "TEST_Toque no botão verde"}, timeout=10)["ok"]
    assert got(d, "chat:message", pred=lambda x: x["text"] == "TEST_Toque no botão verde")
    full = admin.get(f"{API}/sessions/{sid}").json()
    ops = [o["text"] for o in full.get("operations", [])]
    assert "Comando: tap" in ops and "Comando: text (8 caracteres)" in ops
    assert any(m["text"] == "TEST_Toque no botão verde" for m in full.get("messages", []))
    # end
    r = admin.post(f"{API}/sessions/{sid}/end")
    assert r.status_code == 200
    assert got(d, "session:ended")
    time.sleep(0.5)
    assert admin.get(f"{API}/sessions/{sid}").json()["status"] == "ended"
