import { useCallback, useEffect, useState } from "react";
import { http } from "../../lib/api";
import { fmtDateTime, fmtDuration, PLATFORM_LABEL } from "../../lib/format";
import { useSocketEvent } from "../../context/AuthContext";
import { Card, PageTitle, StatusBadge, SessionActions } from "../../components/crm/ui";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";

export default function Sessions() {
  const [scope, setScope] = useState("active");
  const [items, setItems] = useState([]);
  const load = useCallback(() => {
    http.get("/sessions", { params: { scope } }).then((r) => setItems(r.data)).catch(() => {});
  }, [scope]);
  useEffect(() => { load(); }, [load]);
  useSocketEvent("queue:changed", load);

  return (
    <div>
      <PageTitle title="Atendimentos" subtitle="Pedidos, sessões em curso e histórico">
        <Tabs value={scope} onValueChange={setScope}>
          <TabsList className="bg-[#111827]">
            <TabsTrigger data-testid="sessions-tab-active" value="active">Em curso</TabsTrigger>
            <TabsTrigger data-testid="sessions-tab-history" value="history">Histórico</TabsTrigger>
          </TabsList>
        </Tabs>
      </PageTitle>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm" data-testid="sessions-table">
          <thead className="text-left text-xs uppercase tracking-wider text-slate-400">
            <tr className="border-b border-[#27354a]">
              <th className="p-3">Cliente / Dispositivo</th><th className="p-3">Técnico</th><th className="p-3">Estado</th>
              <th className="p-3">Início</th><th className="p-3">{scope === "history" ? "Fim" : "Pedido"}</th><th className="p-3">Duração</th>
              <th className="p-3">Autorização</th><th className="p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-500">Sem registos.</td></tr>}
            {items.map((s) => (
              <tr key={s.id} data-testid={`session-row-${s.id}`} className="border-b border-[#1e293b] hover:bg-[#1d283a]/40">
                <td className="p-3">
                  <p className="font-semibold">{s.client_name || "—"}</p>
                  <p className="text-xs text-slate-400">{s.device_name} · {PLATFORM_LABEL[s.platform]}</p>
                  <p className="font-mono text-[10px] text-slate-600">{s.id.slice(0, 8)}</p>
                </td>
                <td className="p-3">{s.technician_name || <span className="text-slate-500">Por atribuir</span>}</td>
                <td className="p-3"><StatusBadge status={s.status} /></td>
                <td className="p-3">{fmtDateTime(s.started_at)}</td>
                <td className="p-3">{fmtDateTime(scope === "history" ? s.ended_at : s.created_at)}</td>
                <td className="p-3">{fmtDuration(s.duration_s)}</td>
                <td className="p-3 text-xs">
                  <p>Ecrã: <b className={s.consent?.screen ? "text-lime-400" : "text-slate-500"}>{s.consent?.screen ? "Sim" : "Não"}</b></p>
                  <p>Controlo: <b className={s.consent?.control ? "text-lime-400" : "text-slate-500"}>{s.consent?.control ? "Sim" : "Não"}</b></p>
                </td>
                <td className="p-3">{scope === "history" ? <span className="text-xs text-slate-500">{s.discarded ? "Descartado" : "Concluído"}</span> : <SessionActions s={s} onDone={load} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
