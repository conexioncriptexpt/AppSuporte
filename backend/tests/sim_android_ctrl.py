# Helper (not a test): simulated android device sending consent_control=true on support:request. Logs to /tmp/sim_ctrl.log
import json
import sys
import time
import socketio
sys.path.insert(0, "/app/backend/tests")
from conftest import BASE_URL, register_device  # noqa: E402

dev = register_device(name="TEST_SimCtrl", platform="android")
log = open(sys.argv[3] if len(sys.argv) > 3 else "/tmp/sim_ctrl.log", "w", buffering=1)
c = socketio.Client(reconnection=False)


@c.on("*")
def any_event(ev, data=None):
    log.write(json.dumps({"ev": ev, "data": data}, ensure_ascii=False) + "\n")


c.connect(BASE_URL, socketio_path="/api/socket.io", auth={"token": dev["device_token"], "kind": "device"},
          transports=["polling"], wait_timeout=15)
ack = c.call("support:request", {"client_name": "TEST_SimCtrl", "consent_screen": True, "consent_control": True,
                                 "screen": "1080x2400", "link_code": sys.argv[2] if len(sys.argv) > 2 else ""}, timeout=10)
log.write(json.dumps({"session_id": ack["session"]["id"], "device_id": dev["device_id"],
                      "control": ack["session"]["consent"]["control"]}) + "\n")
end = time.time() + int(sys.argv[1] if len(sys.argv) > 1 else 240)
while time.time() < end:
    time.sleep(1)
c.disconnect()
