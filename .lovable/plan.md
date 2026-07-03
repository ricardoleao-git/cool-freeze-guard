## Objetivo

Adicionar um fluxo de pareamento de TV/quiosque baseado em código de 6 dígitos (inspirado no GuardIA Escolas), preservando o token longo persistente que o Fully Kiosk já carrega na URL. Reorganizar a tela existente "Painel Externo (Quiosque)" para virar "Configurações do painel", com geração de códigos e gestão de dispositivos pareados.

## Fluxo alvo

```text
Admin (logado)                        Dispositivo (TV / Fully Kiosk)
┌────────────────────────────┐        ┌───────────────────────────────┐
│ Sidebar → Configurações    │        │ URL inicial: /loginpainel     │
│ do painel                  │        │                               │
│                            │        │ ┌─ Autenticação ────────────┐ │
│ [Gerar código de pareamento]────►   │ │  □ □ □ □ □ □              │ │
│                            │        │ │  [ CONECTAR ]             │ │
│ Código: 483 921            │        │ └───────────────────────────┘ │
│ Expira em 14:53            │        │                               │
│                            │        │ POST /kiosk-pair-code         │
│                            │  ◄───  │ { code: "483921" }            │
│                            │        │                               │
│                            │  ────► │ { token: "abc123..." }        │
│ Lista de dispositivos:     │        │                               │
│ • Fire Stick TV Doca 1     │        │ location.replace(             │
│   pareado 12:34 · IP x.y   │        │   /painelgeral?boot=abc123... │
│                            │        │ )                             │
│ [Revogar]                  │        │ Fully Kiosk memoriza URL.     │
└────────────────────────────┘        └───────────────────────────────┘
```

Nas próximas reinicializações a TV já abre `/painelgeral?boot=<token>` direto — sem novo login.

## Escopo de mudanças

### 1. Banco (nova migration)
Adicionar em `public.kiosk_tokens`:
- `pairing_code text` (6 dígitos, único por tenant enquanto ativo)
- `pairing_expires_at timestamptz` (agora + 15 min)
- `paired_at timestamptz`
- `paired_ip inet`, `paired_user_agent text`
- Índice parcial `(tenant_id, pairing_code) WHERE pairing_code IS NOT NULL`

O `token` longo já existe e continua sendo o segredo persistente. O código de 6 dígitos é consumido no pareamento (uso único, expira em 15 min).

### 2. Edge functions
- **`kiosk-token-manage`** (existente): ao criar token, também gerar `pairing_code` (6 dígitos aleatórios, garantia de unicidade) + `pairing_expires_at`. Retornar o código no payload; **não** retornar mais o token longo diretamente na criação (só o código).
- **`kiosk-pair-code`** (novo, `verify_jwt = false`): recebe `{ code }`, valida contra `kiosk_tokens` (ativo, não expirado, não pareado), grava `paired_at/ip/user_agent`, limpa `pairing_code`, retorna `{ token }` longo.
- **`kiosk-panel`** (existente): sem mudança — continua validando o token longo.

### 3. Frontend
- **Nova rota pública `/loginpainel`** (`src/pages/KioskLogin.tsx`): OTP de 6 dígitos (usando `input-otp` já instalado), botão "Conectar", tratamento de código expirado. Sucesso → `window.location.replace('/painelgeral?boot=' + token)`.
- **Nova rota pública `/painelgeral`**: alias/leitura do parâmetro `boot`, delega para o mesmo componente que hoje renderiza `/painel?token=…` (Kiosk.tsx). Se `boot` ausente → redireciona para `/loginpainel`.
- **`/painel?token=…`** permanece funcionando (retrocompat).
- **`KioskTokens.tsx` → renomeado "Configurações do painel"**: cards com código de pareamento pendente (com contador de expiração), lista de dispositivos pareados (rótulo, IP, user-agent resumido, último uso), ações Revogar / Regenerar código.
- **Sidebar**: renomear item "Painel Externo (Quiosque)" para "Configurações do painel" (grupo Gestão).
- **OperationalPanel**: manter o botão "Modo kiosk" como está (preview local para admins).

## Detalhes técnicos

- Código de 6 dígitos: `crypto.getRandomValues` → número 000000–999999, com retry se colidir com código ativo no mesmo tenant.
- Rate limit no `kiosk-pair-code`: máx. 5 tentativas por IP/minuto (in-memory simples ou tabela) — mitiga brute force do espaço de 1M códigos.
- Token longo continua sendo o único segredo persistente; o código de 6 dígitos vira `null` após consumo (não pode ser reutilizado).
- `verify_jwt = false` no `kiosk-pair-code` (mesma justificativa do `kiosk-panel`), validação por código no corpo.
- `/loginpainel` e `/painelgeral` ficam fora de `ProtectedRoute` no `App.tsx`, como já é o `/painel`.
- Nenhuma mudança em RLS: as funções usam `service_role`.

## Fora de escopo
- Não migrar tokens legados existentes (continuam válidos via `/painel?token=…`).
- Não alterar o `kiosk-panel` nem o layout do quiosque em si.
- Não mexer no fluxo do modo demo.
