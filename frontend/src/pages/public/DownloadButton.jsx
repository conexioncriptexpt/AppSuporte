import { useState } from "react";
import { Download, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

const STEPS = {
  android: [
    "Abre o ficheiro CryptoConex.apk que acabou de descarregar (aparece nas notificações).",
    "Se o telemóvel pedir, toca em Definições e ativa \"Permitir desta fonte\".",
    "Toca em INSTALAR e depois em ABRIR.",
  ],
  windows: [
    "Abre o ficheiro CryptoConexSetup.exe que acabou de descarregar.",
    "Se aparecer \"O Windows protegeu o PC\", clica em Mais informações e depois em Executar mesmo assim.",
    "Clica em Instalar. A aplicação abre sozinha no fim.",
  ],
};

const Guide = ({ os, onClose }) => (
  <div data-testid="public-install-guide" role="dialog" aria-label="Como instalar" className="cc-rise mt-4 rounded-2xl border border-lime-500/40 bg-[#111827] p-5 text-left">
    <div className="mb-3 flex items-center justify-between">
      <p className="flex items-center gap-2 text-lg font-bold text-lime-300"><CheckCircle2 className="h-6 w-6" /> A descarregar…</p>
      <button onClick={onClose} aria-label="Fechar" data-testid="public-install-guide-close"><X className="h-5 w-5 text-slate-400" /></button>
    </div>
    <ol className="space-y-2 text-base text-slate-200">
      {STEPS[os].map((s, i) => (
        <li key={i} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lime-500 font-bold text-[#0b0f17]">{i + 1}</span>{s}</li>
      ))}
    </ol>
  </div>
);

export const DownloadButton = ({ os, cfg }) => {
  const [guide, setGuide] = useState(null);
  const target = os === "android" ? "android" : os === "windows" ? "windows" : null;
  const go = (k) => {
    const url = cfg?.downloads?.[k];
    if (!url || !cfg?.available?.[k]) { toast.info("A aplicação está a ser preparada. Por agora usa o botão CONECTAR."); return; }
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setGuide(k);
  };
  const cls = "w-full rounded-2xl border-2 border-slate-600 bg-transparent px-6 py-4 text-lg font-bold text-white transition-colors hover:border-lime-400 hover:text-lime-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-lime-500/40";
  return (
    <div>
      {target ? (
        <button data-testid="public-download-btn" onClick={() => go(target)} className={cls}>
          <Download className="mr-2 inline h-5 w-5" aria-hidden /> DESCARREGAR APLICAÇÃO
          <span className="block text-sm font-medium text-slate-400">{target === "android" ? "Para Android" : "Para Windows"}</span>
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <button data-testid="public-download-android-btn" onClick={() => go("android")} className={cls}><Download className="mr-1 inline h-5 w-5" aria-hidden /> Android</button>
          <button data-testid="public-download-windows-btn" onClick={() => go("windows")} className={cls}><Download className="mr-1 inline h-5 w-5" aria-hidden /> Windows</button>
        </div>
      )}
      {guide && <Guide os={guide} onClose={() => setGuide(null)} />}
    </div>
  );
};
