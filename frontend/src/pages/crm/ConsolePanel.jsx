import { useState } from "react";
import { Undo2, Home, MousePointerClick, ArrowUp, ArrowDown, Hand, ArrowLeft, ArrowRight, Layers, EyeOff, Eye, Keyboard, MessageSquare, ScanText, PhoneOff, Zap, ListTree, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { fmtTime } from "../../lib/format";
import { Card, Btn, inputCls } from "../../components/crm/ui";
import { http } from "../../lib/api";

const TABS = [["cmd", "Comandos", Zap], ["a11y", "Acessib.", ListTree], ["logs", "Logs", ScrollText]];

const NavBtn = ({ icon: Icon, label, onClick, disabled, id }) => (
  <button data-testid={`console-nav-${id}`} disabled={disabled} onClick={onClick}
    className="flex flex-col items-center gap-1 rounded-xl border border-[#27354a] bg-[#111827] py-3 text-xs text-slate-200 transition-colors hover:border-lime-500 disabled:opacity-40">
    <Icon className="h-4 w-4" />{label}
  </button>
);

const Commands = ({ v, canControl }) => {
  const { socket } = useAuth();
  const s = v?.s;
  const [w, h] = (s?.resolution || "1080x1920").split("x").map(Number);
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const cx = () => Math.min(1, Math.max(0, (Number(x) || w / 2) / w));
  const cy = () => Math.min(1, Math.max(0, (Number(y) || h / 2) / h));
  const cmd = (c) => v?.cmd(c);
  const active = s?.status === "active";
  const nav = [
    ["back", "Voltar", Undo2, () => cmd({ type: "back" })],
    ["home", "Início", Home, () => cmd({ type: "home" })],
    ["click", "Clique", MousePointerClick, () => cmd({ type: "tap", x: cx(), y: cy() })],
    ["up", "Cima", ArrowUp, () => cmd({ type: "scroll", x: 0.5, y: 0.5, dy: -1 })],
    ["down", "Baixo", ArrowDown, () => cmd({ type: "scroll", x: 0.5, y: 0.5, dy: 1 })],
    ["long", "Longo", Hand, () => cmd({ type: "right_click", x: cx(), y: cy() })],
    ["left", "Esq.", ArrowLeft, () => cmd({ type: "swipe", x1: 0.8, y1: 0.5, x2: 0.2, y2: 0.5, duration: 300 })],
    ["right", "Dir.", ArrowRight, () => cmd({ type: "swipe", x1: 0.2, y1: 0.5, x2: 0.8, y2: 0.5, duration: 300 })],
    ["recents", "Recentes", Layers, () => cmd({ type: "recents" })],
  ];
  const sendMsg = (e) => { e.preventDefault(); if (msg.trim() && s) { socket.emit("chat:message", { session_id: s.id, text: msg.trim() }); setMsg(""); toast.success("Mensagem enviada ao utilizador"); } };
  const sendText = (e) => { e.preventDefault(); if (text) { cmd({ type: "text", text }); setText(""); } };
  const end = async () => { try { await http.post(`/sessions/${s.id}/end`); v.load(); } catch { toast.error("Não foi possível terminar"); } };
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Navegação</p>
        <div className="grid grid-cols-3 gap-2">{nav.map(([id, l, I, fn]) => <NavBtn key={id} id={id} icon={I} label={l} onClick={fn} disabled={!canControl} />)}</div>
        {s && !canControl && active && <p className="mt-2 text-xs text-slate-500">{s.platform === "browser" ? "Ligado pelo navegador: só visualização." : "A aguardar autorização de controlo do cliente."}</p>}
      </div>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Modo de privacidade</p>
        {!s?.privacy ? (
          <button data-testid="console-privacy-btn" disabled={!active} onClick={() => v.emit("privacy:enable")}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 py-3 text-sm font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-40">
            <EyeOff className="h-4 w-4" /> ATIVAR MODO DE PRIVACIDADE
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Btn variant="ghost" data-testid="console-privacy-ask-btn" onClick={() => v.emit("privacy:request-disable")}>Pedir desativação</Btn>
            <Btn data-testid="console-privacy-off-btn" onClick={() => v.emit("privacy:disable")}><Eye className="h-4 w-4" /> Desativar</Btn>
          </div>
        )}
        <p className="mt-1 text-[11px] text-slate-500">O cliente vê «Ajuste Técnico — Aguarde...». No Windows e no navegador continua a ver o ecrã real; no Android o ecrã escuro também aparece na transmissão.</p>
      </div>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Coordenadas do clique (X, Y) · {w}x{h}</p>
        <div className="grid grid-cols-2 gap-2">
          <input data-testid="console-x-input" type="number" value={x} onChange={(e) => setX(e.target.value)} placeholder={String(Math.round(w / 2))} className={`${inputCls} font-mono`} />
          <input data-testid="console-y-input" type="number" value={y} onChange={(e) => setY(e.target.value)} placeholder={String(Math.round(h / 2))} className={`${inputCls} font-mono`} />
        </div>
      </div>
      <form onSubmit={sendText}>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Digitar texto no dispositivo</p>
        <div className="flex gap-2">
          <input data-testid="console-text-input" disabled={!canControl} value={text} onChange={(e) => setText(e.target.value)} placeholder="Texto…" className={inputCls} />
          <Btn data-testid="console-text-send" disabled={!canControl} type="submit" variant="ghost"><Keyboard className="h-4 w-4" /></Btn>
        </div>
      </form>
      <form onSubmit={sendMsg}>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Mensagem guiada ao utilizador</p>
        <div className="flex gap-2">
          <input data-testid="console-msg-input" disabled={!s || s.status === "ended"} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Ex: Toque no botão verde" className={inputCls} />
          <Btn data-testid="console-msg-send" disabled={!s || s.status === "ended"} type="submit"><MessageSquare className="h-4 w-4" /></Btn>
        </div>
      </form>
      {s && s.status !== "ended" && <Btn variant="danger" className="w-full py-2" data-testid="console-end-btn" onClick={end}><PhoneOff className="h-4 w-4" /> Terminar assistência</Btn>}
    </div>
  );
};

const A11y = ({ v }) => {
  const tree = v?.tree;
  return (
    <div>
      <Btn variant="ghost" className="mb-3 w-full" data-testid="console-a11y-read" disabled={v?.s?.status !== "active"} onClick={() => v.emit("accessibility:request")}><ScanText className="h-4 w-4" /> Ler ecrã</Btn>
      {!tree ? <p className="text-sm text-slate-500">Disponível na app Android com a ajuda por toque ativa.</p> : (
        <div className="cc-scroll max-h-[55vh] overflow-y-auto text-xs" data-testid="console-a11y-tree">
          <p className="mb-2 text-slate-400">{tree.package} · {(tree.nodes || []).length} elementos</p>
          {(tree.nodes || []).map((n, i) => (
            <p key={i} className="border-b border-[#1e293b] py-1" style={{ paddingLeft: (n.depth || 0) * 6 }}>
              <span className="text-lime-400">{n.role}</span> {n.text || n.desc}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

const Logs = ({ v }) => {
  const s = v?.s;
  const rows = [...(s?.operations || []).map((o) => ({ ...o, k: "op" })), ...(s?.messages || []).map((m) => ({ at: m.at, actor: m.author, text: `Mensagem: ${m.text}`, k: "msg" }))]
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <div className="cc-scroll max-h-[62vh] overflow-y-auto" data-testid="console-logs">
      {rows.length === 0 && <p className="text-sm text-slate-500">Sem registos.</p>}
      {rows.map((o, i) => (
        <p key={i} className="border-b border-[#1e293b] py-1.5 text-xs"><span className="font-mono text-slate-500">{fmtTime(o.at)}</span> <span className="text-lime-400">{o.actor}</span> — {o.text}</p>
      ))}
    </div>
  );
};

export const ConsolePanel = ({ v, canControl }) => {
  const [tab, setTab] = useState("cmd");
  return (
    <Card className="p-4">
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-[#0b0f17] p-1">
        {TABS.map(([id, l, I]) => (
          <button key={id} data-testid={`console-tab-${id}`} onClick={() => setTab(id)}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold ${tab === id ? "bg-lime-500 text-[#0b0f17]" : "text-slate-300 hover:text-white"}`}>
            <I className="h-4 w-4" />{l}
          </button>
        ))}
      </div>
      {tab === "cmd" && <Commands v={v} canControl={canControl} />}
      {tab === "a11y" && <A11y v={v} />}
      {tab === "logs" && <Logs v={v} />}
    </Card>
  );
};
