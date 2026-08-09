# PRD/PDR - sistema-tarefas (módulo "Atividades")

> Reescrito na Wave 0 (2026-06-16) a partir do prompt de implementação do owner +
> síntese do swarm de 10 agentes. Detalhe técnico em [spec.md](./spec.md); decisões em
> [ADR-0035](../../decisions/0035-atividades-module-architecture.md); plano de execução em
> [tasks.md](./tasks.md); evidência de descoberta em
> [reports/0001-wave0-discovery-synthesis.md](./reports/0001-wave0-discovery-synthesis.md).

## Problema

O Origem CRM cobre captação, funil, pacientes, procedimentos e relatórios, mas **não existe uma
fila operacional de "próxima ação" por paciente**. Sem uma atividade com responsável, prazo,
status e histórico, contatos/mensagens/ligações/automações futuras não respondem à pergunta
central: *qual é a próxima ação necessária para este paciente?* Há oportunidade perdida entre
etapas (confirmações, retornos, pós-op) e nenhuma trilha auditável de quem fez o quê e quando.

## Objetivo

Entregar um **módulo operacional Atividades**, multi-tenant e production-ready, que:

- Modela atividades ligadas a paciente (opcional), cliente, hospital, responsável, tipo, prazo,
  valor (opcional), origem e status — com **histórico imutável** de auditoria.
- Tem **tipos configuráveis** por tenant (+ tipo de sistema "Procedimento") e faixas de cor/SLA.
- Reaproveita o **modal do paciente** (nova aba), o **editor de notas/anexos**, o **sistema de
  permissões do funil**, o **filtro de período** e o **realtime** — sem duplicar nada.
- Entrega uma **central `/atividades`** com mini-dashboard, filtros e lista paginada server-side.
- Cria **atividade automática** quando um procedimento entra em "agendado" e sincroniza
  reagendamento/cancelamento/realização — idempotente, sem duplicar em retries.
- Dispara **lembretes multi-canal**: notificação interna, email (ao usuário do CRM, assunto
  genérico, sem PII) e **diálogo na aplicação** com **gate** opcional de conclusão.
- Suporta carga (muitas tenants/usuários/lembretes) via **outbox transacional + filas separadas
  + scheduler server-side + workers** com idempotência, backoff, DLQ e fair-scheduling por tenant.

## Não-objetivos (v1)

- Enviar WhatsApp/Telegram/SMS ou originar ligações SIP (são pontes/eventos futuros P8/P9).
- Editor no-code de automações (P10).
- Reusar `app_auth.tarefas` ou estruturas de "task" de jobs/IA.
- Backfill automático de procedimentos históricos.
- Testes **e2e** (o owner excluiu e2e; cobre-se unit/integration/RLS/concorrência).

## Personas & papéis

Consultor, Supervisor, Gestor, Admin, SuperAdmin (enum `app_role`) + papel `Hospital`. Escopo de
visão/atribuição segue a hierarquia e os hospitais/equipes do usuário, **enforced na RLS**
(consultor = `own` por padrão), nunca só no frontend.

## Métricas de sucesso

- Atividades pendentes/vencidas/concluídas visíveis e corretas por período, tenant, papel.
- Zero vazamento cross-tenant (teste A-não-vê-B verde em cada wave).
- Lembrete entregue idempotente nos 3 canais sem duplicação; gate nunca bloqueia logout/recuperação.
- `get_advisors` sem novo ERROR após cada migration; suíte (menos e2e) verde por wave.

## Requisitos (resumo — detalhe na SPEC)

Campos da atividade, tipos, histórico (~28 eventos), notas/anexos, lembretes + diálogo + gate,
permissões granulares `activities.*`, Configurações CRM > Atividades (6 seções), página
`/atividades` (dashboard + filtros + lista), integração com procedimentos, modelagem/performance,
RLS/segurança, observabilidade, rollout incremental, e a arquitetura obrigatória de filas/outbox.

## Riscos principais

Ver [memory.md](./memory.md) §Open risks (DB frágil + cadência do scheduler; pgmq imaturo nesta
prod; bucket público pré-existente; acessibilidade do gate; "gate" fila vs. síncrono).

## Status

**Wave 0 (planning) concluída.** Próxima: Wave 1 (Fundação DB). Disciplina por wave:
worktree próprio + swarm de 10 agentes + commit/merge/log-session/prompt_next_wave.
