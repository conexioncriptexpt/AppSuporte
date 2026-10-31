import axios from "axios";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const RT_KEY = "cc_refresh";
let accessToken = null;
let refreshing = null;
let onLogout = () => {};

export const tokens = {
  get access() { return accessToken; },
  get refresh() { return localStorage.getItem(RT_KEY); },
  set(access, refresh) {
    accessToken = access;
    if (refresh) localStorage.setItem(RT_KEY, refresh);
  },
  clear() {
    accessToken = null;
    localStorage.removeItem(RT_KEY);
  },
  onLogout(fn) { onLogout = fn; },
};

export const http = axios.create({ baseURL: API });

http.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

export async function refreshTokens() {
  const rt = tokens.refresh;
  if (!rt) throw new Error("no refresh");
  if (!refreshing) {
    refreshing = axios.post(`${API}/auth/refresh`, { refresh_token: rt })
      .then((r) => { tokens.set(r.data.access_token, r.data.refresh_token); return r.data; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

http.interceptors.response.use(
  (r) => r,
  async (err) => {
    const cfg = err.config;
    if (err.response?.status === 401 && cfg && !cfg._retry && !cfg.url.includes("/auth/")) {
      cfg._retry = true;
      try {
        await refreshTokens();
        return http(cfg);
      } catch {
        tokens.clear();
        onLogout();
      }
    }
    return Promise.reject(err);
  }
);

export const errMsg = (e) => {
  if (!e?.response) return "Sem ligação ao servidor. Verifique a internet e tente novamente.";
  if (e.response.status >= 500) return "O servidor está indisponível de momento. Tente dentro de instantes.";
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return "Dados inválidos: verifique os campos.";
  return d || "Ocorreu um erro. Tente novamente.";
};
