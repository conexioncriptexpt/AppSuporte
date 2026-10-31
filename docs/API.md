# API — Crypto Conex

Base: `{BACKEND_URL}/api`. Autenticação do CRM: `Authorization: Bearer <access_token>` (JWT 15 min). Dispositivos: token temporário (12 h) obtido em `/device/register`.

## Autenticação
| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/login` | `{email,password}` → `{access_token, refresh_token, user}`. 5 falhas → bloqueio 15 min |
| POST | `/auth/refresh` | `{refresh_token}` → novo par (rotação; reutilização revoga a família) |
| POST | `/auth/logout` | `{refresh_token}` |
| GET | `/auth/me` | utilizador atual |
| POST | `/auth/change-password` | `{current_password,new_password}` |
| POST | `/auth/forgot` | `{email}` → notifica o Super Admin |
| POST | `/auth/reset` | `{token,new_password}` (link gerado pelo Super Admin, 1 h) |

## Técnicos (Super Admin)
`GET/POST /users`, `PATCH/DELETE /users/{id}`, `POST /users/{id}/password`, `POST /users/{id}/reset-link`, `GET /users/{id}/activity`, `GET /reset-requests`. `GET /technicians` (qualquer utilizador autenticado, lista mínima).

## Atendimentos
`GET /sessions?scope=active|history`, `GET /sessions/{id}`, `POST /sessions/{id}/assign|take|transfer|end|discard`. O técnico só vê sessões atribuídas a si (ou pendentes vindas dos seus links); outras devolvem 404.

## Dispositivos / Links / Sistema
`GET /devices?q=&os=&status=`, `GET/PATCH /devices/{id}`, `DELETE /devices/{id}` (Super Admin).
`GET/POST /links`, `POST /links/{id}/revoke`.
`GET/PUT /settings`, `GET /audit`, `GET /dashboard`.

## Público
`GET /public/config?code=` (downloads, técnico do link), `POST /device/register`, `GET /ice-servers` (exige token).

## Socket.IO
Caminho: `/api/socket.io`. `auth: {token, kind: "user"|"device"}`.

Salas: `admin:global`, `technician:{id}`, `device:{id}`, `session:{id}`.

| Evento | Origem → destino | Validação |
|---|---|---|
| `device:register` | dispositivo | token de dispositivo |
| `device:online` / `device:offline` | servidor → admin | — |
| `support:request` | dispositivo → servidor (ack com sessão) → admin/técnico | rate limit, retoma sessão aberta |
| `support:assigned` | servidor → técnico + dispositivo | — |
| `support:accepted` / `support:rejected` | técnico | sessão atribuída ao técnico |
| `session:started` / `session:ended` / `session:status` | ambos | membro da sessão |
| `webrtc:offer` / `webrtc:answer` / `webrtc:ice-candidate` / `webrtc:request-offer` | relay na sala da sessão | sessão ativa + membro |
| `remote:command` | técnico → dispositivo | permissão `control` + consentimento `control` do cliente + sessão ativa + tipo permitido |
| `accessibility:request` / `accessibility:tree` | técnico ↔ dispositivo | permissão `accessibility` |
| `privacy:enable` / `privacy:disable` / `privacy:request-disable` → `privacy:enabled` / `privacy:disabled` | técnico/cliente | permissão `privacy`; o cliente pode sempre desativar |
| `consent:update` | dispositivo | só o próprio dispositivo |
| `chat:message` | ambos | membro da sessão |

Comandos (`command.type`, coordenadas normalizadas 0–1): `tap`, `click`, `double_click`, `right_click`, `move`, `swipe {x1,y1,x2,y2,duration}`, `scroll {dy}`, `text {text}`, `key {key}`, `back`, `home`, `recents`, `shortcut {keys}`.
