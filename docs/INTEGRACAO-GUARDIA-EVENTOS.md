# Endpoint de Eventos de Acesso — Contrato para o GuardIA

> Este é o endpoint que o GuardIA precisa **expor** para completar a integração com o CoolGuard Pro. O CoolGuard já está pronto para consumi-lo (edge function `guardia-poll-events`). Como o GuardIA já registra de qual leitor veio cada reconhecimento facial, este trabalho é **expor dados existentes**, não criar rastreamento novo.

## Modelo: polling (o CoolGuard consulta)

O CoolGuard chama este endpoint a cada poucos minutos, sempre pedindo apenas os eventos mais recentes que o último já recebido, por meio de um cursor de data (`since`). Toda a resiliência (retry com backoff, deduplicação, avanço de cursor, reprocessamento) já está implementada do lado do CoolGuard. O GuardIA só precisa devolver a lista.

## Requisição

```
GET {guardia_url}{events_endpoint}?since={ISO-8601}&until={ISO-8601}&limit={n}
Headers:
  X-GuardIA-Token: <token>        (ou Authorization: Bearer <token>)
  Accept: application/json
```

### Parâmetros de query

| Parâmetro | Obrigatório | Descrição |
|-----------|-------------|-----------|
| `since` | Sim | Devolve eventos com timestamp **maior que** este valor (ISO-8601). É o cursor: o CoolGuard envia o timestamp do último evento já recebido. |
| `until` | Não | Limite superior de data (ISO-8601). Usado só em reprocessamento de janelas históricas (backfill). **Desejável** honrar. |
| `limit` | Não | Máximo de eventos por resposta (o CoolGuard pede em lotes, até ~200, teto 1000). Se houver mais, ele consulta de novo com o `since` avançado. |

### Ordenação

Devolver os eventos em **ordem crescente de timestamp** (mais antigo primeiro). Isso garante que o cursor avance corretamente e nenhum evento se perca entre os lotes.

## Resposta esperada (200)

Pode ser uma lista direta `[ … ]` ou um objeto `{ "events": [ … ] }`. O CoolGuard aceita as duas formas.

```json
{
  "events": [
    {
      "id": "evt-2026-0001-aZ9",
      "document": "12345678900",
      "device_id": "LEITOR-CF01-IN",
      "type": "entry",
      "timestamp": "2026-06-27T14:32:05-03:00",
      "person_name": "Maria A. da Silva",
      "local_id": "camara-01",
      "local_nome": "Câmara Fria 01"
    }
  ]
}
```

## Campos do evento (nomes flexíveis)

O CoolGuard normaliza variações de nome. Para cada conceito, **qualquer um** dos nomes abaixo é aceito — use o que já existir no GuardIA.

| Conceito | Nomes aceitos | Obrigatório | Observação |
|----------|---------------|-------------|------------|
| ID do evento | `id` / `event_id` | **Sim** | Único e estável. Chave de deduplicação. |
| CPF | `document` / `remoteid` / `cpf` | **Sim** | Dígitos do CPF (pode vir formatado). |
| Leitor de origem | `device_id` / `reader_id` / `dispositivo_id` | **Sim** | O leitor de onde veio a face. **Decisivo** — ver abaixo. |
| Data/hora | `timestamp` / `occurred_at` / `event_timestamp` | **Sim** | ISO-8601, de preferência com fuso. |
| Tipo | `type` / `direction` / `tipo` | Não | `entry`/`exit` ou `entrada`/`saida`. Apenas sugestão — ver abaixo. |
| Nome | `person_name` / `nome` | Não | Auditoria. |
| Local | `local_id` / `local_nome` | Não | Auditoria. |

Um evento sem **id**, **CPF**, **leitor de origem** ou **data** é descartado pelo CoolGuard (e registrado no log de auditoria). Esses quatro são o mínimo obrigatório.

## Por que o leitor de origem (`device_id`) é decisivo

No CoolGuard, cada leitor é mapeado a uma câmara fria e recebe uma **função**: `entrada` (inicia a exposição ao frio) ou `externo` (registra que a pessoa está fora/em pausa). Essa função, derivada do `device_id`, é a **autoridade** sobre o estado do colaborador e prevalece sobre o campo `type` do evento. Por isso o `device_id` deve vir **sempre**. Leitores ainda não mapeados aparecem numa tela de descoberta do CoolGuard para configuração.

## Respostas HTTP que o endpoint deve seguir

| HTTP | Quando | Reação do CoolGuard |
|------|--------|---------------------|
| 200 | Sucesso (lista, mesmo vazia) | Processa e avança o cursor |
| 401 / 403 | Token inválido | Para o ciclo e marca erro de autenticação |
| 4xx | Parâmetro inválido | Registra erro |
| 5xx / timeout | Falha temporária | Tenta novamente com backoff |

## Checklist de entrega (lado GuardIA)

- [ ] `GET` de eventos aceitando `since` (obrigatório), `until` e `limit`
- [ ] Cada evento com `id`, CPF, **leitor de origem** e `timestamp` (mínimo)
- [ ] Eventos ordenados por `timestamp` crescente
- [ ] Autenticação por header ou bearer (informar qual ao CoolGuard)
- [ ] Honrar `until` (para reprocessamento de janelas) — desejável

## Campos que o GuardIA pode precisar incluir/expor

Com base no OpenAPI v1.0.0 atual (que só tem cadastro de pessoas, visitantes, QR code e condomínio):

1. **O endpoint de eventos em si** — não existe na API atual. É o item principal.
2. **O leitor de origem por evento** — o GuardIA já tem essa informação internamente (sabe de qual leitor veio cada face); precisa apenas expô-la no payload do evento como `device_id`.
3. **Filtro por data (`since`/`until`) e `limit`** no endpoint de eventos, para o polling incremental funcionar.

Nenhum outro campo novo é necessário do lado do GuardIA além desses.
