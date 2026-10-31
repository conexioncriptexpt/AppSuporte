import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Headset, MonitorSmartphone, Link2, Settings, LogOut, KeyRound, Menu, X, MonitorPlay, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth, useSocketEvent } from "../../context/AuthContext";
import { http, errMsg } from "../../lib/api";
import { beep } from "../../lib/format";
import { Logo, LisbonClock, Credits } from "../Brand";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

const NAV = [
  { to: "/crm/consola", label: "Consola ao Vivo", icon: MonitorPlay, id: "console" },
  { to: "/crm", label: "Dashboard", icon: LayoutDashboard, id: "dashboard", end: true },
  { to: "/crm/atendimentos", label: "Atendimentos", icon: Headset, id: "sessions" },
  { to: "/crm/dispositivos", label: "Dispositivos", icon: MonitorSmartphone, id: "devices" },
  { to: "/crm/links", label: "Links de Assistência", icon: Link2, id: "links" },
  { to: "/crm/equipa", label: "Equipa", icon: Users, id: "team", admin: true },
  { to: "/crm/configuracoes", label: "Configurações", icon: Settings, id: "settings", admin: true },
];

const Counters = () => {
  const [d, setD] = useState(null);
  const load = useCallback(() => { http.get("/dashboard").then((r) => setD(r.data)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  useSocketEvent("queue:changed", load);
  useSocketEvent("device:online", load);
  useSocketEvent("device:offline", load);
  const items = [["novos", "Novos", d?.pending, "text-amber-400"], ["ativas", "Ativas", d?.active, "text-lime-400"], ["online", "Online", d?.devices_online, "text-sky-400"]];
  return (
    <div className="hidden items-center gap-4 md:flex">
      {items.map(([id, l, v, c]) => (
        <div key={id} className="text-center leading-tight">
          <p data-testid={`header-count-${id}`} className={`font-mono text-lg font-bold ${c}`}>{v ?? 0}</p>
          <p className="text-[9px] uppercase tracking-widest text-slate-500">{l}</p>
        </div>
      ))}
    </div>
  );
};

const ChangePassword = ({ open, onClose }) => {
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const save = async () => {
    try {
      await http.post("/auth/change-password", { current_password: cur, new_password: pw });
      toast.success("Palavra-passe alterada. Volte a entrar nos outros dispositivos.");
      setCur(""); setPw(""); onClose();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const input = "mt-1 w-full rounded-lg border border-[#27354a] bg-[#0b0f17] px-3 py-2 text-white outline-none focus:border-lime-500";
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="border-[#27354a] bg-[#111827] text-white">
        <DialogHeader><DialogTitle>Alterar palavra-passe</DialogTitle></DialogHeader>
        <label className="text-sm text-slate-300">Atual<input data-testid="change-pw-current" type="password" value={cur} onChange={(e) => setCur(e.target.value)} className={input} /></label>
        <label className="text-sm text-slate-300">Nova (mín. 10)<input data-testid="change-pw-new" type="password" value={pw} onChange={(e) => setPw(e.target.value)} className={input} /></label>
        <button data-testid="change-pw-save" onClick={save} className="rounded-lg bg-lime-500 py-2 font-bold text-[#0b0f17]">Guardar</button>
      </DialogContent>
    </Dialog>
  );
};

export default function Shell() {
  const { user, logout, isAdmin, socket } = useAuth();
  const nav = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [connected, setConnected] = useState(true);

  useSocketEvent("support:request", (d) => {
    if (localStorage.getItem("cc_crm_sound") !== "off") { beep(880); setTimeout(() => beep(1175), 200); }
    toast.info(`Novo pedido de assistência: ${d.client_name || d.device_name || "cliente"}`, {
      action: { label: "Ver", onClick: () => nav("/crm/atendimentos") },
    });
  });
  useSocketEvent("support:assigned", (d) => {
    if (d.technician_id === user.id) toast.success("Foi-lhe atribuído um atendimento", { action: { label: "Abrir", onClick: () => nav(`/crm/atendimentos/${d.session_id}`) } });
  });
  useSocketEvent("reset:requested", (d) => isAdmin && toast.warning(`Pedido de recuperação de palavra-passe: ${d.email}`));
  useSocketEvent("connect", () => setConnected(true));
  useSocketEvent("disconnect", () => setConnected(false));

  const doLogout = async () => { await logout(); nav("/crm/login"); };

  const items = NAV.filter((n) => !n.admin || isAdmin);
  const sidebar = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} data-testid={`crm-nav-${n.id}`} onClick={() => setMenu(false)}
          className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "bg-lime-500 text-[#0b0f17]" : "text-slate-300 hover:bg-[#1d283a]"}`}>
          <n.icon className="h-5 w-5" /> {n.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-[#0b0f17] text-white">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-[#1e293b] bg-[#111827] transition-transform lg:static lg:translate-x-0 ${menu ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-3 border-b border-[#1e293b] p-4">
          <Logo className="h-12 w-12 rounded-lg" testId="crm-logo" />
          <div className="leading-tight">
            <p className="font-display text-sm font-bold">APP DE SUPORTE</p>
            <p className="text-xs text-lime-400">TÉCNICO · Crypto Conex</p>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setMenu(false)} aria-label="Fechar menu"><X /></button>
        </div>
        {sidebar}
        <div className="border-t border-[#1e293b] p-4"><Credits /></div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[#1e293b] bg-[#0b0f17]/90 px-4 py-3 backdrop-blur sm:px-6">
          <button className="lg:hidden" onClick={() => setMenu(true)} aria-label="Abrir menu" data-testid="crm-menu-btn"><Menu /></button>
          <LisbonClock />
          <span data-testid="crm-realtime-status" className={`hidden items-center gap-1.5 text-xs sm:flex ${connected && socket ? "text-lime-400" : "text-amber-400"}`}>
            <span className={`h-2 w-2 rounded-full ${connected && socket ? "bg-lime-400" : "bg-amber-400"}`} /> {connected && socket ? "Tempo real ligado" : "A ligar…"}
          </span>
          <div className="ml-auto flex items-center gap-4">
            <Counters />
            <div className="hidden text-right sm:block">
              <p data-testid="crm-user-name" className="text-sm font-semibold">{user.name}</p>
              <p className="text-xs text-slate-400">{isAdmin ? "Super Admin" : "Técnico"}</p>
            </div>
            <button data-testid="crm-change-password-btn" onClick={() => setPwOpen(true)} title="Alterar palavra-passe" className="rounded-lg border border-[#27354a] p-2 hover:border-lime-500"><KeyRound className="h-4 w-4" /></button>
            <button data-testid="crm-logout-btn" onClick={doLogout} title="Sair" className="rounded-lg border border-[#27354a] p-2 hover:border-red-500 hover:text-red-400"><LogOut className="h-4 w-4" /></button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6"><Outlet /></main>
        <footer className="border-t border-[#1e293b] px-6 py-3 lg:hidden"><Credits /></footer>
      </div>
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
