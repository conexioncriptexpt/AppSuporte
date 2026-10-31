import os
import uuid
import pytest
import requests
from dotenv import dotenv_values

_fe = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _fe.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"
PW = "TestConex#2026"
ADMIN = "test_admin@cryptoconex-teste.pt"
T1 = "test_tecnico1@cryptoconex-teste.pt"
T2 = "test_tecnico2@cryptoconex-teste.pt"


def login(email, pw=PW):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
    return r


def _auth(email):
    r = login(email)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text}")
    d = r.json()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {d['access_token']}"})
    s.user = d["user"]
    s.token = d["access_token"]
    s.refresh = d["refresh_token"]
    return s


@pytest.fixture(scope="session")
def admin():
    return _auth(ADMIN)


@pytest.fixture(scope="session")
def t1():
    return _auth(T1)


@pytest.fixture(scope="session")
def t2():
    return _auth(T2)


def register_device(name=None):
    iid = f"TEST_{uuid.uuid4().hex}"
    r = requests.post(f"{API}/device/register", json={"install_id": iid, "platform": "browser", "os": "Linux",
                                                       "os_version": "Chrome", "name": name or f"TEST_dev_{iid[-6:]}"}, timeout=20)
    assert r.status_code == 200, r.text
    return {**r.json(), "install_id": iid}
