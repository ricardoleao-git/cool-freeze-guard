# PRD — FrioSafe

**Produto:** FrioSafe — Monitoramento de Exposição ao Frio e Conformidade Legal
**Versão:** 1.0 (retroativo, consolidando o que foi construído)
**Última atualização:** 09/07/2026
**Owner:** Zênite Tech
**Status:** Em produção (multi-tenant, com modo de demonstração público)

---

## 1. Sumário executivo

FrioSafe é uma plataforma multi-tenant que monitora o tempo de permanência de colaboradores em câmaras frias (frigoríficos, laticínios, distribuição refrigerada), garantindo o cumprimento da **NR-36**, do **Art. 253 da CLT** e da **LGPD**, com trilha auditável assinada em cadeia (colaborador → supervisor → RH → jurídico) e painel público em quiosque/TV para transparência no chão de fábrica.

O sistema integra-se ao controle de acesso facial **GuardIA** (leitores fixos por câmara), calcula exposição e pausas térmicas em tempo real, dispara alertas visuais/sonoros (amarelo 80 min / laranja 90 min / vermelho 100 min) e produz relatórios mensais assinados digitalmente (PIN + opcional ICP-Brasil).

---

## 2. Problema

Frigoríficos e ambientes artificialmente frios têm alta incidência de LER/DORT, hipotermia leve e afastamentos por doença ocupacional. A legislação exige **pausas térmicas obrigatórias** e **registro comprobatório** por colaborador, mas a maioria das empresas:

- Controla o tempo em planilhas manuais (não auditáveis).
- Não consegue provar cumprimento em fiscalizações do MTE ou ações trabalhistas.
- Trata dados biométricos sem base legal explícita (violação da LGPD).
- Não dá ao colaborador visibilidade do próprio tempo de exposição.

FrioSafe resolve os quatro problemas com um único fluxo automatizado.

---

## 3. Personas

| Persona | Necessidade principal | Onde vive no app |
|---|---|---|
| **Colaborador (operador de câmara)** | Ver seu tempo, confirmar seu extrato diário, saber quando sair | `/meu-dia`, `/extrato`, painel na TV |
| **Supervisor de turno** | Fila de inconsistências, ajustes manuais, fechamento diário | `/inconsistencias`, `/ajustes` |
| **RH / SST** | Relatórios mensais, evidência de NR-36, exportação para eSocial | `/relatorios`, `/resumo-diario` |
| **Jurídico / Compliance** | Assinatura final, hash de cadeia, resposta a fiscalização | `/fechamento` |
| **Administrador do tenant** | Configurar câmaras, limites, integração GuardIA, papéis | `/configuracoes/*`, `/usuarios` |
| **Super Admin (Zênite)** | Onboarding de novos clientes, retenção LGPD, saúde da plataforma | `/tenants`, purge jobs |
| **Painel público (TV do chão de fábrica)** | Mostrar quem está dentro, sem expor dados sensíveis | `/painel`, `/painelgeral` |

---

## 4. Contexto legal (resumo prático)

### 4.1 Art. 253 da CLT — pausa térmica clássica

> "Para os empregados que trabalham no interior das câmaras frigoríficas e para os que movimentam mercadorias do ambiente quente ou normal para o frio e vice-versa, depois de **1 hora e 40 minutos** de trabalho contínuo, será assegurado um período de **20 minutos** de repouso, computado esse intervalo como de trabalho efetivo."

**Tradução para o produto:**
- A "pausa térmica" **não é intervalo de refeição** (esse é o do Art. 71 CLT, 1h para almoço).
- É uma **pausa de recuperação térmica**: o colaborador precisa **sair da câmara fria** e permanecer em ambiente aquecido/normal por **20 min** antes de retornar.
- Esse tempo **conta como trabalhado** (é pago, não desconta do banco de horas).
- O ciclo se reinicia: após a pausa, pode entrar de novo e trabalhar mais 1h40 contínua.

### 4.2 NR-36 (frigoríficos) e NR-15 Anexo 9 (frio)

- Exige **avaliação de exposição** e **medidas de proteção coletiva** (vestimenta, rotatividade, pausas).
- Reforça o Art. 253 e permite **pausas mais frequentes** conforme temperatura da câmara (câmaras abaixo de -18°C tipicamente exigem ciclos mais curtos).
- Exige **registro individualizado e auditável** — é aqui que a maioria das autuações do MTE ocorre.

### 4.3 Limites configurados no FrioSafe (default, ajustáveis por câmara)

| Cor / status | Tempo acumulado dentro | Ação |
|---|---|---|
| 🟢 Verde (`inside`) | 0–80 min | Operação normal |
| 🟡 Amarelo (`yellow`) | 80 min | Aviso: aproxima do limite |
| 🟠 Laranja (`orange`) | 90 min | Alerta: prepare-se para sair |
| 🔴 Vermelho (`blocked`) | 100 min | **Deve sair imediatamente** — pausa obrigatória |
| 🔵 Azul (`on_break`) | Em pausa térmica | 20 min fora da câmara, ciclo reinicia ao final |

> Os thresholds seguem o Art. 253 com margem de segurança (100 min = limite legal). Configuráveis em **Câmaras Frias → limites por área** para casos onde a NR-36 exige janelas menores.

### 4.4 O que é a "pausa" no FrioSafe

**Pausa térmica ≠ almoço ≠ ida ao banheiro.**

- É a **saída obrigatória da câmara fria** após atingir o tempo máximo contínuo.
- Duração padrão: **20 min** em ambiente normal (configurável por câmara).
- Registrada em `thermal_breaks` com `started_at`, `ended_at`, `completed`/`interrupted`.
- Se o colaborador retornar à câmara antes dos 20 min, a pausa é marcada como `interrupted` e vira **inconsistência** para o supervisor revisar.
- Ao completar 20 min, o contador de exposição zera e ele pode entrar novamente.

---

## 5. Escopo do produto (o que existe hoje)

### 5.1 Arquitetura de transparência em 4 camadas

**Camada 1 — Extrato do colaborador** (`/extrato`)
- Colaborador vê o próprio dia com todos os eventos, pausas e totais.
- Confirma com **PIN de 4 dígitos** (clickwrap + SHA-256 do snapshot).
- Trava lockout: 5 tentativas erradas → bloqueio por 15 min.
- Registro imutável em `daily_statement_confirmations`.

**Camada 2 — Fila do supervisor** (`/inconsistencias`)
- Scan automático detecta: sessão sem saída, exposição acima do limite, pausa interrompida, evento manual sem justificativa.
- Cada item vira `inconsistency_reviews` com ação (aceitar/contestar/corrigir).

**Camada 3 — Fechamento de período** (`/fechamento`)
- Cadeia de assinaturas: **supervisor → RH → jurídico**.
- Cada assinatura encadeia SHA-256 da anterior (blockchain interno).
- Uma vez fechado, o período é imutável (`period_closures` + `closure_signatures`).

**Camada 4 — Painel público em quiosque** (`/painel`, `/painelgeral`, `/loginpainel`)
- TV no chão de fábrica com semáforo de exposição.
- Autenticação por **código de 6 dígitos** (TTL 15 min) que pareia o dispositivo com token de longa duração.
- **Dados minimizados**: mostra apenas primeiro nome, hora de entrada, tempo decorrido, área.
- Sem login, sem CPF, sem foto — LGPD-safe para exibição pública.

### 5.2 Integração GuardIA (controle de acesso facial)

- **Push model**: FrioSafe envia colaboradores para GuardIA via `POST/PUT/DELETE /guardiaapi/person` (chave: CPF).
- **Polling de eventos**: `guardia-poll-events` roda via `pg_cron` a cada X minutos, com deduplicação idempotente e retry exponencial.
- **Mapeamento dispositivo → câmara**: cada leitor facial é fixo em uma câmara e configurado como entrada/saída.
- **Trilha forense**: `guardia-verify-chain` valida a cadeia de hashes dos eventos recebidos.
- **Backfill controlado**: reprocessamento por janela de datas, sem travar o cursor atual.

### 5.3 Simulador ao vivo (`/simulador`)

- Para treinamento e demonstração em clientes reais.
- Dispara Entrada/Saída/Pausa/força status crítico, refletindo em tempo real no `/painel` via broadcast Supabase Realtime.
- **Fila offline**: eventos são enfileirados em `localStorage` e reenviados quando a rede volta.

### 5.4 Modo demonstração público (`/demo`, `/painel-demo`)

- Tenant virtual `demo-tenant` populado com **~27k eventos** de maio a julho.
- Cobre casos-treinamento: exposição crítica, pausa interrompida, evento manual, mês fechado.
- Acessível sem login (políticas RLS dedicadas para `anon` no `tenant_id='demo-tenant'`).

---

## 6. LGPD — o essencial (resumido)

### 6.1 Bases legais aplicadas

| Dado tratado | Base legal (Art. 7º/11 LGPD) | Justificativa |
|---|---|---|
| Nome, CPF, matrícula | **Execução de contrato de trabalho** (Art. 7º, V) | Necessário para vínculo empregatício |
| Biometria facial (GuardIA) | **Consentimento específico** (Art. 11, I) + **cumprimento de obrigação legal** (NR-36) | Requer opt-in explícito, revogável |
| Eventos de entrada/saída, exposição | **Obrigação legal** (Art. 7º, II — CLT/NR-36) | Prova de conformidade em fiscalização |
| Assinaturas e hashes | **Legítimo interesse** (Art. 7º, IX) | Auditabilidade |

### 6.2 O que o produto implementa

1. **Consentimento explícito para biometria** — `employee_consents` com status `active`/`revoked`, timestamps imutáveis, `consent_audit_log` append-only.
2. **Renovação periódica** — `consent_renewal_notifications` avisa antes do vencimento.
3. **Bloqueio de captura sem consentimento** — flag `require_consent_before_capture` no `tenant_settings` impede eventos até o opt-in.
4. **Direito de acesso do titular** — `/extrato` dá ao colaborador visão completa dos próprios dados; exportação em PDF/CSV via `EmployeeDataExportDialog`.
5. **Direito de revogação** — colaborador pode revogar consentimento; sistema para de capturar biometria e agenda purga.
6. **Minimização** — painel público não expõe CPF, sobrenome ou foto.
7. **Retenção configurável por tenant** — `tenant_settings` guarda `biometric_retention_days`, `logs_retention_days`, `occurrences_retention_days`.
8. **Purga automática auditável** — `purge-retention` (Edge Function via cron) apaga dados vencidos e registra evidência em `retention_purge_log`.
9. **Isolamento multi-tenant** — RLS estrita: `can_read_tenant`/`can_write_tenant` em toda tabela `public`.
10. **Segredos server-side** — chaves da GuardIA, tokens, PINs (hash bcrypt) nunca vão ao cliente. `pin_hash` não é exposto via API.

### 6.3 O que o cliente (tenant) precisa fazer

- Nomear **Encarregado de Dados (DPO)** e cadastrá-lo em `tenant_settings`.
- Publicar **política de privacidade interna** (template disponível em `/lgpd-privacidade`).
- Coletar consentimento **antes** de cadastrar biometria no GuardIA.
- Definir prazos de retenção coerentes com CLT (mínimo 5 anos para registros trabalhistas) e LGPD (mínimo necessário para biometria).

---

## 7. Relatórios — o que existe e como usar

### 7.1 Relatório mensal individual (`/relatorios`)

- Um PDF por colaborador por mês, gerado com `jspdf`.
- Conteúdo: cabeçalho da empresa, dados do colaborador, tabela de sessões (entrada, saída, duração, câmara), pausas térmicas (completas/interrompidas), totais, lista de inconsistências, cláusula clickwrap, **SHA-256** do conteúdo.
- **Assinatura por PIN** (padrão) OU **ICP-Brasil PAdES** (upload de PDF assinado por certificado A1/A3).
- Armazenado em bucket privado Supabase; acesso via URL assinada (TTL curto).
- Registro em `monthly_report_signatures` com hash do PDF original, hash do PDF assinado, IP, user-agent, timestamp.

### 7.2 Resumo diário para RH/SST (`/resumo-diario`)

- Visão consolidada do dia: quantos colaboradores expostos, quantas inconsistências, ranking por severidade.
- Links diretos para evidências (eventos, ocorrências, anexos).
- Exportação CSV para uso interno e envio ao SESMT.

### 7.3 Extrato do colaborador (`/extrato`)

- Dia, semana ou mês.
- Confirmação por PIN vira comprovante juridicamente utilizável (equivalente a "assinatura eletrônica simples" da MP 2.200-2/2001, Art. 10 §2º).

### 7.4 Fechamento de período (`/fechamento`)

- Fecha um mês inteiro do tenant.
- Consolida totais, aplica assinaturas em cadeia (supervisor → RH → jurídico).
- Cada assinatura carrega o hash da anterior — quebra na cadeia = adulteração detectável.
- Uma vez fechado, tentativas de alterar `access_events` do período são bloqueadas por trigger.

### 7.5 Exportação LGPD do titular (dialog "Meus dados")

- Colaborador pode baixar tudo o que a empresa tem sobre ele em JSON+PDF.
- Atende o **direito de portabilidade** (LGPD Art. 18, V).

### 7.6 Auditoria de integração (`/configuracoes/integracao-guardia`)

- Logs paginados com filtros por severidade e período.
- Exportação CSV completa (não só o filtrado) para juntar em processos.

---

## 8. Requisitos não-funcionais

- **Disponibilidade:** painel público tolera queda de rede — mantém último snapshot visível, badge "Painel offline" com timestamp da última sync.
- **Latência:** simulador → painel < 2s (Supabase Realtime broadcast).
- **Acessibilidade:** WCAG AA, foco visível, `prefers-reduced-motion`, `aria-live` para toasts, atalho `Ctrl/Cmd+K` para busca.
- **PWA:** instalável, `start_url: /meu-dia`, service worker com estratégia "safe update".
- **Multi-tenant:** RLS obrigatória em toda tabela `public`; GRANT explícito por role.
- **Auditabilidade:** `access_events`, `employee_consents`, `closure_signatures`, `monthly_report_signatures` são **append-only** via trigger.
- **Design:** sistema "Glacier Cobalt" com tokens HSL, tema claro/escuro, Sora/Inter.

---

## 9. Métricas de sucesso

| Métrica | Meta | Como medir |
|---|---|---|
| % de dias fechados com assinatura completa | > 95% | `period_closures.status = 'signed'` |
| % de colaboradores que confirmam extrato diário | > 80% | `daily_statement_confirmations` / colaboradores ativos |
| Tempo médio para resolver inconsistência | < 24h | `inconsistency_reviews.resolved_at - created_at` |
| Exposições vermelhas (> 100 min) por mês | Tendência decrescente | count `access_events` com `accumulated_at_event > 100` |
| Uptime do painel público | > 99,5% | polling do `kiosk-panel` |

---

## 10. Fora de escopo (v1.0)

- App móvel nativo (usar PWA).
- Integração direta com eSocial (exportação CSV/PDF já cobre auditoria manual).
- IA preditiva de risco de LER/DORT.
- Reconhecimento facial próprio (delegado ao GuardIA).
- Faturamento/billing multi-tenant automatizado.

---

## 11. Glossário

- **Câmara fria (`cold_areas`)**: setor de trabalho com temperatura controlada abaixo do ambiente.
- **Pausa térmica (`thermal_breaks`)**: intervalo obrigatório de recuperação fora da câmara (default 20 min).
- **Exposição acumulada**: soma de minutos dentro da câmara desde a última pausa completa.
- **Fechamento (`period_closures`)**: consolidação assinada e imutável de um período (mês).
- **Clickwrap**: aceite formal por clique com texto exibido e hash registrado.
- **Extrato**: relatório individual do colaborador, confirmável por PIN.
- **Kiosk/Painel**: TV pública no chão de fábrica.

---

*Documento vivo — atualizar a cada release maior.*
