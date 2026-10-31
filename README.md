# APP DE SUPORTE TÉCNICO — Crypto Conex

Plataforma de assistência técnica remota **legítima e consentida** para pessoas com baixa literacia digital ou limitações motoras.

| Componente | Pasta | Tecnologia | Estado |
|---|---|---|---|
| Crypto Conex CRM (painel) | `frontend/src/pages/crm` | React + Tailwind | Funcional |
| Crypto Conex Connect (página pública) | `frontend/src/pages/public` | React + WebRTC (`getDisplayMedia`) | Funcional |
| Backend (API + sinalização) | `backend/` | Python FastAPI + python-socketio + MongoDB + JWT | Funcional |
| Crypto Conex Mobile | `android/` | Kotlin nativo, MediaProjection, WebRTC (MediaCodec H.264/VP8), AccessibilityService | Código-fonte, compilado pelo GitHub Actions |
| Crypto Conex PC | `windows/` | C# .NET 8 WinForms, Desktop Duplication API, SIPSorcery WebRTC, user32.dll | Código-fonte, compila (testado em `dotnet build`) |

> Nota de arquitetura: o pedido original referia Node.js/Express. Por escolha do cliente, o backend corre em **FastAPI + Socket.IO (python-socketio)**, com a mesma lógica de salas (`admin:global`, `technician:{id}`, `device:{id}`, `session:{id}`) e os mesmos eventos. Os clientes Socket.IO (web, Android, Windows) são compatíveis.

## Estrutura

```
backend/            API REST + Socket.IO (server.py, realtime.py, core.py)
frontend/           CRM + página pública (React)
android/            App Android nativa (Kotlin)
windows/            App Windows nativa (C#/.NET) + instalador Inno Setup
docs/               API, produção, segurança
.github/workflows/  Compilação e publicação automática das apps
backend/.env.example
```

## Executar em desenvolvimento

```bash
# Backend
cd backend && pip install -r requirements.txt
cp .env.example .env   # preencher valores
uvicorn server:app --host 0.0.0.0 --port 8001

# Frontend
cd frontend && yarn install && yarn start   # REACT_APP_BACKEND_URL no frontend/.env
```

O Super Admin é criado no arranque a partir de `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD`.

## Apps nativas e downloads

1. Faça push do repositório para o GitHub.
2. Em **Settings → Secrets and variables → Actions → Variables**, crie `CONEX_BACKEND_URL` com o URL público do backend (ex.: `https://suporte.dominio.pt`).
3. (Opcional, recomendado) Secrets para assinar o APK: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Sem eles, o APK é assinado com a chave de depuração (instala na mesma).
4. O workflow `native-apps.yml` compila o APK e o instalador `.exe` e publica uma Release `latest` com `CryptoConex.apk` e `CryptoConexSetup.exe`.
5. No CRM → Configurações → Sistema, indique o repositório (`utilizador/repositorio`). Os botões **DESCARREGAR APLICAÇÃO** passam a apontar para a última Release.

Ver `docs/` para API, guia de produção e segurança.
