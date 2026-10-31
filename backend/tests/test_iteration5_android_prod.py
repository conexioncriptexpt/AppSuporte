# Iteration 5: static backend-URL config checks, read-only production health, and Android-device emulation flow on PREVIEW
import re
import time
import yaml
import requests
import socketio
import pytest
from conftest import API, BASE_URL, register_device

PROD = "https://conex-assist-2.emergentagent.host"


# --- Static config checks (workflow / gradle / csproj default to production) ---
class TestStaticConfig:
    def test_workflow_yaml_valid_and_default(self):
        txt = open("/app/.github/workflows/native-apps.yml").read()
        y = yaml.safe_load(txt)
        assert PROD in y["env"]["CONEX_BACKEND_URL"]
        assert "preview.emergentagent" not in txt

    def test_gradle_default(self):
        txt = open("/app/android/app/build.gradle.kts").read()
        assert re.search(r'"' + re.escape(PROD) + r'"\)', txt)
        assert "preview.emergentagent" not in txt

    def test_csproj_default(self):
        txt = open("/app/windows/CryptoConexPC/CryptoConexPC.csproj").read()
        assert f">{PROD}</ConexBackendUrl>" in txt


# --- Production read-only (no writes!) ---
class TestProductionReadOnly:
    def test_prod_health(self):
        r = requests.get(f"{PROD}/api/health", timeout=20)
        assert r.status_code == 200 and r.json()["ok"] is True

    def test_prod_socketio_handshake(self):
        r = requests.get(f"{PROD}/api/socket.io/?EIO=4&transport=polling", timeout=20)
        assert r.status_code == 200 and r.text.startswith("0{") and '"sid"' in r.text


# --- Preview: emulate Android app exactly ---
def _login_admin():
    r = requests.post(f"{API}/auth/login", json={"email": "test_admin@cryptoconex-teste.pt", "password": "TestConex#2026"}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"admin login failed {r.status_code}")
    return r.json()["access_token"]


@pytest.mark.parametrize("transport", ["websocket", "polling"])
def test_android_device_flow(transport):
    token = _login_admin()
    H = {"Authorization": f"Bearer {token}"}
    dev = register_device(name=f"TEST_Android_{transport}", platform="android")
    admin_ev, dev_ev = [], []
    adm = socketio.Client(reconnection=False)
    adm.on("*", lambda ev, data=None: admin_ev.append(ev))
    adm.connect(BASE_URL, socketio_path="/api/socket.io", auth={"token": token, "kind": "user"},
                transports=["polling"], wait_timeout=15)
    d = socketio.Client(reconnection=False)
    d.on("*", lambda ev, data=None: dev_ev.append(ev))
    d.connect(BASE_URL, socketio_path="/api/socket.io", auth={"token": dev["device_token"], "kind": "device"},
              transports=[transport], wait_timeout=15)
    sid = None
    try:
        ack = d.call("support:request", {"consent_screen": True, "screen": "1080x2400", "link_code": ""}, timeout=10)
        assert ack["ok"] is True, ack
        sid = ack["session"]["id"]
        assert ack["session"]["status"] == "pending" and ack["session"]["platform"] == "android"
        d.emit("session:status", {"session_id": sid, "resolution": "1080x2400"})
        time.sleep(1.5)
        assert "support:request" in admin_ev, admin_ev
        r = requests.get(f"{API}/sessions", headers=H, params={"status": "pending"}, timeout=20)
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", r.json().get("sessions", []))
        assert any(s["id"] == sid for s in items), "session not in pending list"
        # take + accept
        r = requests.post(f"{API}/sessions/{sid}/take", headers=H, timeout=20)
        assert r.status_code == 200, r.text
        a = adm.call("support:accepted", {"session_id": sid}, timeout=10)
        assert a["ok"] is True, a
        rr = adm.call("webrtc:request-offer", {"session_id": sid}, timeout=10)
        assert rr["ok"] is True, rr
        time.sleep(1.5)
        assert "support:assigned" in dev_ev, dev_ev
        assert "session:started" in dev_ev, dev_ev
        assert "webrtc:request-offer" in dev_ev, dev_ev
        g = requests.get(f"{API}/sessions/{sid}", headers=H, timeout=20).json()
        assert g["status"] == "active" and g["resolution"] == "1080x2400" and g["consent"]["screen"] is True
    finally:
        if sid:
            requests.post(f"{API}/sessions/{sid}/end", headers=H, timeout=20)
        d.disconnect()
        adm.disconnect()
