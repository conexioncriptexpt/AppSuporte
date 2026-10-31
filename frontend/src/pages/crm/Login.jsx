import { useState } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { http, errMsg } from "../../lib/api";
import { Logo, LisbonClock, Credits } from "../../components/Brand";

export default function Login() {
  const { login, user, ready } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [err, setErr] = useState("");

  if (ready && user) return <Navigate to="/crm/consola" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      if (forgot) {
        const { data } = await http.post("/auth/forgot", { email });
        toast.success(data.message);
        setForgot(false);
      } else {
        await login(email.trim(), password);
        nav("/crm/consola");
      }
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };

  const input = "mt-1 w-full rounded-xl border border-[#27354a] bg-[#0b0f17] px-4 py-3 text-white outline-none focus:border-lime-500";
  return (
    <main className="cc-grain flex min-h-screen flex-col bg-[#0b0f17]">
      <div className="flex justify-end p-5"><LisbonClock /></div>
      <div className="flex flex-1 items-center justify-center px-5">
        <form onSubmit={submit} className="cc-rise w-full max-w-md rounded-3xl border border-[#27354a] bg-[#111827] p-8" data-testid="crm-login-form">
          <Logo className="mx-auto h-28 w-28 rounded-2xl" />
          <h1 className="mt-4 text-center text-2xl font-bold">Painel de Gestão</h1>
          <p className="mb-6 text-center text-sm text-slate-400">{forgot ? "Recuperar palavra-passe" : "Acesso reservado a técnicos autorizados"}</p>
          <label className="block text-sm text-slate-300">Email
            <input data-testid="crm-login-email-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoComplete="username" />
          </label>
          {!forgot && (
            <label className="mt-4 block text-sm text-slate-300">Palavra-passe
              <input data-testid="crm-login-password-input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} autoComplete="current-password" />
            </label>
          )}
          {err && <p data-testid="crm-login-error" role="alert" className="mt-3 text-sm text-red-400">{err}</p>}
          <button data-testid="crm-login-submit-btn" disabled={busy} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-lime-500 py-3 text-base font-bold text-[#0b0f17] hover:bg-lime-400 disabled:opacity-60">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />} {forgot ? "Pedir recuperação" : "Entrar"}
          </button>
          <button type="button" data-testid="crm-forgot-toggle" onClick={() => { setForgot(!forgot); setErr(""); }} className="mt-4 w-full text-center text-sm text-lime-400 hover:underline">
            {forgot ? "Voltar ao login" : "Esqueci-me da palavra-passe"}
          </button>
          <Link to="/" className="mt-2 block text-center text-xs text-slate-500 hover:text-slate-300">Página pública de assistência</Link>
        </form>
      </div>
      <div className="p-4 text-center"><Credits /></div>
    </main>
  );
}
