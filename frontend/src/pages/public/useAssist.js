import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API, BACKEND_URL } from "../../lib/api";
import { fetchIce, tuneSender } from "../../lib/rtc";
import { beep, detectOS, OS_NAME } from "../../lib/format";

const installId = () => {
  let id = localStorage.getItem("cc_install_id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("cc_install_id", id);
  }
  return id;
};

const browserName = () => {
  const ua = navigator.userAgent;
  if (/edg\//i.test(ua)) return "Edge";
  if (/chrome\//i.test(ua)) return "Chrome";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/safari\//i.test(ua)) return "Safari";
  return "Navegador";
};

async function registerDevice() {
  const os = OS_NAME[detectOS()];
  const r = await fetch(`${API}/device/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ install_id: installId(), platform: "browser", os, os_version: browserName(), name: `${os} · ${browserName()}` }),
  });
  if (!r.ok) throw new Error("register");
  return r.json();
}

export function useAssist(code, soundOn) {
  const [phase, setPhase] = useState("idle");
  const [techName, setTechName] = useState(null);
  const [privacy, setPrivacy] = useState(false);
  const [privacyAsk, setPrivacyAsk] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [online, setOnline] = useState(true);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const r = useRef({ stream: null, socket: null, pc: null, sessionId: null, token: null, ice: null, pendingIce: [], name: "" });
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  const ding = (f) => { if (soundRef.current) beep(f); };

  const cleanup = useCallback(() => {
    const s = r.current;
    s.pc?.close(); s.pc = null;
    s.stream?.getTracks().forEach((t) => t.stop()); s.stream = null;
    s.socket?.disconnect(); s.socket = null;
    setSharing(false); setPrivacy(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const makeOffer = useCallback(async () => {
    const s = r.current;
    if (!s.stream || !s.socket) return;
    s.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: s.ice, bundlePolicy: "max-bundle" });
    s.pc = pc;
    s.pendingIce = [];
    s.stream.getVideoTracks().forEach((t) => pc.addTrack(t, s.stream));
    await Promise.all(pc.getSenders().map(tuneSender));
    pc.onicecandidate = (e) => { if (e.candidate) s.socket?.emit("webrtc:ice-candidate", { session_id: s.sessionId, candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      s.socket?.emit("session:status", { session_id: s.sessionId, connection_state: pc.connectionState });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    s.socket.emit("webrtc:offer", { session_id: s.sessionId, sdp: pc.localDescription });
  }, []);

  const attachStream = (stream) => {
    const s = r.current;
    s.stream = stream;
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.contentHint = "detail";
      track.onended = () => {
        setSharing(false);
        s.socket?.emit("session:status", { session_id: s.sessionId, screen_sharing: false });
      };
    }
    setSharing(true);
    const st = track?.getSettings() || {};
    return st.width ? `${st.width}x${st.height}` : "";
  };

  const capture = () => navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 30 }, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } },
    audio: false,
  });

  const wireSocket = (socket) => {
    const s = r.current;
    socket.on("connect", () => {
      setOnline(true);
      const tr = s.stream?.getVideoTracks()[0]?.getSettings() || {};
      socket.emit("support:request", { link_code: code || "", consent_screen: true, client_name: s.name, screen: tr.width ? `${tr.width}x${tr.height}` : "" }, (ack) => {
        if (!ack?.ok) { setError(ack?.error || "Não foi possível pedir assistência."); return; }
        const sess = ack.session;
        s.sessionId = sess.id;
        setTechName(sess.technician_name);
        setPrivacy(!!sess.privacy);
        setPhase(sess.status === "active" ? "active" : "waiting");
      });
    });
    socket.on("disconnect", () => setOnline(false));
    socket.on("connect_error", async (e) => {
      setOnline(false);
      if (String(e?.message).includes("unauthorized")) {
        try { const d = await registerDevice(); s.token = d.device_token; } catch { /* retry later */ }
      }
    });
    socket.on("support:assigned", (d) => { setTechName(d.technician_name); ding(660); });
    socket.on("support:rejected", () => setTechName(null));
    socket.on("session:started", (d) => { setTechName(d.technician_name); setPhase("active"); ding(990); });
    socket.on("webrtc:request-offer", () => { makeOffer().catch(() => {}); });
    socket.on("webrtc:answer", async (d) => {
      const pc = s.pc;
      if (!pc || pc.signalingState !== "have-local-offer") return;
      await pc.setRemoteDescription(d.sdp);
      for (const c of s.pendingIce) await pc.addIceCandidate(c).catch(() => {});
      s.pendingIce = [];
    });
    socket.on("webrtc:ice-candidate", async (d) => {
      const pc = s.pc;
      if (!pc) return;
      if (!pc.remoteDescription) s.pendingIce.push(d.candidate);
      else await pc.addIceCandidate(d.candidate).catch(() => {});
    });
    socket.on("privacy:enabled", () => { setPrivacy(true); setPrivacyAsk(false); });
    socket.on("privacy:disabled", () => { setPrivacy(false); setPrivacyAsk(false); });
    socket.on("privacy:request-disable", () => setPrivacyAsk(true));
    socket.on("chat:message", (m) => {
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (m.from !== "device") ding(740);
    });
    socket.on("session:ended", () => { setPhase("ended"); cleanup(); ding(440); });
  };

  const start = async (name) => {
    setError("");
    if (!navigator.mediaDevices?.getDisplayMedia) { setPhase("unsupported"); return; }
    setPhase("starting");
    let stream;
    try {
      stream = await capture();
    } catch {
      setPhase("idle");
      setError("A partilha de ecrã não foi autorizada. Carrega em CONECTAR para tentar de novo.");
      return;
    }
    const s = r.current;
    s.name = name || "";
    attachStream(stream);
    try {
      const d = await registerDevice();
      s.token = d.device_token;
      s.ice = await fetchIce(d.device_token);
    } catch {
      cleanup(); setPhase("idle");
      setError("Sem ligação ao servidor. Verifica a internet e tenta de novo.");
      return;
    }
    const socket = io(BACKEND_URL, {
      path: "/api/socket.io", transports: ["websocket", "polling"],
      reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 15000, randomizationFactor: 0.5,
      auth: (cb) => cb({ token: s.token, kind: "device" }),
    });
    s.socket = socket;
    wireSocket(socket);
  };

  const reshare = async () => {
    try {
      const stream = await capture();
      attachStream(stream);
      r.current.socket?.emit("session:status", { session_id: r.current.sessionId, screen_sharing: true });
      await makeOffer();
    } catch { /* user cancelled */ }
  };

  const end = () => {
    const s = r.current;
    if (s.socket && s.sessionId) s.socket.emit("session:end", { session_id: s.sessionId });
    setPhase("ended");
    cleanup();
  };

  const send = (text) => r.current.socket?.emit("chat:message", { session_id: r.current.sessionId, text });
  const disablePrivacy = () => r.current.socket?.emit("privacy:disable", { session_id: r.current.sessionId });
  const reset = () => { setPhase("idle"); setMessages([]); setTechName(null); };

  return { phase, techName, privacy, privacyAsk, sharing, online, messages, error, start, reshare, end, send, disablePrivacy, reset };
}
