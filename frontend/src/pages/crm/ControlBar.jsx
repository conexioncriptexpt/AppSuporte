import { useState } from "react";
import { Keyboard, Undo2, Home, Layers, ScanText } from "lucide-react";
import { Btn, inputCls } from "../../components/crm/ui";

const WIN_SHORTCUTS = [["ctrl+c", "Copiar"], ["ctrl+v", "Colar"], ["ctrl+z", "Desfazer"], ["ctrl+a", "Selecionar tudo"], ["alt+tab", "Alt+Tab"], ["win", "Iniciar"], ["win+d", "Ambiente de trabalho"]];
const KEYS = [["Enter", "Enter"], ["Backspace", "Apagar"], ["Tab", "Tab"], ["Escape", "Esc"]];

export const ControlBar = ({ v, enabled, platform }) => {
  const [text, setText] = useState("");
  const sendText = (e) => { e.preventDefault(); if (text) { v.cmd({ type: "text", text }); setText(""); } };
  return (
    <div className="mt-2 rounded-xl border border-[#27354a] bg-[#111827] p-3" data-testid="crm-control-bar">
      {!enabled && (
        <p className="mb-2 text-xs text-slate-400">
          {platform === "browser" ? "Cliente ligado pelo navegador: apenas visualização (o navegador não permite controlo)." : "O controlo fica disponível quando o cliente o autorizar na aplicação."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={sendText} className="flex min-w-[240px] flex-1 gap-2">
          <input data-testid="crm-remote-text-input" disabled={!enabled} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escrever texto no dispositivo (não sensível)" className={inputCls} />
          <Btn data-testid="crm-remote-text-send" disabled={!enabled} type="submit"><Keyboard className="h-4 w-4" /></Btn>
        </form>
        {KEYS.map(([k, l]) => <Btn key={k} variant="ghost" disabled={!enabled} data-testid={`crm-key-${k}`} onClick={() => v.cmd({ type: "key", key: k })}>{l}</Btn>)}
        {platform === "android" && (
          <>
            <Btn variant="ghost" disabled={!enabled} data-testid="crm-android-back" onClick={() => v.cmd({ type: "back" })}><Undo2 className="h-4 w-4" /> Voltar</Btn>
            <Btn variant="ghost" disabled={!enabled} data-testid="crm-android-home" onClick={() => v.cmd({ type: "home" })}><Home className="h-4 w-4" /> Início</Btn>
            <Btn variant="ghost" disabled={!enabled} data-testid="crm-android-recents" onClick={() => v.cmd({ type: "recents" })}><Layers className="h-4 w-4" /> Recentes</Btn>
            <Btn variant="ghost" data-testid="crm-accessibility-read" onClick={() => v.emit("accessibility:request")}><ScanText className="h-4 w-4" /> Ler ecrã</Btn>
          </>
        )}
        {platform === "windows" && WIN_SHORTCUTS.map(([k, l]) => (
          <Btn key={k} variant="ghost" disabled={!enabled} data-testid={`crm-shortcut-${k}`} onClick={() => v.cmd({ type: "shortcut", keys: k })}>{l}</Btn>
        ))}
      </div>
    </div>
  );
};
