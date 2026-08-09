# SPEC - sistema-tarefas (módulo "Atividades")

> Reescrita na **Wave 0** (2026-06-16) a partir do prompt de implementação do owner + síntese do
> swarm de 10 agentes (2 runs de 5). Substitui o blueprint de roadmap anterior. Verdade-terreno
> (file:line, live MCP) em [reports/0001-wave0-discovery-synthesis.md](./reports/0001-wave0-discovery-synthesis.md).
> Decisões em [ADR-0035](../../decisions/0035-atividades-module-architecture.md).

---

## 1. Escopo

Módulo operacional **Atividades**: tarefas por paciente (paciente opcional), com tipos
configuráveis, histórico imutável, permissões (extensão do funil), notas/anexos reaproveitados,
lembretes multi-canal com diálogo/gate, integração automática com procedimentos, central
`/atividades`, aba no modal do paciente, Configurações CRM > Atividades, e camada assíncrona
(outbox + filas pgmq + scheduler pg_cron + workers). UI sempre "Atividades" (pt-BR); nunca "Tarefas".

**Fora de escopo v1:** WhatsApp/SMS/SIP, automações no-code, reuso de `app_auth.tarefas`, backfill
histórico, testes e2e.

## 2. Modelo de domínio (tabelas `public`, PK uuid, RLS + FORCE RLS)

### 2.1 Enums nativos
- `atividade_status`: `pendente | em_andamento | concluida | cancelada | expirada`
- `atividade_origem`: `manual | procedimento | automacao | api | sistema`
- `atividade_actor_tipo`: `usuario | sistema`
- `atividade_event_type`: ~28 valores (created, edited, title_changed, description_changed,
  type_changed, value_changed, due_changed, rescheduled, assigned, reassigned, transferred,
  patient_linked, procedure_linked, note_linked, completed, auto_completed, reopened, cancelled,
  expired, reminder_scheduled/sent/failed/cancelled, gate_blocked, gate_overridden, deleted, restored).

### 2.2 `atividades`
Campos: `id`, `titulo*`, `descricao`, `tipo_id*`→`atividade_tipos`, `status*` (default pendente),
`due_at`, **`cliente_id*`** (uuid, tenant próprio — Decisão A), **`hospital_id`** (bigint, NULL só
p/ tarefa tenant-wide), `paciente_id` (bigint, nullable, ON DELETE SET NULL), `procedimento_id`
(nullable), `assigned_to`→`profiles`, `ator_criador` (NULL quando origem≠manual),
`origem*`, `source_entity`, `source_entity_id` (text), `idempotency_key`, `automation_trigger_user_id`,
`valor` numeric(12,2), `moeda` char(3) default BRL, `reschedule_count`, `completed_at`,
`completed_by`, `version` (lock otimista), `created_at`/`updated_at`, `deleted_at`/`deleted_by`.
CHECKs: status concluida ⇒ completed_at not null; valor ≥ 0; paciente ⇒ hospital not null;
consistência tenant↔paciente via trigger; origem procedimento ⇒ idempotency_key.

### 2.3 `atividade_tipos`
`id`, `cliente_id` (NULL = default global de sistema), `slug`, `nome`, `descricao`, `icon`, `cor`,
`color_overrides` jsonb, `is_active`, `is_system`, `default_reminder_on`, `default_reminder_lead`
interval, `gate_on`, `reschedule_reason_required`, `delay_reason_required`, `sort_order`, `version`,
timestamps, soft-delete. Tipo de sistema **"Procedimento"** não pode ser excluído fisicamente.
Unique parcial por `(cliente_id, slug)` e por `slug` global.

### 2.4 `atividade_history` (append-only)
`id`, `atividade_id*` (CASCADE), `cliente_id*` (denormalizado), `event_type*`, `actor`
(NULL se sistema), `actor_tipo*`, `prev_values` jsonb, `next_values` jsonb, `reason`, `metadata`
jsonb, `nota_id` (→`notas`, SET NULL), `created_at`. **Sem UPDATE/DELETE policy** + `REVOKE`.

### 2.5 `atividade_settings` (1 linha/tenant; PK `cliente_id`)
Faixas de cor (`color_band_*_hours`, modo dias), `gate_enabled`, `reschedule_reason_required`,
`delay_reason_required`, version, timestamps. Toggle por-tipo sobrepõe o default do tenant
(efetivo = `type_toggle OR tenant_default`, resolvido no serviço, não na RLS).

### 2.6 Link nota↔atividade
`ALTER TABLE notas ADD COLUMN atividade_id uuid NULL REFERENCES atividades(id) ON DELETE SET NULL`
+ índice parcial. Nota com `tipo_nota='Atividade'` (valor já existe no enum). O link "qual nota
causou qual evento" vive em `atividade_history.nota_id`.

### 2.7 Índices (todo FK + hot paths)
Parcial `idx_atividades_pending_due (cliente_id, hospital_id, due_at) WHERE status='pendente' AND
deleted_at IS NULL`; `idx_atividades_assignee_open_due`; **UNIQUE idempotência**
`uq_atividades_idempotency (cliente_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND
deleted_at IS NULL`; history por `(atividade_id, created_at DESC)`.

## 3. Permissões (extensão do sistema do funil)

Colunas novas em `funnel_role_defaults` + `funnel_assignments`: `activity_view_scope`
(`funnel_access_scope`), `activity_create`, `activity_complete`, `activity_reschedule`,
`activity_assign`, `activity_edit_completed`, `activity_reopen`, `activity_view_value`,
`activity_override_gate`, `activity_manage_types`. Resolver irmão `activity_scope_for(user, funnel,
action)` + `activity_can(user, funnel, capability)` + `can_access_atividade(atividade, user,
action)` — espelham `funnel_scope_for`/`can_access_patient_in_funnel` (mesmos short-circuits
SuperAdmin/Admin, mesma regra `restricted`). `seed_funnel_role_defaults()` estendido.

**Consultor `activity_view_scope = own`** (Decisão C): vê só `assigned_to=self OR ator_criador=self`
(+, para atividades com paciente, só pacientes que já alcança). Gestor+ = hospital/tenant.
Override per-funnel via `funnel_assignments`.

Granulares mínimas mapeadas: `activities.view_own/view_team/view_tenant/create/edit_pending/complete/
reschedule/delete_pending/restore/assign/reassign/view_value/edit_completed/reopen_completed/
manage_types/manage_rules/manage_permissions/override_gate`.

## 4. RLS & transições

- **RLS** (predicados stateless): SELECT `USING (deleted_at IS NULL AND can_access_atividade(id,
  uid,'view'))`; INSERT WITH CHECK tenant + `activity_can(create)` + validade do assignee;
  UPDATE USING `can_access_atividade(id,'edit')`; DELETE físico bloqueado (soft-delete via UPDATE).
- **Predicados RESTRICTIVE** (cada um sua policy): assignee mesmo tenant; não atribuir a inativo;
  inferior não atribui a superior; supervisor só na própria equipe; hospital dentro do acesso do
  ator E do assignee.
- **Trigger `BEFORE UPDATE enforce_atividade_transitions()`** (precisa de OLD→NEW): complete exige
  `activity_can(complete)`; reschedule exige `reschedule` (+ incrementa `reschedule_count`);
  reabrir/editar concluída exige Gestor+ ou `edit_completed`/`reopen`; override exige
  `override_gate` + motivo → history.
- `valor`/`moeda` mascarados pela view **`atividades_safe`** quando sem `activity_view_value`.
- Dashboard/agregações: RPC `SECURITY INVOKER` (ou DEFINER derivando tenant do JWT, nunca do body).

## 5. Notas, anexos & motivos

Reuso integral de `NotasTab`/`NotaComposer`/`NotaFeed`/`NotaFilters`/`storageUtils`/`FilePreview`/
`AudioPlayer`/`ImageZoomModal`. Nota criada a partir de uma atividade: `tipo_nota='Atividade'`,
guarda `atividade_id`, aparece na aba Notas do paciente E dentro da atividade, com badge/link.
**Motivo de reagendamento** (oculto até "Reagendar"; obrigatório quando config exigir) e **motivo de
atraso** (oculto até vencer) salvos como nota tipo Atividade + registrados no histórico (com data
anterior/nova). Só conteúdo humano vira nota — eventos técnicos vão só ao histórico.
**Bucket privado novo `atividades-anexos`** (signed URL, path `{hospital_id}/{paciente_id}/
{atividade_id}/`, nomes sem PII) — nunca `notas-anexos` (público).

## 6. Status visual (derivado, não armazenado)

`deriveActivityStatus(dueAt, completed, {alertHours, criticalHours})` →
`pendente | vencida-breve | vencida-grave | concluida`. Concluída se completed; pendente se
now<due; vencida-breve (amarelo) se 0<atraso≤alert; vencida-grave (vermelho) acima. Faixas vêm de
`atividade_settings` (horas ou dias). Badge variants em `src/components/ui/badge.tsx`
(`warning`/`success`/`destructive` já existem; add `pendente`). Memoizar por linha.

## 7. Lembretes, diálogo & gate

- **Toggle "Ativar lembrete"** por atividade; antecedência/data; default do tipo como inicial.
- **3 canais**: notificação interna (tabela persistida + bell), email (assunto genérico pt-BR, sem
  dado clínico, link autenticado, sem anexos), **diálogo real** (não toast, não alert/confirm).
- **Diálogo `ReminderGateDialog`** (Radix Dialog, focus-trap): gate-off = dismissível; **gate-on** =
  sem Escape/backdrop, sem X, só sai por Concluir/Reagendar. **Fila** (Zustand) de vários lembretes:
  "1 de N", ordem mais-vencida→prazo, sem empilhar modais. **Override** per-permissão com motivo →
  audit. Copy manual ("Você definiu a atividade…") vs automática ("A atividade automática…").
  Editor de nota no diálogo = `NotaComposer` reusado (voz desabilitada dentro do gate).
- **Gate nunca bloqueia**: logout, recuperação de conta, abrir atividade/paciente, suporte, erro
  técnico; nem atua sobre atividade de outro tenant/fora de escopo/reatribuída/concluída/excluída/
  sem-permissão (re-validação server-side no display). Offline → diálogo no próximo login se aplicável.

## 8. Página `/atividades`

Rota + item no menu. Visão default "Minhas atividades". **Mini-dashboard** (cards Criadas/Pendentes/
Vencidas/Concluídas, computados server-side via edge fn/RPC) com **dropdown de período**
(`PeriodRangePicker` extraído de `DashboardFiltersDateRange`: Hoje/Ontem/7/15/30/90/Personalizado),
persistindo a última opção por usuário. **Controles distintos**: período do dashboard ≠ filtro de
datas da lista (separação visual e de estado explícita). Busca, ordenações (criação/entrega/
conclusão/título/valor), filtros (datas, hospital, situação, tipo, responsável/criador conforme
escopo). Lista paginada **server-side**, com avatares, "Ver Paciente" → **mesmo modal compartilhado**
(`defaultTab="atividades"`), nunca cópia. Skeletons/empty/error; filtros na URL.

## 9. Integração com procedimentos

`AFTER UPDATE OF status` em `procedimentos_paciente` (separado de `trg_sync_situacao_from_
procedimento`) **só enfileira** no `activity_outbox` (idempotency `proc:<id>:<status>`). Em
`→agendado`: cria atividade tipo "Procedimento" (origem procedimento, ator sistema, paciente/
hospital/responsável/valor/lembrete por config, chave de idempotência). Em ganho/faltou/perdido/
cancelado: sincroniza (cancela/auto-conclui a pendente). Reagendamento atualiza `due_at` (com data
antiga/nova no histórico). **Título** por similaridade normalizada (lowercase + `unaccent` + colapso
de espaços; ≥99% ⇒ não repete o nome): "Lembrete de agendamento — {tipo}[ — {nome}]". Atribuição:
responsável do procedimento → consultor do paciente → quem agendou → fallback do domínio (nunca a
inativo/fora do tenant). **Upsert idempotente** — sem nova atividade em retries. Sem backfill auto.

## 10. Camada assíncrona (outbox + filas + scheduler + workers)

- **Outbox transacional** `activity_outbox` (gravado na mesma transação da escrita); dispatcher
  `pg_cron→edge fn` poll `FOR UPDATE SKIP LOCKED` → `pgmq.send` (atômico).
- **Filas pgmq separadas**: `activity_reminder_dispatch`, `activity_in_app_notifications`,
  `activity_email_notifications`, `activity_procedure_sync`, `activity_webhooks`,
  `activity_dead_letter`. Prioridade gate > in-app > email > webhooks (drain por prioridade).
- **`activity_reminders`** persistente (tenant, activity, assigned_user, reminder_at, due_at,
  channel_mask, status, claimed/dispatched/completed/cancelled, attempts, last_error,
  idempotency_key, version). Scheduler `pg_cron` (30–60s) faz claim em lote `SKIP LOCKED` +
  **fair-scheduling** (`row_number() PARTITION BY cliente_id` + cap/tenant), ignora concluída/
  cancelada/reatribuída, re-claim por VT-lapse. Índice parcial `WHERE status='pending'`.
- **`activity_deliveries`** (channel, event, status, provider, `provider_message_id`, attempts,
  `idempotency_key` **UNIQUE** = `activity_id+event_type+channel+scheduled_at+version`,
  `UNIQUE(channel, provider_message_id)`).
- **Workers** (edge fns) com `pgmq.read(vt, qty)` → side-effect idempotente → `delete`/`set_vt`
  (backoff+jitter) → DLQ no max-attempts; circuit-breaker do email; rate-limit; `TENANT_MAX_
  CONCURRENCY`. Env: `WORKER_BATCH_SIZE/CONCURRENCY/VISIBILITY_TIMEOUT/MAX_ATTEMPTS/BACKOFF_BASE`,
  `EMAIL_RATE_LIMIT`, `BREAKER_*`.
- **Realtime é só entrega** (padrão `stale_lead_notifications`); banco é a fonte da verdade.
- **Matriz de falhas** (scheduler duplo / crash mid-process / email down / realtime down /
  reatribuição-na-fila / conclusão-na-fila / reschedule-na-fila / evento duplicado) coberta por
  SKIP LOCKED + VT + breaker + status-check + `version` + uniques de idempotência (ver report §B1).

## 11. Segurança, LGPD & observabilidade (gate de cada wave)

Checklist completo no report §B3 e no [ADR-0035](../../decisions/0035-atividades-module-architecture.md)
§8. Pontos NO-GO: PII em log/Sentry/realtime/email; bucket público; paridade RLS SELECT≠UPDATE/
DELETE; cross-tenant; consultor só no frontend; novo ERROR em `get_advisors`; `verify_jwt=false`
sem controle; tenant vindo do body; service_role no frontend/response; SECURITY DEFINER sem
`SET search_path`/`REVOKE`; UUID SuperAdmin hardcoded; gate bloqueando logout ou atuando sobre
atividade inválida; sem idempotência de email; tabelas fora do fluxo Art.18/retenção (ADR-0011).
Logs estruturados (create/fail/dedup/send/fail/retry/DLQ/gate/override/permission-denied/
inconsistência) **sem conteúdo sensível** via `_shared/logger.ts` + `redact-pii.ts`. Diagnóstico de
lembrete (agendado/aguardando/processando/enviado/confirmado/falhou/tentativas/último-erro).

## 12. Testes (tudo menos e2e)

Layers: **unit** (puros: deriveActivityStatus, canAssignTo, activity_scope_for, idempotency-key,
similaridade, sortByValor, isInDateRange/timezone), **integration** (hooks com stub Supabase: CRUD/
complete/reschedule/softdelete/restore + outbox), **RLS-SQL** (two-JWT node / SQL via MCP:
tenant-isolation, consultor/supervisor scope, assign-hierarchy, hospital), **concorrência**
(SKIP LOCKED duplo-claim, idempotência, no-dup-on-retry, fairness, crash recovery — determinístico;
load mínimo: 1k linhas, multi-claim Promise.all, backlog recovery). Os 50 casos funcionais +
testes de carga mapeados a waves no report §B4. Cobertura nova ~80% linhas / 70% branches.
Layout `src/test/{rls,load}/`, `src/hooks/atividades/`, `src/utils/atividades/`,
`supabase/functions/_shared/*`. **Sem e2e** (gap residual aceito: render real/CSS, throughput real,
multi-tab — mitigado por review + monitor).

## 13. Plano de Waves (pacotes P0..P2; cada wave = worktree + swarm de 10)

| Wave | Pacote | Conteúdo | Dep. |
| --- | --- | --- | --- |
| **W0** | — | **Planning** (este): discovery+design swarm, ADR-0035, PRD/SPEC/tasks, report. | — |
| **W1** | P0 | **Fundação DB**: enums; `atividade_tipos`+`atividades`+índices+triggers (updated_at, consistência, transições)+RLS+helpers; extensão de permissões do funil + seed; tipos de sistema (incl. "Procedimento"); util `deriveActivityStatus` + contrato `resolveAtividadeFromProcedimento`. | — |
| **W2** | P0/P1 | **History+Settings+Note-link+Domínio**: migrations history/settings/`notas.atividade_id`; services+hooks (create/complete/reschedule/softdelete/restore/list)+Zod+fns de permissão. | W1 |
| **W3** | P1 | **Aba Atividades no modal**: `DetailModalTabs` grid-5 + `ModalContent`; `AtividadesTab`+`AtividadeForm`(Sheet)+list/timeline; notas reusadas. | W2 |
| **W4** | P0 | **Núcleo assíncrono (slice mínimo)**: `activity_outbox`/`activity_reminders`/`activity_deliveries`+uniques+índices+RLS; filas pgmq (in-app + DLQ); scheduler pg_cron (SKIP LOCKED+fairness); worker in-app → notificação → diálogo realtime. | W1 |
| **W5** | P1 | **Página `/atividades` + dashboard**: rota, `PeriodRangePicker`, cards (edge fn), filtros+filtro-de-data distintos, paginação server-side, Ver Paciente, persistência de período. | W2 (+W4) |
| **W6** | P1 | **Integração com procedimentos**: trigger `AFTER UPDATE OF status`→outbox; worker upsert idempotente; similaridade de título; sync reagendar/cancelar/realizar. | W4 |
| **W7** | P1/P2 | **Canal email + gate dialog + hardening**: fila email + Resend (genérico, `provider_message_id`) + rate-limit + breaker; gate dialog + fila + override + a11y; fairness; DLQ + retry sweep. | W4 |
| **W8** | P2 | **Configurações > Atividades + UI de permissões**: 7ª aba, 6 seções (Tipos/Regras-cores/Lembretes/Gates/Motivos/Permissões) ligadas às colunas `activity_*`. | W1+W2 |
| **W9** | P2 | **Carga/concorrência + observabilidade + retenção LGPD + docs**: harness mínimo, métricas/alertas, Art.18/retenção das tabelas novas, docs/ADR closure, `map:refresh`. | todas |

Regras por wave (não-negociáveis): backup DR antes de migration (ADR-0013); `get_advisors` sem
novo ERROR; suíte (menos e2e) verde; ao fim — atualizar workflow+pipeline+report, **commit → merge
no `dev-backlog` local → log-session (haiku) → `prompt_next_wave.md` → finalizar sessão**.

## 14. Entrega final (por wave + global)

Resumo de arquitetura, reuso, decisões, migrations, tabelas/funções/triggers/views/índices, RLS,
matriz de permissões, fluxo de lembretes, fluxo da integração com procedimentos, arquivos criados/
alterados, testes executados e resultado real, riscos, deploy, rollback, pendências. Nada de mock no
lugar de função real; sem TODO silencioso; sem duplicar componente existente.
