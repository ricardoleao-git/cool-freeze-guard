## Objetivo

Hoje `/demo` mostra apenas o simulador. O usuário quer poder navegar por **todos os menus** (Operação, Cadastros, Gestão, Apresentação) com **dados simulados populados**, **sem login**, mantendo o simulador atual e o painel TV (`/painel-demo`).

## Solução

Criar um "shell de demonstração" público que reaproveita o mesmo layout, sidebar e páginas reais da aplicação, forçando o tenant para `demo-tenant` e contornando a autenticação — sem duplicar páginas.

### Estrutura de rotas

```
/demo                          → Dashboard (demo)
/demo/painel                   → Painel Operacional
/demo/colaboradores            → Colaboradores
/demo/ambientes                → Ambientes Frios
/demo/dispositivos             → Dispositivos
/demo/eventos                  → Eventos
/demo/pausas                   → Pausas
/demo/alertas                  → Alertas
/demo/ocorrencias              → Ocorrências
/demo/historico                → Histórico
/demo/relatorios               → Relatórios
/demo/integracoes              → Integrações
/demo/usuarios                 → Usuários
/demo/como-funciona            → Como Funciona
/demo/lgpd                     → LGPD
/demo/ajustes                  → Ajustes
/demo/meu-dia                  → Meu Dia
/demo/resumo-diario            → Resumo Diário
/demo/empresas                 → Empresas
/demo/experimento              → Tela atual do simulador (DemoMode.tsx)
/painel-demo                   → mantém como está (painel TV sem chrome)
```

A rota atual `/demo` (simulador) passa a ser `/demo/experimento`. Adicionamos um botão **"Simulador"** na sidebar do demo.

### Como funciona tecnicamente

1. **`DemoShell`** novo componente que envolve `<Outlet />` em `AppLayout`, mas:
   - Não passa por `ProtectedRoute` nem `RoleGuard` (rota fora do bloco protegido).
   - Em `useLayoutEffect`, chama `setActiveTenantId("demo-tenant")` e bloqueia o render até estar sincronizado.
2. **`AuthProvider`** ganha um modo "demo": quando a rota começa com `/demo`, expõe `roles = ["super_admin"]` e um `user` virtual `{ email: "demo@frio-safe.app" }`, sem mexer na sessão Supabase real. Assim:
   - `RoleGuard` não é invocado (rota pública), mas componentes que leem `roles` (sidebar, badges, botões) continuam funcionando.
   - `AppLayout` mostra um email "demo" e o botão Sair faz `nav("/")` em vez de signOut.
3. **`AppSidebar`** detecta `pathname.startsWith("/demo")` e prefixa todos os `to=` com `/demo`, e o item "Modo Experimentação" aponta para `/demo/experimento`. Em modo demo, esconde Sair/usuário ou troca por "Sair do demo".
4. As policies anon para `demo-tenant` já existem (migração anterior), então leitura/escrita das tabelas já funciona sem login.
5. `PublicPanel` e a tela do simulador continuam intactos.

### Arquivos a alterar

- `src/App.tsx` — adicionar bloco de rotas `/demo/*` usando `DemoShell`.
- `src/components/DemoShell.tsx` — novo, força tenant + renderiza `AppLayout`.
- `src/lib/auth.tsx` — `AuthProvider` detecta rota `/demo` e injeta identidade/roles fake (sem tocar sessão real).
- `src/components/AppLayout.tsx` — quando em demo, esconde busca/sair real e mostra badge "MODO DEMO".
- `src/components/AppSidebar.tsx` — prefixa links com `/demo` quando aplicável; adiciona item "Simulador" → `/demo/experimento`.
- `src/pages/DemoMode.tsx` — pequenos ajustes (links internos passam a `/demo/painel` etc).

### O que não muda

- Páginas (`Dashboard`, `Employees`, `OperationalPanel`, etc.) ficam idênticas — elas já leem do `useTenantScoped()` que respeita `activeTenantId`.
- Login normal, rotas protegidas, RLS e dados de outros tenants continuam intocados.
- `/painel-demo` (TV) permanece sem sidebar.

### Indicação visual

Banner sticky no topo do `AppLayout` em modo demo: "Você está no modo de demonstração — dados simulados, sem login".
