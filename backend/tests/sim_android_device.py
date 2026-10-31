# Helper (not a test): simulated android device for UI console testing. Writes received events to /tmp/sim_dev.log
import json
import sys
import time
import socketio
sys.path.insert(0, "/app/backend/tests")
from conftest import API, BASE_URL, register_device  # noqa: E402

dev = register_device(name="TEST_SimAndroid", platform="android")
log = open("/tmp/sim_dev.log", "w", buffering=1)
c = socketio.Client(reconnection=False)
state = {"sid": None, "consented": False}


@c.on("*")
def any_event(ev, data=None):
    log.write(json.dumps({"ev": ev, "data": data}, ensure_ascii=False) + "\n")
    if ev == "session:started" and not state["consented"]:
        state["consented"] = True
        r = c.call("consent:update", {"session_id": state["sid"], "control": True}, timeout=10)
        log.write(json.dumps({"consent_ack": r}) + "\n")


c.connect(BASE_URL, socketio_path="/api/socket.io", auth={"token": dev["device_token"], "kind": "device"},
          transports=["polling"], wait_timeout=15)
ack = c.call("support:request", {"client_name": "TEST_SimAndroid", "consent_screen": True, "screen": "1080x2400"}, timeout=10)
state["sid"] = ack["session"]["id"]
log.write(json.dumps({"session_id": state["sid"], "device_id": dev["device_id"]}) + "\n")
end = time.time() + int(sys.argv[1] if len(sys.argv) > 1 else 240)
while time.time() < end:
    time.sleep(1)
c.disconnect()
