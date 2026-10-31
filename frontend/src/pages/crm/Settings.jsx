import { useCallback, useEffect, useState } from "react";
import { Plus, Wand2, Copy, Trash2, KeyRound, Activity, Link2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { http, errMsg } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { Btn, Card, PageTitle, inputCls } from "../../components/crm/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Switch } from "../../components/ui/switch";

const genPassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%*?";
  const a = new Uint32Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => chars[n % chars.length]).join("");
};
const PERMS = [["control", "Controlo remoto"], ["privacy", "Modo de privacidade"], ["accessibility", "Leitura de acessibilidade"]];
const STATE = { disponivel: ["Disponível", "text-lime-400"], ocupado: ["Ocupado", "text-amber-400"], offline: ["Offline", "text-slate-500"] };

const PwField = ({ value, onChange, testId }) => (
  <div className="flex gap-2">
    <input data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} font-mono`} placeholder="Mín. 10 caracteres" />
    <Btn variant="ghost" type="button" data-testid={`${testId}-generate`} onClick={() => onChange(genPassword())} title="Gerar"><Wand2 className="h-4 w-4" /></Btn>
    <Btn variant="ghost" type="button" onClick={() => { navigator.clipboard?.writeText(value); toast.success("Copiada"); }} title="Copiar"><Copy className="h-4 w-4" /></Btn>
  </div>
);

const UserDialog = ({ edit, onClose, onSaved }) => {
  const [f, setF] = useState({});
  useEffect(() => {
    if (edit) setF(edit.id ? { name: edit.name, email: edit.email, permissions: edit.permissions || {}, active: edit.active } : { name: "", email: "", password: genPassword(), permissions: { control: true, privacy: true, accessibility: true } });
  }, [edit]);
  const save = async () => {
    try {
      if (edit.id) await http.patch(`/users/${edit.id}`, { name: f.name, email: f.email, permissions: f.permissions, active: f.active });
      else await http.post("/users", f);
      toast.success(edit.id ? "Perfil atualizado" : "Técnico criado");
      onSaved(); onClose();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const isSuper = edit?.role === "super_admin";
  return (
    <Dialog open={!!edit} onOpenChange={onClose}>
      <DialogContent className="border-[#27354a] bg-[#111827] text-white">
        <DialogHeader><DialogTitle>{edit?.id ? "Editar perfil" : "Novo técnico"}</DialogTitle></DialogHeader>
        <label className="text-sm text-slate-300">Nome<input data-testid="user-name-input" value={f.name || ""} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></label>
        <label className="text-sm text-slate-300">Email<input data-testid="user-email-input" type="email" value={f.email || ""} onChange={(e) => setF({ ...f, email: e.target.value })} className={inputCls} /></label>
        {!edit?.id && <label className="text-sm text-slate-300">Palavra-passe inicial<PwField testId="user-password-input" value={f.password || ""} onChange={(v) => setF({ ...f, password: v })} /></label>}
        <div className="rounded-lg border border-[#27354a] p-3">
          <p className="mb-2 text-sm font-semibold">Permissões</p>
          {PERMS.map(([k, l]) => (
            <label key={k} className="flex items-center justify-between py-1 text-sm">{l}
              <Switch data-testid={`perm-${k}`} checked={!!f.permissions?.[k]} onCheckedChange={(v) => setF({ ...f, permissions: { ...f.permissions, [k]: v } })} />
            </label>
          ))}
          {edit?.id && !isSuper && (
            <label className="mt-2 flex items-center justify-between border-t border-[#27354a] pt-2 text-sm">Conta ativa
              <Switch data-testid="user-active-switch" checked={!!f.active} onCheckedChange={(v) => setF({ ...f, active: v })} />
            </label>
          )}
        </div>
        <Btn data-testid="user-save-btn" onClick={save} className="py-2">Guardar</Btn>
      </DialogContent>
    </Dialog>
  );
};

const PasswordDialog = ({ user, onClose }) => {
  const [pw, setPw] = useState("");
  const [link, setLink] = useState("");
  useEffect(() => { setPw(genPassword()); setLink(""); }, [user]);
  const save = async () => {
    try { await http.post(`/users/${user.id}/password`, { password: pw }); toast.success("Palavra-passe alterada. Sessões do técnico terminadas."); onClose(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const makeLink = async () => {
    try { const { data } = await http.post(`/users/${user.id}/reset-link`); setLink(`${window.location.origin}/crm/reset/${data.token}`); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Dialog open={!!user} onOpenChange={onClose}>
      <DialogContent className="border-[#27354a] bg-[#111827] text-white">
        <DialogHeader><DialogTitle>Palavra-passe — {user?.name}</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-400">Opção segura: gerar um link de recuperação (válido 1 hora) e enviá-lo ao técnico.</p>
        <Btn variant="ghost" data-testid="reset-link-generate" onClick={makeLink}><Link2 className="h-4 w-4" /> Gerar link de recuperação</Btn>
        {link && <div className="flex gap-2"><input readOnly data-testid="reset-link-value" value={link} className={`${inputCls} font-mono text-xs`} /><Btn variant="ghost" onClick={() => { navigator.clipboard?.writeText(link); toast.success("Copiado"); }}><Copy className="h-4 w-4" /></Btn></div>}
        <p className="mt-2 text-sm text-slate-400">Ou definir diretamente uma nova palavra-passe:</p>
        <PwField testId="set-password-input" value={pw} onChange={setPw} />
        <Btn data-testid="set-password-save" onClick={save} className="py-2">Definir palavra-passe</Btn>
      </DialogContent>
    </Dialog>
  );
};

const ActivityDialog = ({ user, onClose }) => {
  const [d, setD] = useState(null);
  useEffect(() => { if (user) http.get(`/users/${user.id}/activity`).then((r) => setD(r.data)).catch(() => {}); else setD(null); }, [user]);
  return (
    <Dialog open={!!user} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl border-[#27354a] bg-[#111827] text-white">
        <DialogHeader><DialogTitle>Atividade — {user?.name}</DialogTitle></DialogHeader>
        <div className="cc-scroll max-h-[60vh] overflow-y-auto text-sm" data-testid="user-activity-list">
          <p className="mb-2 text-slate-400">{d?.sessions?.length ?? 0} atendimentos recentes</p>
          {d?.logs?.map((l) => <p key={l.id} className="border-b border-[#1e293b] py-1"><span className="font-mono text-xs text-slate-500">{fmtDateTime(l.at)}</span> {l.action}</p>)}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Technicians = () => {
  const [users, setUsers] = useState([]);
  const [edit, setEdit] = useState(null);
  const [pw, setPw] = useState(null);
  const [act, setAct] = useState(null);
  const [del, setDel] = useState(null);
  const [resets, setResets] = useState([]);
  const load = useCallback(() => {
    http.get("/users").then((r) => setUsers(r.data)).catch(() => {});
    http.get("/reset-requests").then((r) => setResets(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  const doDelete = async () => {
    try { await http.delete(`/users/${del.id}`); toast.success("Técnico eliminado"); setDel(null); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <>
      {resets.length > 0 && (
        <Card className="mb-4 border-amber-500/40 p-4" data-testid="reset-requests">
          <p className="mb-2 text-sm font-semibold text-amber-300">Pedidos de recuperação de palavra-passe</p>
          {resets.map((r) => (
            <div key={r.user_id} className="flex items-center justify-between py-1 text-sm">
              <span>{r.name} · {r.email} · {fmtDateTime(r.at)}</span>
              <Btn variant="ghost" onClick={() => setPw(users.find((u) => u.id === r.user_id))}>Tratar</Btn>
            </div>
          ))}
        </Card>
      )}
      <div className="mb-3 flex justify-end"><Btn data-testid="user-create-btn" onClick={() => setEdit({})} className="py-2"><Plus className="h-4 w-4" /> Novo técnico</Btn></div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm" data-testid="users-table">
          <thead className="text-left text-xs uppercase tracking-wider text-slate-400">
            <tr className="border-b border-[#27354a]"><th className="p-3">Nome</th><th className="p-3">Perfil</th><th className="p-3">Estado</th><th className="p-3">Permissões</th><th className="p-3">Atendimentos</th><th className="p-3">Último login</th><th className="p-3">Ações</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} data-testid={`user-row-${u.id}`} className="border-b border-[#1e293b]">
                <td className="p-3"><p className="font-semibold">{u.name}</p><p className="text-xs text-slate-400">{u.email}</p></td>
                <td className="p-3">{u.role === "super_admin" ? "Super Admin" : "Técnico"}</td>
                <td className="p-3">{!u.active ? <span className="text-xs text-red-400">Desativada</span> : <span className={`text-xs ${STATE[u.state][1]}`}>{STATE[u.state][0]}</span>}</td>
                <td className="p-3 text-xs text-slate-300">{PERMS.filter(([k]) => u.permissions?.[k]).map(([, l]) => l).join(", ") || "—"}</td>
                <td className="p-3">{u.sessions_total}</td>
                <td className="p-3">{fmtDateTime(u.last_login)}</td>
                <td className="p-3"><div className="flex gap-1.5">
                  <Btn variant="ghost" data-testid={`user-edit-${u.id}`} onClick={() => setEdit(u)} title="Editar"><Pencil className="h-4 w-4" /></Btn>
                  <Btn variant="ghost" data-testid={`user-password-${u.id}`} onClick={() => setPw(u)} title="Palavra-passe"><KeyRound className="h-4 w-4" /></Btn>
                  <Btn variant="ghost" data-testid={`user-activity-${u.id}`} onClick={() => setAct(u)} title="Atividade"><Activity className="h-4 w-4" /></Btn>
                  {u.role !== "super_admin" && <Btn variant="danger" data-testid={`user-delete-${u.id}`} onClick={() => setDel(u)} title="Eliminar"><Trash2 className="h-4 w-4" /></Btn>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <UserDialog edit={edit} onClose={() => setEdit(null)} onSaved={load} />
      <PasswordDialog user={pw} onClose={() => { setPw(null); load(); }} />
      <ActivityDialog user={act} onClose={() => setAct(null)} />
      <Dialog open={!!del} onOpenChange={() => setDel(null)}>
        <DialogContent className="border-[#27354a] bg-[#111827] text-white">
          <DialogHeader><DialogTitle>Eliminar {del?.name}?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-300">Os links do técnico serão revogados. O histórico de atendimentos mantém-se.</p>
          <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setDel(null)}>Cancelar</Btn><Btn variant="danger" data-testid="user-delete-confirm" onClick={doDelete}>Eliminar</Btn></div>
        </DialogContent>
      </Dialog>
    </>
  );
};

const System = () => {
  const [s, setS] = useState(null);
  useEffect(() => { http.get("/settings").then((r) => setS(r.data)).catch(() => {}); }, []);
  if (!s) return null;
  const save = async () => {
    try {
      const { data } = await http.put("/settings", { retention_days: +s.retention_days, default_link_days: +s.default_link_days, sound_enabled: s.sound_enabled, github_repo: s.github_repo, android_download_url: s.android_download_url, windows_download_url: s.windows_download_url });
      setS(data); localStorage.setItem("cc_crm_sound", data.sound_enabled ? "on" : "off"); toast.success("Configurações guardadas");
    } catch (e) { toast.error(errMsg(e)); }
  };
  const F = ({ k, label, type = "text", hint }) => (
    <label className="block text-sm text-slate-300">{label}
      <input data-testid={`settings-${k}`} type={type} value={s[k] ?? ""} onChange={(e) => setS({ ...s, [k]: e.target.value })} className={`${inputCls} mt-1`} />
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
  return (
    <Card className="grid gap-4 p-5 md:grid-cols-2">
      {F({ k: "retention_days", label: "Retenção de dados (dias)", type: "number", hint: "Sessões terminadas e registos de auditoria mais antigos são eliminados." })}
      {F({ k: "default_link_days", label: "Validade padrão dos links (dias, 0 = sem validade)", type: "number" })}
      {F({ k: "github_repo", label: "Repositório GitHub (utilizador/repositório)", hint: "Os botões de download usam a última Release deste repositório." })}
      <label className="flex items-center justify-between rounded-lg border border-[#27354a] p-3 text-sm">Som de alerta de novos pedidos
        <Switch data-testid="settings-sound" checked={!!s.sound_enabled} onCheckedChange={(v) => setS({ ...s, sound_enabled: v })} />
      </label>
      {F({ k: "android_download_url", label: "URL alternativo do APK Android (opcional)" })}
      {F({ k: "windows_download_url", label: "URL alternativo do instalador Windows (opcional)" })}
      <div className="text-xs text-slate-400 md:col-span-2" data-testid="settings-downloads">
        <p>Android: <span className="font-mono">{s.downloads?.android || "não configurado"}</span></p>
        <p>Windows: <span className="font-mono">{s.downloads?.windows || "não configurado"}</span></p>
      </div>
      <Btn data-testid="settings-save-btn" onClick={save} className="py-2 md:col-span-2">Guardar configurações</Btn>
    </Card>
  );
};

const Audit = () => {
  const [logs, setLogs] = useState([]);
  useEffect(() => { http.get("/audit").then((r) => setLogs(r.data)).catch(() => {}); }, []);
  return (
    <Card className="cc-scroll max-h-[70vh] overflow-auto p-4" data-testid="audit-list">
      {logs.map((l) => (
        <div key={l.id} className="grid grid-cols-[150px_200px_1fr] gap-3 border-b border-[#1e293b] py-1.5 text-xs">
          <span className="font-mono text-slate-500">{fmtDateTime(l.at)}</span><span className="text-lime-400">{l.action}</span>
          <span className="truncate text-slate-400">{l.actor} {l.target && `→ ${l.target}`}</span>
        </div>
      ))}
    </Card>
  );
};

export default function Settings() {
  return (
    <div>
      <PageTitle title="Configurações" subtitle="Técnicos, permissões, sistema e auditoria" />
      <Tabs defaultValue="techs">
        <TabsList className="mb-4 bg-[#111827]">
          <TabsTrigger value="techs" data-testid="settings-tab-techs">Técnicos</TabsTrigger>
          <TabsTrigger value="system" data-testid="settings-tab-system">Sistema</TabsTrigger>
          <TabsTrigger value="audit" data-testid="settings-tab-audit">Auditoria</TabsTrigger>
        </TabsList>
        <TabsContent value="techs"><Technicians /></TabsContent>
        <TabsContent value="system"><System /></TabsContent>
        <TabsContent value="audit"><Audit /></TabsContent>
      </Tabs>
    </div>
  );
}
