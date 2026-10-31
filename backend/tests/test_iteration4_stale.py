# Iteration 4: auto-end sessions whose device has been offline > 10 min (end_stale_sessions on /sessions and /dashboard)
import os
import time
from datetime import datetime, timedelta, timezone
import pytest
from dotenv import dotenv_values
from pymongo import MongoClient
from conftest import API, register_device
from test_realtime import connect, got

_be = dotenv_values("/app/backend/.env")
mdb = MongoClient(_be["MONGO_URL"])[_be["DB_NAME"]]


def _iso(dt):
    return dt.isoformat()


def _make_stale_session(admin, active=False):
    dev = register_device(name="TEST_stale_dev", platform="android")
    d = connect(dev["device_token"], "device")
    ack = d.call("support:request", {"client_name": "TEST_Stale", "consent_screen": True, "screen": "1080x2400"}, timeout=10)
    assert ack["ok"], ack
    sid = ack["session"]["id"]
    if active:
        a = connect(admin.token)
        assert admin.post(f"{API}/sessions/{sid}/assign", json={"technician_id": admin.user["id"]}).status_code == 200
        assert a.call("session:join", {"session_id": sid}, timeout=10)["ok"]
        assert a.call("support:accepted", {"session_id": sid}, timeout=10)["ok"]
        a.disconnect()
    d.disconnect()
    time.sleep(1.5)
    old = _iso(datetime.now(timezone.utc) - timedelta(minutes=11))
    mdb.devices.update_one({"id": dev["device_id"]}, {"$set": {"online": False, "last_seen": old}})
    return dev, sid


def test_recent_offline_not_ended(admin):
    dev = register_device(name="TEST_recent_dev", platform="android")
    d = connect(dev["device_token"], "device")
    sid = d.call("support:request", {"client_name": "TEST_Recent", "consent_screen": True}, timeout=10)["session"]["id"]
    d.disconnect()
    time.sleep(1.5)
    mdb.devices.update_one({"id": dev["device_id"]}, {"$set": {"online": False,
                           "last_seen": _iso(datetime.now(timezone.utc) - timedelta(minutes=3))}})
    lst = admin.get(f"{API}/sessions", params={"scope": "active"}).json()
    s = next(x for x in lst if x["id"] == sid)
    assert s["status"] == "pending" and s["device_online"] is False
    admin.post(f"{API}/sessions/{sid}/discard")
    admin.post(f"{API}/sessions/{sid}/end")
    admin.delete(f"{API}/devices/{dev['device_id']}")


def test_stale_pending_ended_via_sessions(admin):
    dev, sid = _make_stale_session(admin)
    lst = admin.get(f"{API}/sessions", params={"scope": "active"}).json()
    assert not any(x["id"] == sid for x in lst)
    full = admin.get(f"{API}/sessions/{sid}").json()
    assert full["status"] == "ended"
    assert full["ended_by"] == "sistema (cliente desligado)"
    admin.delete(f"{API}/devices/{dev['device_id']}")


def test_stale_active_ended_via_dashboard(admin):
    dev, sid = _make_stale_session(admin, active=True)
    assert admin.get(f"{API}/sessions/{sid}").json()["status"] == "active"
    r = admin.get(f"{API}/dashboard")
    assert r.status_code == 200
    full = admin.get(f"{API}/sessions/{sid}").json()
    assert full["status"] == "ended"
    assert full["ended_by"] == "sistema (cliente desligado)"
    hist = admin.get(f"{API}/sessions", params={"scope": "history"}).json()
    assert any(x["id"] == sid for x in hist)
    admin.delete(f"{API}/devices/{dev['device_id']}")
