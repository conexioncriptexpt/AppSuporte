import { API } from "./api";

export async function fetchIce(token) {
  try {
    const r = await fetch(`${API}/ice-servers`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error("ice");
    return (await r.json()).iceServers;
  } catch {
    return [{ urls: "stun:stun.relay.metered.ca:80" }];
  }
}

// Tune the sender for a stable, crisp screen stream.
export async function tuneSender(sender) {
  try {
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = 3_000_000;
    p.encodings[0].maxFramerate = 30;
    p.degradationPreference = "maintain-resolution";
    await sender.setParameters(p);
  } catch { /* browser may not support */ }
}

export async function readStats(pc, prev) {
  const stats = await pc.getStats();
  let fps = 0, bytes = 0, rtt = null, ts = Date.now(), w = 0, h = 0;
  stats.forEach((r) => {
    if (r.type === "inbound-rtp" && r.kind === "video") {
      fps = r.framesPerSecond || 0; bytes = r.bytesReceived || 0;
      w = r.frameWidth || 0; h = r.frameHeight || 0;
    }
    if (r.type === "candidate-pair" && r.state === "succeeded" && r.nominated && r.currentRoundTripTime != null) {
      rtt = Math.round(r.currentRoundTripTime * 1000);
    }
  });
  const kbps = prev ? Math.max(0, Math.round(((bytes - prev.bytes) * 8) / (ts - prev.ts))) : 0;
  return { fps: Math.round(fps), kbps, rtt, bytes, ts, w, h };
}
