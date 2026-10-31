const TZ = "Europe/Lisbon";

export const fmtDateTime = (iso) => {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(iso));
};

export const fmtTime = (iso) => {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-PT", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso));
};

export const fmtDuration = (s) => {
  if (!s) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}min` : m ? `${m}min ${sec}s` : `${sec}s`;
};

export const since = (iso) => {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} dias`;
};

export const STATUS_LABEL = {
  pending: "Pendente", assigned: "Atribuído", active: "Em curso", ended: "Terminado",
};

export const PLATFORM_LABEL = { browser: "Navegador", android: "Android", windows: "Windows" };

export const detectOS = () => {
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/windows/i.test(ua)) return "windows";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/mac os/i.test(ua)) return "macos";
  if (/linux/i.test(ua)) return "linux";
  return "outro";
};

export const OS_NAME = { android: "Android", windows: "Windows", ios: "iOS", macos: "macOS", linux: "Linux", outro: "Outro" };

export const beep = (freq = 880, ms = 180) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, ms);
  } catch { /* audio not available */ }
};
