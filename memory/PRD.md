# PRD — APP DE SUPORTE TÉCNICO (Crypto Conex)

## Original problem statement (summary of the customer's own words; full text in the first message)
Plataforma profissional de assistência técnica remota legítima e consentida para pessoas com baixa literacia digital ou limitações motoras. Componentes: Crypto Conex CRM (painel web com autenticação Super Admin/Técnico, dashboard, fila em tempo real, atendimentos, visualizador WebRTC com zoom e painel lateral, modo de privacidade "Ajuste Técnico — Aguarde...", dispositivos, links individuais aleatórios, configurações/técnicos/auditoria/retenção); Crypto Conex Connect (página pública com logótipo, "Bem-vindo…", botão CONECTAR que inicia getDisplayMedia, botão DESCARREGAR APLICAÇÃO conforme SO, nota de privacidade); Crypto Conex Mobile (Android nativo: MediaProjection, MediaCodec, WebRTC, AccessibilityService, Foreground Service, WakeLock/WifiLock); Crypto Conex PC (Windows C#/.NET: Desktop Duplication, user32.dll, System Tray, instalador). Backend com Socket.IO rooms (admin:global, technician:{id}, device:{id}, session:{id}) e os eventos listados, JWT + refresh rotation, bcrypt, rate limiting, auditoria, retenção. ICE STUN/TURN Metered via env vars. pt-PT, Europe/Lisbon, DD/MM/AAAA, relógio de Lisboa, rodapé "Criado por Victor Silva (Rafael Amorim)". Paleta cinzento-escuro + verde-limão. GitHub workflow que compila as apps e o site descarrega sempre a última versão. Não deixar avisos/botões por cima da visualização; partilha estável.
User choices: tudo a funcionar (CRM + backend + página pública), FastAPI em vez de Node (mesma lógica), Super Admin garciafinancas0073040@proton.me (password via secret), clientes sem conta (só CONECTAR).

## Architecture
- backend/: FastAPI + python-socketio (ASGI, path /api/socket.io) + MongoDB (motor). core.py (auth/JWT/bcrypt/rate-limit/ICE/settings), realtime.py (rooms/events/permission checks), server.py (REST).
- frontend/: React (JS) + Tailwind + shadcn; public pages (/ and /assistir/:code), CRM (/crm/*).
- android/: Kotlin native app (stream-webrtc-android, socket.io-client-java). windows/: .NET 8 WinForms (SIPSorcery VP8, Vortice DDA, SocketIOClient, SendInput) + Inno Setup.
- .github/workflows/native-apps.yml builds APK + installer and publishes GitHub Release "latest".

## User personas
Super Admin (owner), Técnico/Tutor, Cliente assistido (idoso / baixa literacia / limitação motora).

## Implemented (2026-10-31)
- Custom JWT auth (15 min access, 7-day refresh with atomic rotation + reuse detection), lockout after 5 failures, IP+email rate limits, password reset via admin-generated link, change password.
- Dashboard with stats, 7-day chart, live queue with sound/toast; assign/take/transfer/end/discard; accept/reject in viewer.
- Viewer: WebRTC stream, zoom, reconnect watchdog, stats (rtt/kbps/fps), chat, privacy mode, operations log, accessibility tree, remote control bar (native only, with consent and permission).
- Devices (search/filter/rename/delete/history), Links (validity 1/7/30/90/none, revoke, uses), Settings (technicians CRUD + permissions + activity, system settings, audit).
- Public page: OS detection, CONECTAR → getDisplayMedia → session, waiting/active states, chat, TERMINAR, privacy overlay, auto reconnect, sound toggle.
- Android and Windows source code; Windows compiles with dotnet build; Android is built by the GitHub workflow (not compiled here).
- Tested: iteration 1 (25/27 backend) → fixes → iteration 2 (34/34 backend, frontend flows 100%).

## Implemented (2026-10-31, iteration 2)
- GitHub repo conexioncriptexpt/AppSuporte set as default; download buttons point to releases/latest/download/CryptoConex.apk and CryptoConexSetup.exe.
- Backend checks (cached 5 min) whether release files exist; the site never sends to a GitHub 404 (shows "a ser preparada").
- One-click direct download + a 3-step install guide (Android / Windows SmartScreen).
- Workflow: runs on every push to main + manual; backend URL defaults to the preview URL unless vars.CONEX_BACKEND_URL is set; installer paths fixed; Android minSdk 26, lint not blocking.

## Known limitations
- Native apps not tested on physical devices; Android not compiled in this environment.
- Android privacy overlay is also visible to the technician (Android captures overlays).
- Browser clients: view only (no remote control).

## Backlog
- P1: Test the native apps on real devices and networks; configure CONEX_BACKEND_URL and the GitHub repo in Settings.
- P1: Metered temporary TURN credentials (set METERED_DOMAIN/METERED_API_KEY).
- P2: Device names in the audit log; optional client name on the public page; email delivery for password resets.

## Next tasks
- Push to GitHub, run the workflow, set the repo in CRM → Configurações → Sistema.
