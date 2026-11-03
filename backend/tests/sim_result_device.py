# Helper (not a test): simulated device answering every remote:command with remote:result ok:false 'TEST erro'.
# usage: python sim_result_device.py <seconds> <platform> <control 1/0> <logfile>
import json
import sys
import time
import socketio
sys.path.insert(0, "/app/backend/tests")
from conftest import BASE_URL, register_device  # noqa: E402

secs, platform, control, logf = int(sys.argv[1]), sys.argv[2], sys.argv[3] == "1", sys.argv[4]
dev = register_device(name=f"TEST_it7_sim_{platform}", platform=platform)
log = open(logf, "w", buffering=1)
c = socketio.Client(reconnection=False)
state = {}


@c.on("*")
def any_event(ev, data=None):
    log.write(json.dumps({"ev": ev, "data": data}, ensure_ascii=False) + "\n")


@c.on("remote:command")
def on_cmd(data):
    log.write(json.dumps({"ev": "remote:command", "data": data}) + "\n")
    r = c.call("remote:result", {"session_id": data["session_id"], "ok": False, "error": "TEST erro"}, timeout=10)
    log.write(json.dumps({"sent_result_ack": r}) + "\n")


c.connect(BASE_URL, socketio_path="/api/socket.io", auth={"token": dev["device_token"], "kind": "device"},
          transports=["polling"], wait_timeout=15)
ack = c.call("support:request", {"client_name": f"TEST_it7_sim_{platform}", "consent_screen": True,
                                 "consent_control": control, "screen": "1080x2400"}, timeout=10)
log.write(json.dumps({"session_id": ack["session"]["id"], "device_id": dev["device_id"],
                      "control": ack["session"]["consent"]["control"]}) + "\n")
end = time.time() + secs
while time.time() < end:
    time.sleep(1)
c.disconnect()
