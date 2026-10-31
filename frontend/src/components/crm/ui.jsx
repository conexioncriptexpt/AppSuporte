import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { http, errMsg } from "../../lib/api";
import { STATUS_LABEL } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

export const Card = ({ children, className = "", ...p }) => (
  <div className={`rounded-2xl border border-[#27354a] bg-[#161e2e] ${className}`} {...p}>{children}</div>
);

export const PageTitle = ({ title, subtitle, children }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
    </div>
    {children}
  </div>
);

const BADGE = {
  pending: "bg-amber-500/15 text-amber-300", assigned: "bg-sky-500/15 text-sky-300",
  active: "bg-lime-500/15 text-lime-300", ended: "bg-slate-500/15 text-slate-300",
};
export const StatusBadge = ({ status }) => (
  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[status] || BADGE.ended}`}>{STATUS_LABEL[status] || status}</span>
);

export const Btn = ({ variant = "primary", className = "", ...p }) => {
  const v = {
    primary: "bg-lime-500 text-[#0b0f17] hover:bg-lime-400",
    ghost: "border border-[#27354a] text-slate-200 hover:border-lime-500",
    danger: "border border-red-500/50 text-red-300 hover:bg-red-600 hover:text-white",
  }[variant];
  return <button className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${v} ${className}`} {...p} />;
};

export const inputCls = "w-full rounded-lg border border-[#27354a] bg-[#0b0f17] px-3 py-2 text-sm text-white outline-none focus:border-lime-500";

const TechPicker = ({ open, onClose, onPick, title }) => {
  const [techs, setTechs] = useState([]);
  useEffect(() => {
    if (open) http.get("/technicians").then((r) => setTechs(r.data)).catch(() => {});
  }, [open]);
  const label = { disponivel: "Disponível", ocupado: "Ocupado", offline: "Offline" };
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="border-[#27354a] bg-[#111827] text-white">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-2" data-testid="tech-picker-list">
          {techs.map((t) => (
            <button key={t.id} data-testid={`tech-pick-${t.id}`} onClick={() => onPick(t.id)}
              className="flex items-center justify-between rounded-lg border border-[#27354a] px-3 py-2 text-left hover:border-lime-500">
              <span>{t.name} {t.role === "super_admin" && <span className="text-xs text-slate-400">(Super Admin)</span>}</span>
              <span className={`text-xs ${t.state === "disponivel" ? "text-lime-400" : t.state === "ocupado" ? "text-amber-400" : "text-slate-500"}`}>{label[t.state]}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const SessionActions = ({ s, onDone, compact }) => {
  const { user, isAdmin } = useAuth();
  const nav = useNavigate();
  const [pick, setPick] = useState(null);
  const act = async (path, body, msg) => {
    try { await http.post(`/sessions/${s.id}/${path}`, body); toast.success(msg); onDone?.(); } catch (e) { toast.error(errMsg(e)); }
  };
  const mine = s.technician_id === user.id;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {s.status === "pending" && isAdmin && <Btn data-testid={`assign-btn-${s.id}`} onClick={() => setPick("assign")}>Atribuir</Btn>}
      {s.status === "pending" && (isAdmin || s.target_technician_id === user.id) && (
        <Btn data-testid={`take-btn-${s.id}`} variant={isAdmin ? "ghost" : "primary"} onClick={async () => { await act("take", {}, "Atendimento atribuído a si"); nav(`/crm/atendimentos/${s.id}`); }}>Atender eu</Btn>
      )}
      {(mine || isAdmin) && ["assigned", "active"].includes(s.status) && (
        <Btn data-testid={`open-btn-${s.id}`} onClick={() => nav(`/crm/atendimentos/${s.id}`)}>Abrir</Btn>
      )}
      {!compact && (mine || isAdmin) && ["assigned", "active"].includes(s.status) && (
        <Btn data-testid={`transfer-btn-${s.id}`} variant="ghost" onClick={() => setPick("transfer")}>Transferir</Btn>
      )}
      {s.status === "pending" && isAdmin && <Btn data-testid={`discard-btn-${s.id}`} variant="danger" onClick={() => act("discard", {}, "Pedido descartado")}>Descartar</Btn>}
      {!compact && (mine || isAdmin) && ["assigned", "active"].includes(s.status) && (
        <Btn data-testid={`end-btn-${s.id}`} variant="danger" onClick={() => act("end", {}, "Sessão terminada")}>Terminar</Btn>
      )}
      <TechPicker open={!!pick} onClose={() => setPick(null)} title={pick === "transfer" ? "Transferir para…" : "Atribuir a…"}
        onPick={(tid) => { act(pick, { technician_id: tid }, pick === "transfer" ? "Atendimento transferido" : "Atendimento atribuído"); setPick(null); }} />
    </div>
  );
};
