import { useCallback, useEffect, useState } from "react";
import { Search, Pencil, Trash2, History } from "lucide-react";
import { toast } from "sonner";
import { http, errMsg } from "../../lib/api";
import { fmtDateTime, fmtDuration, PLATFORM_LABEL } from "../../lib/format";
import { useAuth, useSocketEvent } from "../../context/AuthContext";
import { Btn, Card, PageTitle, StatusBadge, inputCls } from "../../components/crm/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";

const HistoryDialog = ({ id, onClose }) => {
  const [d, setD] = useState(null);
  useEffect(() => { if (id) http.get(`/devices/${id}`).then((r) => setD(r.data)).catch(() => {}); else setD(null); }, [id]);
  return (
    <Dialog open={!!id} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl border-[#27354a] bg-[#111827] text-white">
        <DialogHeader><DialogTitle>Histórico — {d?.name}</DialogTitle></DialogHeader>
        <div className="cc-scroll max-h-[60vh] overflow-y-auto" data-testid="device-history-list">
          {d?.sessions?.length === 0 && <p className="text-sm text-slate-500">Sem sessões.</p>}
          {d?.sessions?.map((s) => (
            <div key={s.id} className="flex items-center justify-between border-b border-[#1e293b] py-2 text-sm">
              <span>{fmtDateTime(s.created_at)} · {s.technician_name || "—"}</span>
              <span className="flex items-center gap-2">{fmtDuration(s.duration_s)} <StatusBadge status={s.status} /></span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default function Devices() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [os, setOs] = useState("");
  const [status, setStatus] = useState("");
  const [rename, setRename] = useState(null);
  const [del, setDel] = useState(null);
  const [hist, setHist] = useState(null);

  const load = useCallback(() => {
    http.get("/devices", { params: { q, os, status } }).then((r) => setItems(r.data)).catch(() => {});
  }, [q, os, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useSocketEvent("device:online", load);
  useSocketEvent("device:offline", load);

  const saveName = async () => {
    try { await http.patch(`/devices/${rename.id}`, { name: rename.name }); toast.success("Dispositivo renomeado"); setRename(null); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const doDelete = async () => {
    try { await http.delete(`/devices/${del.id}`); toast.success("Dispositivo eliminado"); setDel(null); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div>
      <PageTitle title="Dispositivos" subtitle="Equipamentos que já estabeleceram uma ligação autorizada" />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input data-testid="devices-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar por nome, cliente ou sistema" className={`${inputCls} pl-9`} />
        </div>
        <select data-testid="devices-os-filter" value={os} onChange={(e) => setOs(e.target.value)} className={`${inputCls} !w-44`}>
          <option value="">Todos os sistemas</option><option value="browser">Navegador</option><option value="android">Android</option><option value="windows">Windows</option>
        </select>
        <select data-testid="devices-status-filter" value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} !w-36`}>
          <option value="">Todos</option><option value="online">Online</option><option value="offline">Offline</option>
        </select>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm" data-testid="devices-table">
          <thead className="text-left text-xs uppercase tracking-wider text-slate-400">
            <tr className="border-b border-[#27354a]">
              <th className="p-3">Estado</th><th className="p-3">Nome</th><th className="p-3">Sistema</th><th className="p-3">Primeiro contacto</th>
              <th className="p-3">Última ligação</th><th className="p-3">Último técnico</th><th className="p-3">Sessões</th><th className="p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-500">Nenhum dispositivo encontrado.</td></tr>}
            {items.map((d) => (
              <tr key={d.id} data-testid={`device-row-${d.id}`} className="border-b border-[#1e293b] hover:bg-[#1d283a]/40">
                <td className="p-3"><span className={`inline-flex items-center gap-1.5 text-xs ${d.online ? "text-lime-400" : "text-slate-500"}`}><span className={`h-2 w-2 rounded-full ${d.online ? "bg-lime-400" : "bg-slate-600"}`} />{d.online ? "Online" : "Offline"}</span></td>
                <td className="p-3"><p className="font-semibold">{d.name}</p><p className="text-xs text-slate-400">{d.client_name}</p><p className="font-mono text-[10px] text-slate-600">{d.id.slice(0, 8)}</p></td>
                <td className="p-3">{PLATFORM_LABEL[d.platform]}<p className="text-xs text-slate-400">{d.os} {d.os_version}</p></td>
                <td className="p-3">{fmtDateTime(d.first_seen)}</td>
                <td className="p-3">{fmtDateTime(d.last_seen)}</td>
                <td className="p-3">{d.last_technician_name || "—"}</td>
                <td className="p-3">{d.sessions_total}</td>
                <td className="p-3">
                  <div className="flex gap-1.5">
                    <Btn variant="ghost" data-testid={`device-history-btn-${d.id}`} onClick={() => setHist(d.id)} title="Histórico"><History className="h-4 w-4" /></Btn>
                    <Btn variant="ghost" data-testid={`device-rename-btn-${d.id}`} onClick={() => setRename({ id: d.id, name: d.name })} title="Renomear"><Pencil className="h-4 w-4" /></Btn>
                    {isAdmin && <Btn variant="danger" data-testid={`device-delete-btn-${d.id}`} onClick={() => setDel(d)} title="Eliminar"><Trash2 className="h-4 w-4" /></Btn>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Dialog open={!!rename} onOpenChange={() => setRename(null)}>
        <DialogContent className="border-[#27354a] bg-[#111827] text-white">
          <DialogHeader><DialogTitle>Renomear dispositivo</DialogTitle></DialogHeader>
          <input data-testid="device-rename-input" value={rename?.name || ""} onChange={(e) => setRename({ ...rename, name: e.target.value })} className={inputCls} maxLength={80} />
          <Btn data-testid="device-rename-save" onClick={saveName}>Guardar</Btn>
        </DialogContent>
      </Dialog>
      <Dialog open={!!del} onOpenChange={() => setDel(null)}>
        <DialogContent className="border-[#27354a] bg-[#111827] text-white">
          <DialogHeader><DialogTitle>Eliminar dispositivo?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-300">"{del?.name}" será removido do CRM. O histórico de sessões mantém-se.</p>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setDel(null)}>Cancelar</Btn>
            <Btn variant="danger" data-testid="device-delete-confirm" onClick={doDelete}>Eliminar</Btn>
          </div>
        </DialogContent>
      </Dialog>
      <HistoryDialog id={hist} onClose={() => setHist(null)} />
    </div>
  );
}
