import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, XCircle, Send, MonitorUp, WifiOff } from "lucide-react";
import { fmtTime } from "../../lib/format";

const Status = ({ a }) => {
  if (a.phase === "ended") {
    return (
      <div data-testid="public-session-status" className="flex items-center gap-3 text-2xl font-bold text-slate-200">
        <CheckCircle2 className="h-8 w-8 text-lime-400" /> Assistência terminada
      </div>
    );
  }
  if (a.phase === "active") {
    return (
      <div data-testid="public-session-status" className="flex items-center gap-3 text-2xl font-bold text-lime-300">
        <span className="h-4 w-4 rounded-full bg-lime-400 animate-pulse" /> Assistência ativa
      </div>
    );
  }
  return (
    <div data-testid="public-session-status" className="flex items-center gap-3 text-2xl font-bold text-white">
      <Loader2 className="h-8 w-8 animate-spin text-lime-400" /> A aguardar técnico…
    </div>
  );
};

const Chat = ({ a }) => {
  const [text, setText] = useState("");
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [a.messages.length]);
  const submit = (e) => { e.preventDefault(); if (text.trim()) { a.send(text.trim()); setText(""); } };
  return (
    <div className="mt-6 rounded-2xl border border-[#27354a] bg-[#111827]">
      <div data-testid="public-chat-log" className="cc-scroll max-h-60 min-h-[120px] overflow-y-auto p-4 text-base">
        {a.messages.length === 0 && <p className="text-slate-500">Podes escrever ao técnico aqui.</p>}
        {a.messages.map((m) => (
          <div key={m.id} className={`mb-2 flex ${m.from === "device" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${m.from === "device" ? "bg-lime-500 text-[#0b0f17]" : "bg-[#1d283a] text-white"}`}>
              <p className="text-xs opacity-70">{m.author} · {fmtTime(m.at)}</p>
              <p>{m.text}</p>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-[#27354a] p-3">
        <input data-testid="public-chat-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreve uma mensagem…" aria-label="Mensagem"
          className="flex-1 rounded-xl bg-[#0b0f17] px-4 py-3 text-base text-white outline-none focus:ring-2 focus:ring-lime-500" />
        <button data-testid="public-chat-send-btn" type="submit" aria-label="Enviar" className="rounded-xl bg-lime-500 px-4 text-[#0b0f17] hover:bg-lime-400">
          <Send className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
};

export const ActivePanel = ({ a }) => (
  <div className="cc-rise pb-28">
    <div className="rounded-3xl border border-[#27354a] bg-[#161e2e] p-6 sm:p-8">
      <Status a={a} />
      {a.techName && a.phase !== "ended" && <p data-testid="public-tech-name" className="mt-3 text-lg text-slate-300">Técnico: <b className="text-white">{a.techName}</b></p>}
      {a.phase === "waiting" && <p className="mt-3 text-base text-slate-400">Fica nesta página. Um técnico vai atender-te em breve.</p>}
      {!a.online && a.phase !== "ended" && (
        <p data-testid="public-reconnecting" className="mt-3 flex items-center gap-2 text-base text-amber-300"><WifiOff className="h-5 w-5" /> Sem internet. A ligar de novo…</p>
      )}
      {a.phase !== "ended" && (
        <p className="mt-3 flex items-center gap-2 text-base">
          <MonitorUp className={`h-5 w-5 ${a.sharing ? "text-lime-400" : "text-red-400"}`} />
          {a.sharing ? "O teu ecrã está a ser partilhado." : "A partilha do ecrã parou."}
          {!a.sharing && (
            <button data-testid="public-reshare-btn" onClick={a.reshare} className="ml-2 rounded-lg bg-lime-500 px-3 py-1 font-bold text-[#0b0f17]">Partilhar de novo</button>
          )}
        </p>
      )}
      {a.phase === "ended" && (
        <button data-testid="public-new-request-btn" onClick={a.reset} className="mt-5 rounded-2xl bg-lime-500 px-6 py-4 text-lg font-bold text-[#0b0f17]">Pedir nova ajuda</button>
      )}
    </div>
    {a.phase !== "ended" && <Chat a={a} />}
    {a.phase !== "ended" && (
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#27354a] bg-[#0b0f17]/95 p-4 backdrop-blur">
        <button data-testid="public-terminate-btn" onClick={a.end}
          className="mx-auto flex w-full max-w-xl items-center justify-center gap-2 rounded-2xl bg-red-600 py-5 text-2xl font-black text-white hover:bg-red-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-400">
          <XCircle className="h-7 w-7" /> TERMINAR
        </button>
      </div>
    )}
  </div>
);

export const PrivacyOverlay = ({ a }) => (
  <div data-testid="public-privacy-overlay" role="alertdialog" aria-live="assertive" className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black p-6 text-center">
    <Loader2 className="mb-6 h-14 w-14 animate-spin text-lime-400" />
    <p className="text-3xl font-extrabold sm:text-5xl">Ajuste Técnico — Aguarde...</p>
    <p className="mt-3 text-base text-slate-400">Modo de privacidade ativo. O técnico está a trabalhar.</p>
    {a.privacyAsk && <p data-testid="public-privacy-ask" className="mt-4 rounded-xl bg-lime-500/10 px-4 py-2 text-lime-300">O técnico pede para desligares este modo.</p>}
    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
      <button data-testid="public-privacy-disable-btn" onClick={a.disablePrivacy} className="rounded-2xl border-2 border-lime-500 px-6 py-4 text-lg font-bold text-lime-300 hover:bg-lime-500 hover:text-[#0b0f17]">Desligar este modo</button>
      <button data-testid="public-privacy-terminate-btn" onClick={a.end} className="rounded-2xl bg-red-600 px-6 py-4 text-lg font-bold text-white hover:bg-red-500">TERMINAR</button>
    </div>
  </div>
);
