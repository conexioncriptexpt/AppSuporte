# REST API tests: auth, users, settings, audit, links, public config, devices, sessions scope
import uuid
import requests
import pytest
from conftest import API, BASE_URL, PW, ADMIN, T1, T2, login, register_device


# ---- Health / public
def test_health():
    r = requests.get(f"{API}/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_public_config_no_code():
    r = requests.get(f"{API}/public/config")
    assert r.status_code == 200
    d = r.json()
    assert "downloads" in d and d["link"] is None


# ---- Auth
class TestAuth:
    def test_wrong_password_401_pt(self):
        r = login(f"TEST_nouser_{uuid.uuid4().hex[:6]}@example.com", "wrongpw")
        assert r.status_code == 401
        assert "incorretos" in r.json()["detail"]

    def test_lockout_after_5(self):
        email = f"test_lock_{uuid.uuid4().hex[:6]}@example.com"
        codes = [login(email, "badbad").status_code for _ in range(5)]
        assert codes == [401] * 5
        r = login(email, "badbad")
        assert r.status_code == 429, r.text
        assert "bloqueada" in r.json()["detail"]

    def test_me_and_protected(self, admin):
        assert requests.get(f"{API}/auth/me").status_code == 401
        assert requests.get(f"{API}/sessions").status_code == 401
        r = admin.get(f"{API}/auth/me")
        assert r.status_code == 200 and r.json()["email"] == ADMIN and r.json()["role"] == "super_admin"
        assert "password_hash" not in r.json()

    def test_refresh_rotation_and_reuse(self):
        d = login(T2).json()
        rt1 = d["refresh_token"]
        r = requests.post(f"{API}/auth/refresh", json={"refresh_token": rt1})
        assert r.status_code == 200
        rt2 = r.json()["refresh_token"]
        assert rt2 != rt1 and r.json()["access_token"]
        # reuse old -> 401 and family revoked
        r = requests.post(f"{API}/auth/refresh", json={"refresh_token": rt1})
        assert r.status_code == 401
        r = requests.post(f"{API}/auth/refresh", json={"refresh_token": rt2})
        assert r.status_code == 401

    def test_logout_revokes(self):
        d = login(T2).json()
        assert requests.post(f"{API}/auth/logout", json={"refresh_token": d["refresh_token"]}).json()["ok"]
        assert requests.post(f"{API}/auth/refresh", json={"refresh_token": d["refresh_token"]}).status_code == 401


# ---- RBAC
def test_technician_forbidden_admin_routes(t1):
    for m, p in [("get", "/users"), ("get", "/settings"), ("get", "/audit"), ("post", "/users")]:
        r = getattr(t1, m)(f"{API}{p}", json={}) if m == "post" else getattr(t1, m)(f"{API}{p}")
        assert r.status_code == 403, f"{p} {r.status_code}"


# ---- Users CRUD (super admin)
class TestUsers:
    def test_full_user_lifecycle(self, admin):
        email = f"test_tmp_{uuid.uuid4().hex[:6]}@cryptoconex-teste.pt"
        r = admin.post(f"{API}/users", json={"name": "TEST_Tmp Tech", "email": email, "password": "TmpPass#12345"})
        assert r.status_code == 200, r.text
        u = r.json()
        uid = u["id"]
        assert u["role"] == "technician" and u["active"] and "password_hash" not in u
        assert admin.post(f"{API}/users", json={"name": "Dup", "email": email, "password": "TmpPass#12345"}).status_code == 409
        # edit + perms
        r = admin.patch(f"{API}/users/{uid}", json={"name": "TEST_Renamed", "permissions": {"control": False, "privacy": True, "accessibility": False}})
        assert r.status_code == 200 and r.json()["name"] == "TEST_Renamed" and r.json()["permissions"]["control"] is False
        lst = admin.get(f"{API}/users").json()
        assert any(x["id"] == uid and x["name"] == "TEST_Renamed" for x in lst)
        # login works
        assert login(email, "TmpPass#12345").status_code == 200
        # deactivate -> 403
        assert admin.patch(f"{API}/users/{uid}", json={"active": False}).json()["active"] is False
        r = login(email, "TmpPass#12345")
        assert r.status_code == 403
        assert admin.patch(f"{API}/users/{uid}", json={"active": True}).json()["active"] is True
        # set password
        assert admin.post(f"{API}/users/{uid}/password", json={"password": "NewPass#12345"}).json()["ok"]
        assert login(email, "NewPass#12345").status_code == 200
        # reset link
        tok = admin.post(f"{API}/users/{uid}/reset-link").json()["token"]
        assert requests.post(f"{API}/auth/reset", json={"token": tok, "new_password": "ResetPass#123"}).json()["ok"]
        assert requests.post(f"{API}/auth/reset", json={"token": tok, "new_password": "ResetPass#123"}).status_code == 400
        assert login(email, "ResetPass#123").status_code == 200
        # activity
        act = admin.get(f"{API}/users/{uid}/activity").json()
        assert "logs" in act and any(l["action"] == "auth.login" for l in act["logs"])
        # delete
        assert admin.delete(f"{API}/users/{uid}").json()["ok"]
        assert admin.delete(f"{API}/users/{uid}").status_code == 404

    def test_cannot_deactivate_or_delete_super_admin(self, admin):
        uid = admin.user["id"]
        assert admin.patch(f"{API}/users/{uid}", json={"active": False}).status_code == 400
        assert admin.delete(f"{API}/users/{uid}").status_code == 400


# ---- Settings / audit
def test_settings_save_and_downloads(admin):
    orig = admin.get(f"{API}/settings").json()
    body = {"retention_days": 90, "default_link_days": 7, "sound_enabled": False, "github_repo": "TEST_owner/TEST_repo",
            "android_download_url": "", "windows_download_url": ""}
    r = admin.put(f"{API}/settings", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["retention_days"] == 90 and d["sound_enabled"] is False
    assert d["downloads"]["android"] == "https://github.com/TEST_owner/TEST_repo/releases/latest/download/CryptoConex.apk"
    pc = requests.get(f"{API}/public/config").json()
    assert pc["downloads"]["windows"].endswith("CryptoConexSetup.exe") and pc["sound_enabled"] is False
    assert admin.put(f"{API}/settings", json={**body, "retention_days": 1}).status_code == 422
    restore = {k: orig[k] for k in body}
    assert admin.put(f"{API}/settings", json=restore).status_code == 200


def test_audit_list(admin):
    r = admin.get(f"{API}/audit?limit=20")
    assert r.status_code == 200 and isinstance(r.json(), list) and len(r.json()) > 0
    assert {"actor", "action", "at"} <= set(r.json()[0])


# ---- Links
class TestLinks:
    @pytest.mark.parametrize("days", [1, 7, 30, 90, 0])
    def test_link_validity(self, t1, days):
        body = {"days": days} if days else {"days": None}
        r = t1.post(f"{API}/links", json=body)
        assert r.status_code == 200, r.text
        link = r.json()
        assert link["technician_id"] == t1.user["id"]
        if days == 0:
            pass  # days None => default from settings
        pc = requests.get(f"{API}/public/config", params={"code": link["code"]}).json()
        assert pc["link"]["valid"] is True and pc["link"]["technician_name"] == t1.user["name"]
        assert t1.post(f"{API}/links/{link['id']}/revoke").json()["ok"]
        pc = requests.get(f"{API}/public/config", params={"code": link["code"]}).json()
        assert pc["link"]["valid"] is False

    def test_link_days_zero_no_expiry(self, t1):
        # UI option "0 = sem expiração": API validator ge=1 rejects days=0?
        r = t1.post(f"{API}/links", json={"days": 0})
        print("days=0 ->", r.status_code, r.text[:200])
        assert r.status_code == 200, f"days=0 (sem expiração) rejected: {r.status_code} {r.text}"
        assert r.json()["expires_at"] is None
        t1.post(f"{API}/links/{r.json()['id']}/revoke")

    def test_tech2_cannot_revoke_tech1_link(self, t1, t2):
        link = t1.post(f"{API}/links", json={"days": 1}).json()
        assert t2.post(f"{API}/links/{link['id']}/revoke").status_code == 404
        assert all(l["technician_id"] == t2.user["id"] for l in t2.get(f"{API}/links").json())
        t1.post(f"{API}/links/{link['id']}/revoke")

    def test_invalid_code(self):
        assert requests.get(f"{API}/public/config", params={"code": "nonexistent"}).json()["link"]["valid"] is False


# ---- Devices
class TestDevices:
    def test_register_rename_delete(self, admin, t1):
        d = register_device()
        did = d["device_id"]
        assert d["device_token"]
        # re-register same install id returns same device
        r = requests.post(f"{API}/device/register", json={"install_id": d["install_id"], "platform": "browser", "os": "Linux"})
        assert r.json()["device_id"] == did
        lst = admin.get(f"{API}/devices", params={"q": "TEST_dev"}).json()
        assert any(x["id"] == did for x in lst)
        assert all(x["platform"] == "browser" for x in admin.get(f"{API}/devices", params={"os": "browser"}).json())
        assert all(x["online"] is False for x in admin.get(f"{API}/devices", params={"status": "offline"}).json())
        r = admin.patch(f"{API}/devices/{did}", json={"name": "TEST_Renamed_dev"})
        assert r.status_code == 200 and r.json()["name"] == "TEST_Renamed_dev"
        assert admin.get(f"{API}/devices/{did}").json()["name"] == "TEST_Renamed_dev"
        # technician without sessions cannot see / delete
        assert t1.get(f"{API}/devices/{did}").status_code == 404
        assert t1.delete(f"{API}/devices/{did}").status_code == 403
        assert admin.delete(f"{API}/devices/{did}").json()["ok"]
        assert admin.get(f"{API}/devices/{did}").status_code == 404

    def test_register_validation(self):
        r = requests.post(f"{API}/device/register", json={"install_id": "short", "platform": "ios", "os": "x"})
        assert r.status_code == 422


def test_ice_servers_requires_token(admin):
    assert requests.get(f"{API}/ice-servers").status_code == 401
    r = admin.get(f"{API}/ice-servers")
    assert r.status_code == 200 and isinstance(r.json()["iceServers"], list)


def test_dashboard_stats(admin, t1):
    for c in (admin, t1):
        d = c.get(f"{API}/dashboard").json()
        for k in ("devices_total", "devices_online", "pending", "active", "history_total", "techs_available", "chart"):
            assert k in d
        assert len(d["chart"]) == 7
