import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { fmtDateTime, fmtTime, PLATFORM_LABEL } from "../../lib/format";
import { Card, inputCls } from "../../components/crm/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

const Row = ({ k, v, id }) => (
  <div className="flex justify-between gap-3 border-b border-[#1e293b] py-1.5 text-sm">
    <span className="text-slate-400">{k}</span><span data-testid={id} className="text-right font-medium">{v ?? "—"}</span>
  </div>
);

const Chat = ({ v }) => {
  const { socket } = useAuth();
  const [text, setText] = useState("");
  const end = useRef(null);
  const msgs = v.s.messages || [];
  useEffect(() => { end.current?.scrollIntoView(); }, [msgs.length]);
  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    socket.emit("chat:message", { session_id: v.s.id, text: text.trim() });
    setText("");
  };
  return (
    <div className="flex h-[52vh] flex-col">
      <div className="cc-scroll flex-1 overflow-y-auto pr-1" data-testid="viewer-chat-log">
        {msgs.length === 0 && <p className="text-sm text-slate-500">Sem mensagens.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`mb-2 flex ${m.from === "device" ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-1.5 text-sm ${m.from === "device" ? "bg-[#1d283a]" : "bg-lime-500 text-[#0b0f17]"}`}>
              <p className="text-[10px] opacity-70">{m.author} · {fmtTime(m.at)}</p>{m.text}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {v.s.status !== "ended" && (
        <form onSubmit={send} className="mt-2 flex gap-2">
          <input data-testid="viewer-chat-input" value={text} onChange={(e) => setText(e.target.value)} className={inputCls} placeholder="Mensagem ao cliente…" />
          <button data-testid="viewer-chat-send" className="rounded-lg bg-lime-500 px-3 text-[#0b0f17]" aria-label="Enviar"><Send className="h-4 w-4" /></button>
        </form>
      )}
    </div>
  );
};

const Tree = ({ tree }) => {
  if (!tree) return <p className="text-sm text-slate-500">Disponível na app Android com o serviço de acessibilidade ativo. Use "Ler ecrã".</p>;
  const nodes = tree.nodes || [];
  return (
    <div className="cc-scroll max-h-[48vh] overflow-y-auto text-xs" data-testid="viewer-a11y-tree">
      <p className="mb-2 text-slate-400">{tree.package} · {nodes.length} elementos</p>
      {nodes.map((n, i) => (
        <p key={i} className="border-b border-[#1e293b] py-1" style={{ paddingLeft: (n.depth || 0) * 8 }}>
          <span className="text-lime-400">{n.role || n.cls}</span> {n.text || n.desc || ""} {n.clickable && <span className="text-sky-400">[clicável]</span>} {n.editable && <span className="text-amber-400">[campo]</span>}
        </p>
      ))}
    </div>
  );
};

export const SidePanel = ({ v }) => {
  const s = v.s;
  const d = s.device || {};
  const q = v.quality;
  return (
    <Card className="p-4">
      <Tabs defaultValue="device">
        <TabsList className="grid w-full grid-cols-4 bg-[#0b0f17]">
          <TabsTrigger value="device" data-testid="viewer-tab-device">Dados</TabsTrigger>
          <TabsTrigger value="state" data-testid="viewer-tab-state">Estado</TabsTrigger>
          <TabsTrigger value="chat" data-testid="viewer-tab-chat">Chat</TabsTrigger>
          <TabsTrigger value="ops" data-testid="viewer-tab-ops">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="device" className="mt-3">
          <Row k="Cliente" v={s.client_name || "Não indicado"} id="viewer-client-name" />
          <Row k="Dispositivo" v={s.device_name} id="viewer-device-name" />
          <Row k="Plataforma" v={PLATFORM_LABEL[s.platform]} />
          <Row k="Sistema" v={`${d.os || ""} ${d.os_version || ""}`} />
          <Row k="Resolução" v={s.resolution || (q.w ? `${q.w}x${q.h}` : "—")} id="viewer-resolution" />
          <Row k="Primeiro contacto" v={fmtDateTime(d.first_seen)} />
          <Row k="Técnico" v={s.technician_name || "Por atribuir"} id="viewer-technician" />
          <Row k="Pedido" v={fmtDateTime(s.created_at)} />
          <Row k="Início" v={fmtDateTime(s.started_at)} />
          <Row k="Fim" v={fmtDateTime(s.ended_at)} />
          <Row k="ID sessão" v={<span className="font-mono text-xs">{s.id.slice(0, 13)}</span>} />
        </TabsContent>
        <TabsContent value="state" className="mt-3">
          <Row k="Estado da sessão" v={s.status} id="viewer-session-status" />
          <Row k="Ligação do cliente" v={s.connection_state} id="viewer-connection-state" />
          <Row k="WebRTC" v={v.rtc} />
          <Row k="Latência" v={q.rtt != null ? `${q.rtt} ms` : "—"} id="viewer-rtt" />
          <Row k="Débito" v={q.kbps ? `${q.kbps} kbps` : "—"} id="viewer-kbps" />
          <Row k="Imagens/s" v={q.fps || "—"} id="viewer-fps" />
          <Row k="Ecrã autorizado" v={s.consent?.screen ? "Sim" : "Não"} id="viewer-consent-screen" />
          <Row k="Controlo autorizado" v={s.consent?.control ? "Sim" : "Não"} id="viewer-consent-control" />
          <Row k="Privacidade" v={s.privacy ? "Ativa" : "Inativa"} />
          <h3 className="mb-1 mt-4 text-sm font-semibold">Acessibilidade</h3>
          <Tree tree={v.tree} />
        </TabsContent>
        <TabsContent value="chat" className="mt-3"><Chat v={v} /></TabsContent>
        <TabsContent value="ops" className="mt-3">
          <div className="cc-scroll max-h-[55vh] overflow-y-auto" data-testid="viewer-ops-log">
            {[...(s.operations || [])].reverse().map((o, i) => (
              <div key={i} className="border-b border-[#1e293b] py-1.5 text-xs">
                <span className="font-mono text-slate-500">{fmtTime(o.at)}</span> <span className="text-lime-400">{o.actor}</span> — {o.text}
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
};
