import { useCallback, useEffect, useState } from "react";
import { Radio, MonitorPlay, Loader2 } from "lucide-react";
import { http } from "../../lib/api";
import { since, PLATFORM_LABEL } from "../../lib/format";
import { useAuth, useSocketEvent } from "../../context/AuthContext";
import { Card, StatusBadge, SessionActions, Btn } from "../../components/crm/ui";
import { useViewer } from "./useViewer";
import { Stage } from "./Viewer";
import { ConsolePanel } from "./ConsolePanel";

const DeviceList = ({ items, selected, onSelect, reload }) => (
  <Card className="flex flex-col p-4 xl:min-h-[70vh]">
    <div className="mb-3 flex items-center gap-2">
      <Radio className="h-4 w-4 text-lime-400" />
      <h2 className="font-semibold">Aparelhos ligados</h2>
      <span className="ml-auto font-mono text-xs text-slate-500" data-testid="console-device-count">{items.length}</span>
    </div>
    {items.length === 0 && <p data-testid="console-empty" className="py-8 text-center text-sm text-slate-500">Nenhum aparelho ligado de momento.</p>}
    <ul className="cc-scroll flex flex-col gap-2 overflow-y-auto">
      {items.map((s) => (
        <li key={s.id}>
          <button data-testid={`console-device-${s.id}`} onClick={() => onSelect(s.id)}
            className={`w-full rounded-xl border p-3 text-left transition-colors ${selected === s.id ? "border-lime-500 bg-lime-500/10" : "border-[#27354a] bg-[#111827] hover:border-slate-500"}`}>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${s.device_online ? "bg-lime-400" : "bg-slate-600"}`} />
              <p className="flex-1 truncate font-semibold">{s.client_name || s.device_name}</p>
              <StatusBadge status={s.status} />
            </div>
            <p className="mt-1 text-xs text-slate-400">{PLATFORM_LABEL[s.platform]} · {since(s.created_at)}{s.technician_name ? ` · ${s.technician_name}` : ""}</p>
          </button>
          {selected === s.id && s.status === "pending" && <div className="mt-2"><SessionActions s={s} onDone={reload} onTaken={onSelect} compact /></div>}
        </li>
      ))}
    </ul>
  </Card>
);

const LiveView = ({ id }) => {
  const { user } = useAuth();
  const v = useViewer(id);
  const s = v.s;
  if (!s) return <Card className="flex min-h-[70vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-lime-400" /></Card>;
  const active = s.status === "active";
  const canControl = active && s.platform !== "browser" && s.consent?.control && user.permissions?.control;
  return (
    <>
      <Card className="flex min-h-[70vh] min-w-0 flex-col p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <MonitorPlay className="h-4 w-4 text-lime-400" />
          <h2 className="font-semibold">Visualizador ao Vivo</h2>
          <span className="truncate text-sm text-slate-400">· {s.client_name || s.device_name}</span>
          {s.privacy && <span data-testid="console-privacy-badge" className="rounded-full bg-lime-500/15 px-2 py-0.5 text-xs text-lime-300">Privacidade ativa</span>}
          <span className="ml-auto font-mono text-xs text-slate-500" data-testid="console-rtc-state">{v.rtc} · {v.quality.fps || 0} fps · {v.quality.rtt ?? "—"} ms</span>
        </div>
        {s.status === "assigned" && s.technician_id === user.id && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#27354a] p-3 text-sm">
            <span className="flex-1">Pedido atribuído a si.</span>
            <Btn data-testid="console-accept-btn" onClick={v.accept}>Aceitar</Btn>
            <Btn variant="danger" data-testid="console-reject-btn" onClick={v.reject}>Rejeitar</Btn>
          </div>
        )}
        <Stage v={v} zoom={1} control={!!canControl} />
      </Card>
      <ConsolePanel v={v} canControl={!!canControl} />
    </>
  );
};

export default function LiveConsole() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const load = useCallback(() => {
    http.get("/sessions", { params: { scope: "active" } }).then((r) => setItems(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocketEvent("queue:changed", load);
  useSocketEvent("device:online", load);
  useSocketEvent("device:offline", load);
  const { user, isAdmin } = useAuth();
  const sel = items.find((s) => s.id === selected);
  const viewable = sel && (isAdmin || sel.technician_id === user.id) && sel.status !== "pending";

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]" data-testid="live-console">
      <DeviceList items={items} selected={selected} onSelect={setSelected} reload={load} />
      {viewable ? <LiveView key={selected} id={selected} /> : (
        <>
          <Card className="flex min-h-[70vh] flex-col p-4">
            <div className="mb-3 flex items-center gap-2"><MonitorPlay className="h-4 w-4 text-lime-400" /><h2 className="font-semibold">Visualizador ao Vivo</h2></div>
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl bg-black text-sm text-slate-500" data-testid="console-placeholder">
              {sel?.status === "pending" ? "Atribua ou atenda este pedido para ver o ecrã." : "Selecione um aparelho ligado"}
            </div>
          </Card>
          <ConsolePanel v={null} canControl={false} />
        </>
      )}
    </div>
  );
}
