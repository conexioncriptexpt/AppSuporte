import { useCallback, useEffect, useState } from "react";
import { Copy, Plus, Ban } from "lucide-react";
import { toast } from "sonner";
import { http, errMsg } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { Btn, Card, PageTitle, inputCls } from "../../components/crm/ui";

const DAYS = [[1, "1 dia"], [7, "7 dias"], [30, "30 dias"], [90, "90 dias"], [0, "Sem validade"]];

export default function Links() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [techs, setTechs] = useState([]);
  const [tid, setTid] = useState("");
  const [days, setDays] = useState(30);
  const load = useCallback(() => { http.get("/links").then((r) => setItems(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    load();
    if (isAdmin) http.get("/technicians").then((r) => setTechs(r.data)).catch(() => {});
  }, [load, isAdmin]);

  const url = (code) => `${window.location.origin}/assistir/${code}`;
  const copy = async (code) => {
    try { await navigator.clipboard.writeText(url(code)); toast.success("Link copiado"); }
    catch { toast.info(url(code)); }
  };
  const create = async () => {
    try { const { data } = await http.post("/links", { technician_id: tid || null, days }); toast.success("Novo link criado"); load(); copy(data.code); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const revoke = async (id) => {
    try { await http.post(`/links/${id}/revoke`); toast.success("Link revogado"); load(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div>
      <PageTitle title="Links de Assistência" subtitle="Links pessoais para enviar aos clientes. O link apenas identifica o técnico — a partilha depende sempre da autorização do cliente." />
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        {isAdmin && (
          <label className="text-sm text-slate-300">Técnico
            <select data-testid="link-tech-select" value={tid} onChange={(e) => setTid(e.target.value)} className={`${inputCls} mt-1 w-56`}>
              <option value="">Eu próprio</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm text-slate-300">Validade
          <select data-testid="link-days-select" value={days} onChange={(e) => setDays(+e.target.value)} className={`${inputCls} mt-1 w-40`}>
            {DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <Btn data-testid="link-create-btn" onClick={create} className="py-2"><Plus className="h-4 w-4" /> Gerar novo link</Btn>
      </Card>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm" data-testid="links-table">
          <thead className="text-left text-xs uppercase tracking-wider text-slate-400">
            <tr className="border-b border-[#27354a]"><th className="p-3">Link</th><th className="p-3">Técnico</th><th className="p-3">Criado</th><th className="p-3">Validade</th><th className="p-3">Utilizações</th><th className="p-3">Estado</th><th className="p-3">Ações</th></tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-500">Ainda não há links. Gere o primeiro acima.</td></tr>}
            {items.map((l) => {
              const ok = !l.revoked && !l.expired;
              return (
                <tr key={l.id} data-testid={`link-row-${l.id}`} className="border-b border-[#1e293b]">
                  <td className="p-3 font-mono text-xs" data-testid={`link-url-${l.id}`}>{url(l.code)}</td>
                  <td className="p-3">{l.technician_name}</td>
                  <td className="p-3">{fmtDateTime(l.created_at)}</td>
                  <td className="p-3">{l.expires_at ? fmtDateTime(l.expires_at) : "Sem validade"}</td>
                  <td className="p-3">{l.uses}{l.last_used_at && <p className="text-xs text-slate-500">{fmtDateTime(l.last_used_at)}</p>}</td>
                  <td className="p-3"><span className={`text-xs font-semibold ${ok ? "text-lime-400" : "text-red-400"}`}>{l.revoked ? "Revogado" : l.expired ? "Expirado" : "Ativo"}</span></td>
                  <td className="p-3"><div className="flex gap-1.5">
                    <Btn variant="ghost" data-testid={`link-copy-${l.id}`} onClick={() => copy(l.code)} disabled={!ok}><Copy className="h-4 w-4" /> Copiar</Btn>
                    {ok && <Btn variant="danger" data-testid={`link-revoke-${l.id}`} onClick={() => revoke(l.id)}><Ban className="h-4 w-4" /> Revogar</Btn>}
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
