import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { MonitorUp, ShieldCheck, Volume2, VolumeX, UserRound } from "lucide-react";
import { API } from "../../lib/api";
import { detectOS } from "../../lib/format";
import { Logo } from "../../components/Brand";
import { useAssist } from "./useAssist";
import { ActivePanel, PrivacyOverlay } from "./ActivePanel";
import { DownloadButton } from "./DownloadButton";

export default function ConnectPage() {
  const { code } = useParams();
  const [cfg, setCfg] = useState(null);
  const [sound, setSound] = useState(localStorage.getItem("cc_sound") !== "off");
  const os = detectOS();
  const a = useAssist(code, sound);

  useEffect(() => {
    fetch(`${API}/public/config${code ? `?code=${encodeURIComponent(code)}` : ""}`).then((r) => r.json()).then(setCfg).catch(() => setCfg({}));
  }, [code]);

  const toggleSound = () => { localStorage.setItem("cc_sound", sound ? "off" : "on"); setSound(!sound); };
  const link = cfg?.link;
  const inSession = ["waiting", "active", "ended"].includes(a.phase);

  return (
    <main className="cc-grain flex min-h-screen flex-col bg-[#0b0f17] text-white">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Logo className="h-14 w-14 rounded-xl sm:h-16 sm:w-16" testId="public-logo" />
        <button data-testid="public-sound-toggle" onClick={toggleSound} aria-label={sound ? "Desligar som" : "Ligar som"}
          className="flex items-center gap-2 rounded-xl border border-[#27354a] px-3 py-2 text-sm text-slate-300 hover:border-lime-500">
          {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />} Som {sound ? "ligado" : "desligado"}
        </button>
      </header>

      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 pb-10">
        {!inSession ? (
          <div className="cc-rise text-center">
            <Logo className="mx-auto mb-6 h-40 w-40 rounded-3xl sm:h-48 sm:w-48" testId="public-hero-logo" />
            <h1 data-testid="public-title" className="text-3xl font-extrabold tracking-tight sm:text-5xl">Bem-vindo ao APP DE SUPORTE TÉCNICO</h1>
            <p className="mt-3 text-lg font-medium text-slate-300 sm:text-2xl">Vamos ajudar-te a resolver o teu problema</p>

            {link && (
              <p data-testid="public-link-info" className={`mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-base ${link.valid ? "bg-lime-500/10 text-lime-300" : "bg-red-500/10 text-red-300"}`}>
                <UserRound className="h-5 w-5" aria-hidden />
                {link.valid ? `O teu técnico: ${link.technician_name}` : "Este link expirou. Podes pedir ajuda na mesma."}
              </p>
            )}

            <button data-testid="public-connect-btn" onClick={() => a.start("")} disabled={a.phase === "starting"}
              className="cc-pulse mx-auto mt-10 flex w-full max-w-sm items-center justify-center gap-3 rounded-3xl bg-lime-500 px-10 py-7 text-3xl font-black tracking-wide text-[#0b0f17] transition-transform hover:scale-[1.02] hover:bg-lime-400 active:scale-95 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-8 focus-visible:ring-lime-500/40">
              <MonitorUp className="h-9 w-9" aria-hidden /> {a.phase === "starting" ? "A LIGAR…" : "CONECTAR"}
            </button>

            {a.error && <p data-testid="public-error" role="alert" className="mt-4 text-base font-semibold text-red-300">{a.error}</p>}
            {a.phase === "unsupported" && (
              <p data-testid="public-unsupported" role="alert" className="mt-4 rounded-xl bg-amber-500/10 px-4 py-3 text-base text-amber-200">
                Este navegador não permite partilhar o ecrã. Descarrega a aplicação abaixo — é só um toque.
              </p>
            )}

            <div className="mx-auto mt-5 max-w-sm"><DownloadButton os={os} cfg={cfg} /></div>

            <p data-testid="public-privacy-note" className="mx-auto mt-6 flex max-w-sm items-start gap-2 text-left text-sm text-slate-400">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-lime-400" aria-hidden />
              A tua privacidade é importante. A partilha do ecrã só começa depois da tua autorização.
            </p>
          </div>
        ) : (
          <ActivePanel a={a} />
        )}
      </section>
      {a.privacy && a.phase === "active" && <PrivacyOverlay a={a} />}
    </main>
  );
}
