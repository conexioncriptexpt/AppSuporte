import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ZoomIn, ZoomOut, Maximize, RefreshCw, EyeOff, Eye, PhoneOff, MousePointer2, ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useViewer } from "./useViewer";
import { Btn, Card, StatusBadge } from "../../components/crm/ui";
import { SidePanel } from "./ViewerSide";
import { ControlBar } from "./ControlBar";

const Stage = ({ v, zoom, control }) => {
  const video = useRef(null);
  const down = useRef(null);
  const lastWheel = useRef(0);
  useEffect(() => { if (video.current && v.stream) video.current.srcObject = v.stream; }, [v.stream]);
  const pos = (e) => {
    const rect = video.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) };
  };
  const onDown = (e) => { if (control) down.current = { ...pos(e), t: Date.now() }; };
  const onUp = (e) => {
    if (!control || !down.current) return;
    const p = pos(e), d = down.current;
    down.current = null;
    const dist = Math.hypot(p.x - d.x, p.y - d.y);
    if (e.button === 2) v.cmd({ type: "right_click", x: p.x, y: p.y });
    else if (dist < 0.01) v.cmd({ type: "tap", x: p.x, y: p.y });
    else v.cmd({ type: "swipe", x1: d.x, y1: d.y, x2: p.x, y2: p.y, duration: Math.min(1500, Math.max(150, Date.now() - d.t)) });
  };
  const onWheel = (e) => {
    if (!control || Date.now() - lastWheel.current < 150) return;
    lastWheel.current = Date.now();
    const p = pos(e);
    v.cmd({ type: "scroll", x: p.x, y: p.y, dy: Math.sign(e.deltaY) });
  };
  return (
    <div data-testid="crm-stream-canvas" className="stream-stage cc-scroll relative h-[62vh] overflow-auto rounded-xl bg-black">
      {v.stream ? (
        <video ref={video} autoPlay playsInline muted data-testid="crm-stream-video"
          onPointerDown={onDown} onPointerUp={onUp} onWheel={onWheel} onContextMenu={(e) => control && e.preventDefault()}
          onDoubleClick={(e) => { if (control) { const p = pos(e); v.cmd({ type: "double_click", x: p.x, y: p.y }); } }}
          style={{ width: `${zoom * 100}%`, cursor: control ? "crosshair" : "default" }} className="mx-auto h-auto max-w-none" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
          {v.s?.status === "active" ? <Loader2 className="h-8 w-8 animate-spin text-lime-400" /> : null}
          <p>{v.s?.status === "active" ? "A estabelecer a transmissão do ecrã…" : v.s?.status === "ended" ? "Sessão terminada." : "A transmissão começa depois de aceitar o atendimento."}</p>
        </div>
      )}
    </div>
  );
};

export default function Viewer() {
  const { id } = useParams();
  const { user, isAdmin } = useAuth();
  const v = useViewer(id);
  const [zoom, setZoom] = useState(1);
  const [control, setControl] = useState(false);
  const s = v.s;

  if (v.notFound) return <Card className="p-8 text-center text-slate-400">Sessão não encontrada ou sem acesso. <Link className="text-lime-400" to="/crm/atendimentos">Voltar</Link></Card>;
  if (!s) return <div className="flex justify-center p-10"><Loader2 className="h-8 w-8 animate-spin text-lime-400" /></div>;

  const mine = s.technician_id === user.id;
  const active = s.status === "active";
  const canControl = active && s.platform !== "browser" && s.consent?.control && user.permissions?.control;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Link to="/crm/atendimentos" className="rounded-lg border border-[#27354a] p-2 hover:border-lime-500" aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Link>
          <h1 className="text-xl font-bold">{s.client_name || s.device_name}</h1>
          <StatusBadge status={s.status} />
          {s.privacy && <span data-testid="viewer-privacy-badge" className="rounded-full bg-lime-500/15 px-2.5 py-0.5 text-xs font-semibold text-lime-300">Modo de privacidade ativo</span>}
          <span className="ml-auto text-xs text-slate-400" data-testid="viewer-rtc-state">WebRTC: {v.rtc} · {s.resolution || (v.quality.w ? `${v.quality.w}x${v.quality.h}` : "—")}</span>
        </div>

        {s.status === "assigned" && mine && (
          <Card className="mb-3 flex flex-wrap items-center gap-3 p-4">
            <p className="flex-1 text-sm">Este pedido foi-lhe atribuído. Aceite para iniciar a assistência.</p>
            <Btn data-testid="viewer-accept-btn" onClick={v.accept}>Aceitar</Btn>
            <Btn data-testid="viewer-reject-btn" variant="danger" onClick={v.reject}>Rejeitar</Btn>
          </Card>
        )}
        {s.status === "assigned" && !mine && <Card className="mb-3 p-4 text-sm text-slate-400">A aguardar que {s.technician_name} aceite o atendimento.</Card>}
        {s.status === "pending" && <Card className="mb-3 p-4 text-sm text-slate-400">Pedido pendente. {isAdmin ? "Atribua-o a um técnico nos Atendimentos." : ""}</Card>}

        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-[#27354a] bg-[#111827] p-2">
          <Btn variant="ghost" data-testid="crm-stream-zoom-out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Reduzir"><ZoomOut className="h-4 w-4" /></Btn>
          <span data-testid="crm-stream-zoom-level" className="w-12 text-center font-mono text-xs">{Math.round(zoom * 100)}%</span>
          <Btn variant="ghost" data-testid="crm-stream-zoom-in" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Ampliar"><ZoomIn className="h-4 w-4" /></Btn>
          <Btn variant="ghost" data-testid="crm-stream-fit" onClick={() => setZoom(1)}><Maximize className="h-4 w-4" /> Ajustar</Btn>
          <Btn variant="ghost" data-testid="crm-stream-refresh" disabled={!active} onClick={v.requestOffer}><RefreshCw className="h-4 w-4" /> Religar vídeo</Btn>
          <Btn variant={control ? "primary" : "ghost"} data-testid="crm-control-toggle" disabled={!canControl} onClick={() => setControl(!control)}
            title={s.platform === "browser" ? "O navegador não permite controlo remoto" : !s.consent?.control ? "O cliente ainda não autorizou o controlo" : ""}>
            <MousePointer2 className="h-4 w-4" /> {control ? "Controlo ativo" : "Controlo"}
          </Btn>
          <div className="ml-auto flex flex-wrap gap-2">
            {active && !s.privacy && <Btn data-testid="crm-privacy-toggle-btn" onClick={() => v.emit("privacy:enable")}><EyeOff className="h-4 w-4" /> ATIVAR MODO DE PRIVACIDADE</Btn>}
            {active && s.privacy && (
              <>
                <Btn variant="ghost" data-testid="crm-privacy-request-disable-btn" onClick={() => v.emit("privacy:request-disable")}>Pedir desativação ao cliente</Btn>
                <Btn variant="ghost" data-testid="crm-privacy-disable-btn" onClick={() => v.emit("privacy:disable")}><Eye className="h-4 w-4" /> Desativar</Btn>
              </>
            )}
            {(mine || isAdmin) && s.status !== "ended" && <Btn variant="danger" data-testid="viewer-end-btn" onClick={v.end}><PhoneOff className="h-4 w-4" /> Terminar assistência</Btn>}
          </div>
        </div>

        <Stage v={v} zoom={zoom} control={control && canControl} />
        {active && <ControlBar v={v} enabled={!!canControl} platform={s.platform} />}
      </div>
      <SidePanel v={v} />
    </div>
  );
}
