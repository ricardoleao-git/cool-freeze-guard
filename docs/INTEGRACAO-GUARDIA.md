# Integração GuardIA ↔ CoolGuard Pro — Visão geral

Este documento descreve como o CoolGuard Pro se integra ao GuardIA. Há **dois caminhos**, que coexistem: um disponível **hoje** (para demonstração e primeiros clientes) e um **definitivo** (que o Tiago implementa no GuardIA). Ambos estão documentados aqui porque a equipe do GuardIA acessa este projeto.

## Princípio

O CoolGuard Pro **sempre busca os dados do GuardIA** — nunca conversa diretamente com os equipamentos/leitores. O GuardIA é a fonte única de verdade sobre pessoas e acessos. Isso mantém a integração simples e centralizada.

## Identificação

- A **chave universal do colaborador** é o **CPF** (somente dígitos). O CoolGuard remove pontuação automaticamente. No GuardIA esse valor corresponde ao campo `document` / `remoteid`.
- Cada leitura facial tem um **leitor de origem** (o GuardIA já registra de qual leitor/câmera veio cada reconhecimento). Esse identificador de leitor é essencial para o CoolGuard saber a qual câmara fria e a qual função (entrada/externo) o evento pertence.

## Autenticação

Configurável por cliente (tenant) na tela de Integração do CoolGuard:
- **Esquema**: cabeçalho (`header`) ou `bearer`.
- **Cabeçalho padrão**: `X-GuardIA-Token: <token>`.
- **Caminho base da API**: `api_base_path` (padrão `/guardiaapi`).

O token é um segredo combinado por cliente. Basta liberar a chave/token para a integração começar a funcionar.

## Caminho A — Disponível HOJE (sincronização de colaboradores)

Usa o que a API do GuardIA já expõe (OpenAPI v1.0.0).

**Sentido**: o CoolGuard **empurra** colaboradores para o GuardIA.
**Endpoint usado**: `POST /guardiaapi/person/{remoteid}` (com fallback automático para `PUT` em 409/422; `DELETE` para inativos quando aplicável).
**Mapeamento de campos**:
- `remoteid` = CPF normalizado (somente dígitos)
- `person_name` = nome do colaborador
- `document` = CPF
- `statusid` = 1 ativo · 2 inativo · 3 bloqueado
- `persontypeidintegration` = 2 (acesso 24h)
- foto em Base64, quando disponível

**Função responsável no CoolGuard**: edge function `guardia-sync-employees`.

> **Limitação importante do Caminho A**: a API atual do GuardIA **não expõe os eventos de acesso** (entrada/saída nos leitores). Portanto, hoje, o CoolGuard consegue sincronizar o cadastro de colaboradores, mas **não recebe automaticamente as entradas e saídas das câmaras frias**. Para demonstração ao cliente, usa-se o tenant de demonstração (dados simulados) e a ingestão de eventos por API/simulador já existente. O recebimento automático de eventos reais depende do Caminho B.

## Caminho B — Definitivo (a implementar no GuardIA)

O GuardIA expõe um **endpoint de eventos de acesso** que o CoolGuard consulta periodicamente (polling). Esta é a peça que falta e está detalhada em `docs/INTEGRACAO-GUARDIA-EVENTOS.md`.

Quando esse endpoint existir, o fluxo fica 100% automático: o CoolGuard busca os eventos novos a cada poucos minutos, aplica a máquina de presença (entrada inicia exposição ao frio; leitor externo registra saída/pausa) e alimenta todas as camadas (extrato, inconsistências, fechamento, painel de TV).

**Função responsável no CoolGuard**: edge function `guardia-poll-events` (já pronta; só aguarda o `events_endpoint` ser configurado).

## Resumo para a equipe do GuardIA (Tiago)

1. **Hoje**: receber colaboradores via `POST /guardiaapi/person` já funciona. Basta liberar o token.
2. **Próximo passo (prioritário)**: expor o endpoint de eventos descrito em `docs/INTEGRACAO-GUARDIA-EVENTOS.md`. Como o GuardIA já sabe de qual leitor veio cada face, trata-se de **expor** o que já é registrado, não de criar rastreamento novo.
