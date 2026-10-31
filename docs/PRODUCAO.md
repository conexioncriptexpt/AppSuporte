# Guia de produção e segurança

## Segredos
- Todos os segredos ficam em variáveis de ambiente do backend (`JWT_SECRET`, `SUPER_ADMIN_PASSWORD`, `TURN_*`). Nunca no frontend, nos APK ou no instalador.
- As apps e a página pública obtêm os servidores ICE em `GET /api/ice-servers` com um token temporário.
- **Credenciais TURN temporárias:** defina `METERED_DOMAIN` (ex.: `a-sua-app.metered.live`) e `METERED_API_KEY`. O backend passa a pedir credenciais temporárias à Metered em cada sessão; as estáticas `TURN_USERNAME/TURN_CREDENTIAL` ficam só como recurso.
- Gere um `JWT_SECRET` novo e longo em produção.

## HTTPS / WSS
Sirva o backend atrás de HTTPS (o Socket.IO usa automaticamente WSS). O navegador só permite `getDisplayMedia` em HTTPS.

## Retenção de dados
CRM → Configurações → Sistema → "Retenção de dados". Sessões terminadas e registos de auditoria mais antigos são apagados automaticamente (verificação horária).

## Consentimento
- Página web: a partilha só começa depois de o utilizador escolher o ecrã no seletor nativo do navegador. O navegador não permite controlo remoto.
- Android: autorização do sistema (MediaProjection) + notificação permanente com TERMINAR. O controlo exige o interruptor "Permitir que o técnico toque no ecrã" E o serviço de acessibilidade ativado pelo utilizador.
- Windows: barra sempre visível "Assistência remota ativa" com TERMINAR; o controlo exige a caixa "Permitir que o técnico use o rato e o teclado".
- Cada alteração de consentimento é registada na sessão e na auditoria.

## Limitações conhecidas (honestas)
- **Android — modo de privacidade:** o Android captura tudo o que está no ecrã, incluindo sobreposições. Com o modo ativo, o cliente vê o ecrã escuro, mas o técnico também o verá na transmissão. Não existe forma legítima de excluir uma janela da captura no Android.
- **Windows — modo de privacidade:** usa `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` (Windows 10 2004+). O técnico continua a ver o ambiente de trabalho.
- **Windows — UAC/ecrã seguro:** a captura e o controlo não funcionam no ecrã seguro do Windows (por desenho do sistema; não é contornado).
- **Instalação "com um clique":** o navegador descarrega o APK/instalador; o utilizador tem de o abrir. No Android é preciso permitir "instalar apps desconhecidas" para o navegador.
- As apps nativas ainda não foram testadas em equipamentos físicos.

## Testes em equipamentos reais (checklist)
1. Android 10–14: CONECTAR → autorizar captura → técnico vê ecrã; ativar acessibilidade → permitir toque → tocar/deslizar/voltar.
2. Windows 10/11: instalar `CryptoConexSetup.exe` → CONECTAR → técnico vê ecrã → permitir controlo → clicar/escrever.
3. Redes: Wi-Fi doméstico, 4G/5G e rede empresarial (força TURN TCP/443).
4. Desligar a internet do cliente 30 s → deve religar sozinho.
