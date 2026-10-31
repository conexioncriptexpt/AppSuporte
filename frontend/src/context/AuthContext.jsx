import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { http, tokens, refreshTokens, BACKEND_URL } from "../lib/api";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [socket, setSocket] = useState(null);
  const sockRef = useRef(null);

  const openSocket = useCallback(() => {
    if (sockRef.current) return;
    const s = io(BACKEND_URL, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      auth: (cb) => cb({ token: tokens.access, kind: "user" }),
    });
    s.on("connect_error", async (e) => {
      if (String(e?.message).includes("unauthorized")) {
        try { await refreshTokens(); s.connect(); } catch { /* logged out */ }
      }
    });
    sockRef.current = s;
    setSocket(s);
  }, []);

  const closeSocket = useCallback(() => {
    sockRef.current?.disconnect();
    sockRef.current = null;
    setSocket(null);
  }, []);

  const logoutLocal = useCallback(() => {
    tokens.clear();
    setUser(null);
    closeSocket();
  }, [closeSocket]);

  useEffect(() => {
    tokens.onLogout(logoutLocal);
    if (!tokens.refresh) { setReady(true); return; }
    refreshTokens()
      .then((d) => { setUser(d.user); openSocket(); })
      .catch(() => tokens.clear())
      .finally(() => setReady(true));
  }, [logoutLocal, openSocket]);

  useEffect(() => {
    if (!user) return undefined;
    const i = setInterval(() => { refreshTokens().then((d) => setUser(d.user)).catch(() => {}); }, 12 * 60 * 1000);
    return () => clearInterval(i);
  }, [user]);

  const login = async (email, password) => {
    const { data } = await http.post("/auth/login", { email, password });
    tokens.set(data.access_token, data.refresh_token);
    setUser(data.user);
    openSocket();
    return data.user;
  };

  const logout = async () => {
    const rt = tokens.refresh;
    if (rt) await http.post("/auth/logout", { refresh_token: rt }).catch(() => {});
    logoutLocal();
  };

  const isAdmin = user?.role === "super_admin";
  return (
    <AuthCtx.Provider value={{ user, ready, login, logout, socket, isAdmin }}>{children}</AuthCtx.Provider>
  );
}

export function useSocketEvent(event, handler) {
  const { socket } = useAuth();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return undefined;
    const fn = (d) => ref.current(d);
    socket.on(event, fn);
    return () => { socket.off(event, fn); };
  }, [socket, event]);
}
