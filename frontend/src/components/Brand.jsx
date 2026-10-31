import { useEffect, useState } from "react";

export const Logo = ({ className = "h-12", testId = "brand-logo" }) => (
  <img src="/logo.png" alt="APP DE SUPORTE TÉCNICO" data-testid={testId} className={`object-contain ${className}`} />
);

const lisbonParts = () => {
  const d = new Date();
  const time = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(d);
  const date = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  return { time, date };
};

export const LisbonClock = () => {
  const [t, setT] = useState(lisbonParts());
  useEffect(() => {
    const i = setInterval(() => setT(lisbonParts()), 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <div data-testid="crm-lisbon-clock" className="flex items-center gap-3 rounded-xl border border-[#27354a] bg-[#111827] px-3 py-1.5">
      <span className="h-2 w-2 rounded-full bg-lime-500 animate-pulse" />
      <span className="font-mono text-lg font-semibold tracking-wider text-white">{t.time}</span>
      <span className="hidden sm:inline text-xs text-slate-400">{t.date} · Lisboa</span>
    </div>
  );
};

export const Credits = () => (
  <p data-testid="crm-footer-credits" className="text-[11px] text-slate-500">Criado por Victor Silva (Rafael Amorim)</p>
);
