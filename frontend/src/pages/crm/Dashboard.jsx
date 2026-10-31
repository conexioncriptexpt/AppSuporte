import { useCallback, useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MonitorSmartphone, Wifi, Clock, Headset, UserCheck, UserX, History, Timer } from "lucide-react";
import { http } from "../../lib/api";
import { fmtDuration, since, PLATFORM_LABEL } from "../../lib/format";
import { useSocketEvent } from "../../context/AuthContext";
import { Card, PageTitle, StatusBadge, SessionActions } from "../../components/crm/ui";

const Stat = ({ icon: Icon, label, value, accent, id }) => (
  <Card className="p-4">
    <div className="flex items-center justify-between">
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <Icon className={`h-5 w-5 ${accent ? "text-lime-400" : "text-slate-500"}`} />
    </div>
    <p data-testid={`stat-${id}`} className={`mt-2 font-display text-3xl font-bold ${accent ? "text-lime-400" : "text-white"}`}>{value}</p>
  </Card>
);

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [queue, setQueue] = useState([]);
  const load = useCallback(() => {
    http.get("/dashboard").then((r) => setD(r.data)).catch(() => {});
    http.get("/sessions", { params: { scope: "active" } }).then((r) => setQueue(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocketEvent("queue:changed", load);
  useSocketEvent("device:online", load);
  useSocketEvent("device:offline", load);
  useSocketEvent("technicians:changed", load);
  useEffect(() => {
    const i = setInterval(() => setQueue((q) => [...q]), 15000);
    return () => clearInterval(i);
  }, []);

  return (
    <div>
      <PageTitle title="Dashboard" subtitle="Visão geral da assistência em tempo real" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat id="devices-total" icon={MonitorSmartphone} label="Dispositivos registados" value={d?.devices_total ?? "—"} />
        <Stat id="devices-online" icon={Wifi} label="Ligados agora" value={d?.devices_online ?? "—"} accent />
        <Stat id="pending" icon={Clock} label="Pedidos pendentes" value={d?.pending ?? "—"} accent={d?.pending > 0} />
        <Stat id="active" icon={Headset} label="Atendimentos ativos" value={d?.active ?? "—"} accent />
        <Stat id="techs-available" icon={UserCheck} label="Técnicos disponíveis" value={d?.techs_available ?? "—"} />
        <Stat id="techs-busy" icon={UserX} label="Técnicos ocupados" value={d?.techs_busy ?? "—"} />
        <Stat id="history" icon={History} label="Atendimentos concluídos" value={d?.history_total ?? "—"} />
        <Stat id="avg-duration" icon={Timer} label="Duração média" value={fmtDuration(d?.avg_duration_s)} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-5">
        <Card className="p-5 xl:col-span-3" data-testid="dashboard-queue">
          <div className="mb-4 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-lime-400 animate-pulse" />
            <h2 className="text-lg font-semibold">Fila de pedidos em tempo real</h2>
          </div>
          {queue.length === 0 && <p data-testid="queue-empty" className="py-10 text-center text-sm text-slate-500">Sem pedidos neste momento. Os novos pedidos aparecem aqui assim que o cliente carregar em CONECTAR.</p>}
          <ul className="flex flex-col gap-2">
            {queue.map((s) => (
              <li key={s.id} data-testid="crm-queue-item" className="flex flex-wrap items-center gap-3 rounded-xl border border-[#27354a] bg-[#111827] p-3">
                <span className={`h-2.5 w-2.5 rounded-full ${s.device_online ? "bg-lime-400" : "bg-slate-600"}`} title={s.device_online ? "Online" : "Offline"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{s.client_name || s.device_name}</p>
                  <p className="text-xs text-slate-400">{PLATFORM_LABEL[s.platform]} · {since(s.created_at)} {s.technician_name ? `· ${s.technician_name}` : ""}</p>
                </div>
                <StatusBadge status={s.status} />
                <SessionActions s={s} onDone={load} compact />
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5 xl:col-span-2">
          <h2 className="mb-4 text-lg font-semibold">Atendimentos — últimos 7 dias</h2>
          <div className="h-64" data-testid="dashboard-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d?.chart || []}>
                <defs>
                  <linearGradient id="lime" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#84cc16" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#84cc16" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" fontSize={12} />
                <YAxis allowDecimals={false} stroke="#64748b" fontSize={12} width={30} />
                <Tooltip contentStyle={{ background: "#111827", border: "1px solid #27354a", borderRadius: 8 }} labelStyle={{ color: "#fff" }} />
                <Area type="monotone" dataKey="total" name="Atendimentos" stroke="#84cc16" strokeWidth={2} fill="url(#lime)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
