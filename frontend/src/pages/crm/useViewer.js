import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { http, tokens, errMsg } from "../../lib/api";
import { fetchIce, readStats } from "../../lib/rtc";
import { useAuth, useSocketEvent } from "../../context/AuthContext";

export function useViewer(id) {
  const { socket } = useAuth();
  const [s, setS] = useState(null);
  const [stream, setStream] = useState(null);
  const [rtc, setRtc] = useState("a aguardar");
  const [quality, setQuality] = useState({});
  const [tree, setTree] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const r = useRef({ pc: null, ice: null, pending: [], prev: null, lastReq: 0, discSince: 0, tick: 0 });
  const sRef = useRef(null);
  sRef.current = s;

  const load = useCallback(async () => {
    try { const { data } = await http.get(`/sessions/${id}`); setS(data); return data; }
    catch { setNotFound(true); return null; }
  }, [id]);

  const requestOffer = useCallback(() => {
    if (!socket) return;
    r.current.lastReq = Date.now();
    setRtc("a ligar");
    socket.emit("webrtc:request-offer", { session_id: id });
  }, [socket, id]);

  useEffect(() => { load(); fetchIce(tokens.access).then((ice) => { r.current.ice = ice; }); }, [load]);

  useEffect(() => {
    if (!socket) return undefined;
    const join = () => socket.emit("session:join", { session_id: id }, (ack) => {
      if (ack?.ok && ack.session.status === "active") requestOffer();
    });
    if (socket.connected) join();
    socket.on("connect", join);
    return () => { socket.off("connect", join); };
  }, [socket, id, requestOffer]);

  useEffect(() => () => { r.current.pc?.close(); }, []);

  useSocketEvent("webrtc:offer", async (d) => {
    if (d.session_id !== id) return;
    const ref = r.current;
    ref.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: ref.ice || [], bundlePolicy: "max-bundle" });
    ref.pc = pc; ref.pending = []; ref.prev = null;
    pc.ontrack = (e) => {
      try { e.receiver.jitterBufferTarget = 120; } catch { /* unsupported */ }
      setStream(e.streams[0] || new MediaStream([e.track]));
    };
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit("webrtc:ice-candidate", { session_id: id, candidate: e.candidate }); };
    pc.onconnectionstatechange = () => setRtc(pc.connectionState);
    await pc.setRemoteDescription(d.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    socket.emit("webrtc:answer", { session_id: id, sdp: pc.localDescription });
    for (const c of ref.pending) await pc.addIceCandidate(c).catch(() => {});
    ref.pending = [];
  });
  useSocketEvent("webrtc:ice-candidate", async (d) => {
    const pc = r.current.pc;
    if (d.session_id !== id || !pc) return;
    if (!pc.remoteDescription) r.current.pending.push(d.candidate);
    else await pc.addIceCandidate(d.candidate).catch(() => {});
  });
  useSocketEvent("session:status", (d) => {
    if (d.session_id !== id) return;
    setS((p) => (p ? { ...p, ...d, consent: { ...p.consent, ...(d.consent || {}) } } : p));
    if (d.reconnected || d.screen_sharing === true) setTimeout(requestOffer, 800);
  });
  useSocketEvent("session:op", (d) => d.session_id === id && setS((p) => (p ? { ...p, operations: [...(p.operations || []), d] } : p)));
  useSocketEvent("chat:message", (m) => m.session_id === id && setS((p) => (p ? { ...p, messages: [...(p.messages || []), m] } : p)));
  useSocketEvent("privacy:enabled", (d) => d.session_id === id && setS((p) => ({ ...p, privacy: true })));
  useSocketEvent("privacy:disabled", (d) => {
    if (d.session_id !== id) return;
    setS((p) => ({ ...p, privacy: false }));
    if (d.by === "device") toast.info("O cliente desativou o modo de privacidade");
  });
  useSocketEvent("accessibility:tree", (d) => d.session_id === id && setTree(d));
  useSocketEvent("session:ended", (d) => {
    if (d.session_id !== id) return;
    r.current.pc?.close(); r.current.pc = null; setStream(null); setRtc("terminada");
    load();
  });
  useSocketEvent("queue:changed", (d) => d.session_id === id && load());
  useSocketEvent("session:transferred", (d) => {
    if (d.session_id !== id) return;
    r.current.pc?.close(); r.current.pc = null; setStream(null);
    toast.info(`Atendimento transferido para ${d.technician_name}`);
    load();
  });

  // Watchdog + stats: re-negotiate when the link drops, report quality.
  useEffect(() => {
    const i = setInterval(async () => {
      const ref = r.current;
      const cur = sRef.current;
      if (!cur || cur.status !== "active") return;
      const pc = ref.pc;
      const st = pc?.connectionState;
      const now = Date.now();
      if (st === "disconnected") ref.discSince = ref.discSince || now; else ref.discSince = 0;
      const stale = !pc || st === "failed" || st === "closed" || (ref.discSince && now - ref.discSince > 6000);
      const backoff = Math.min(30000, 5000 * 2 ** Math.min(3, Math.floor((now - ref.lastReq) / 60000)));
      if (stale && now - ref.lastReq > (pc ? 5000 : backoff > 8000 ? 8000 : backoff)) requestOffer();
      if (pc && st === "connected") {
        const q = await readStats(pc, ref.prev);
        ref.prev = q;
        setQuality(q);
        ref.tick += 1;
        if (ref.tick % 5 === 0) socket?.emit("session:status", { session_id: id, quality: { rtt: q.rtt, fps: q.fps, kbps: q.kbps, state: st } });
      }
    }, 2000);
    return () => clearInterval(i);
  }, [socket, id, requestOffer]);

  const emit = (event, extra = {}) => new Promise((res) => socket?.emit(event, { session_id: id, ...extra }, (ack) => {
    if (ack && !ack.ok && ack.error) toast.error(ack.error);
    res(ack);
  }));

  const accept = async () => { const a = await emit("support:accepted"); if (a?.ok) { await load(); requestOffer(); } };
  const reject = async () => { const a = await emit("support:rejected"); if (a?.ok) load(); };
  const end = async () => { try { await http.post(`/sessions/${id}/end`); load(); } catch (e) { toast.error(errMsg(e)); } };
  const cmd = (command) => emit("remote:command", { command });

  return { s, stream, rtc, quality, tree, notFound, load, accept, reject, end, cmd, emit, requestOffer };
}
