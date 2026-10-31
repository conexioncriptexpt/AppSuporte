import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { http, errMsg } from "../../lib/api";
import { Logo } from "../../components/Brand";

export default function ResetPassword() {
  const { token } = useParams();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) { setErr("As palavras-passe não coincidem"); return; }
    try {
      await http.post("/auth/reset", { token, new_password: pw });
      toast.success("Palavra-passe alterada. Pode entrar.");
      nav("/crm/login");
    } catch (e2) { setErr(errMsg(e2)); }
  };
  const input = "mt-1 w-full rounded-xl border border-[#27354a] bg-[#0b0f17] px-4 py-3 text-white outline-none focus:border-lime-500";
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b0f17] px-5">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-[#27354a] bg-[#111827] p-8">
        <Logo className="mx-auto h-20 w-20 rounded-xl" />
        <h1 className="mt-4 text-center text-xl font-bold">Definir nova palavra-passe</h1>
        <label className="mt-6 block text-sm text-slate-300">Nova palavra-passe (mín. 10 caracteres)
          <input data-testid="reset-password-input" type="password" minLength={10} required value={pw} onChange={(e) => setPw(e.target.value)} className={input} />
        </label>
        <label className="mt-4 block text-sm text-slate-300">Repetir palavra-passe
          <input data-testid="reset-password-confirm-input" type="password" minLength={10} required value={pw2} onChange={(e) => setPw2(e.target.value)} className={input} />
        </label>
        {err && <p role="alert" className="mt-3 text-sm text-red-400">{err}</p>}
        <button data-testid="reset-password-submit-btn" className="mt-6 w-full rounded-xl bg-lime-500 py-3 font-bold text-[#0b0f17] hover:bg-lime-400">Guardar</button>
      </form>
    </main>
  );
}
