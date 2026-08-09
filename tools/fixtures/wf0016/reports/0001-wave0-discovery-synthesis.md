# Report 0001 — Wave 0 Discovery & Design Synthesis (Atividades)

> Síntese do swarm de 10 agentes (Run 1 = 5 discovery / Run 2 = 5 design+risk), 2026-06-16,
> worktree `../atividades-w0-planning`. Modelos: discovery em Sonnet (economia), design de
> arquitetura (B1/B2) em Opus. Fonte de verdade: leitura read-only do código + Supabase MCP.

## A. Verdade-terreno (reuso) — Run 1

### A1. Modal do paciente, notas, anexos
- Modal **compartilhado** `src/components/pacientes/modal/PacienteDetailModal.tsx` (usado por
  `/pacientes` `Pacientes.tsx:224` e por `/meus-leads` via `LeadsOverview.tsx:151`). Existe um
  `PacienteDetailModal2` experimental (pacientes2) — **não** é o canônico.
- Abas: triggers em `modal-tabs/DetailModalTabs.tsx:17-50` (`grid-cols-4`) + conteúdo em
  `modal-components/ModalContent.tsx:70-113`. Inserir "atividades" = +1 trigger (grid-cols-5) e +1
  `TabsContent`. Mobile (`MobileDetailModal`) herda automático.
- Notas: tabela `public.notas` (bigint PK; `paciente_id`, `usuario_id`, `texto`, `tipo_nota` enum,
  `anexo_path`, `created_at`, `last_update`, `usuario_nome`). Enum `tipo_nota` **já tem `'Atividade'`**.
  Hooks `useNotesFetching`/`useNoteCreation`/`useNoteManagement`; RPC `insert_note_with_validation`.
- Anexos: `storageUtils.ts:5` `uploadFileToSupabase` (storage-only, desacoplado); bucket
  **`notas-anexos` é PÚBLICO** (getPublicUrl). `FilePreview`/`AudioPlayer`/`ImageZoomModal` reusáveis.
- **Verdito**: tab/notas/anexos REUSÁVEIS; `atividades` é tabela separada; link via `notas.atividade_id`.

### A2. Permissões do funil, papéis, tenant/hospital/equipe
- Papéis enum `app_role` = SuperAdmin|Admin|Gestor|Supervisor|Consultor|Hospital. Hierarquia
  numérica via `has_access_level` (Hospital1<Consultor2<Supervisor3<Gestor4<Admin5<SuperAdmin6).
- Tenant: `get_current_user_cliente_id()`, `get_user_client_id_safe()`, `user_has_client_access()`,
  `user_has_client_access_via_hospital()`, `get_hospital_cliente_id()`, `get_user_equipe_id()`,
  `get_user_hospitals()→bigint[]`. `user_hospitals` (join), `profiles.equipe_id`/`equipes.responsavel_id`.
- Funil: enum `funnel_access_scope` (none|own|team|hospital|tenant); tabelas `funnel_role_defaults`
  + `funnel_assignments`; resolvers `funnel_scope_for(uuid,bigint,text)` + `can_access_patient_in_
  funnel`; `visibility_mode`-gated CASE; gates AS RESTRICTIVE; seed `seed_funnel_role_defaults()`.
  Migrations `20260603140000/140100`, `20260608150000/190000/191500/193000`. UI
  `src/components/configuracoes/funnels/access/*` + `FunnelSettings.tsx:186`.
- **Consultor gotcha**: RLS concede ao consultor visão hospital-wide do paciente; o "own-only" é só
  frontend → paridade. **Atividades resolve `own` na RLS** (ADR-0035 §4).
- **UUID SuperAdmin hardcoded** `6c61a75d-28d4-4a07-9b6d-5304b4a0615b` em vários DEFINER (não estender).

### A3. Procedimentos, dashboard, preferências
- `procedimentos_paciente` (bigint PK; status enum `status_procedimento`=pendente|agendado|ganho|
  faltou|perdido|cancelado; `valor_cobrado` numeric(10,2); `data_agendamento`). Transição
  `→agendado` é **frontend-only** (`useHandleAgendarReagendar.ts`); recomendado trigger durável.
  BRL: `src/utils/formatters.ts:9` `formatCurrency`.
- Dashboard `/pacientes`: cards via edge fn `indicadores-tempo-real` (TZ America/Sao_Paulo
  server-side). **Dropdown de período** (Hoje/Ontem/7/este-mes/…) está em
  `src/components/dashboard/DashboardFiltersDateRange.tsx` (não no /pacientes). Falta util
  date-range→bounds (criar).
- Preferências: sem tabela genérica; `notification_preferences` (user_id, cliente_id) é o mais
  próximo; ou localStorage (padrão `indicadores-expanded`).

### A4. Notificações, realtime, email, scheduling
- Bell `useNotifications.ts` é **RAM-only/efêmero** + `NotificationBell.tsx` — precisa de tabela
  persistida p/ lembretes. Tabela persistida análoga: `stale_lead_notifications`.
- Realtime: canal único `postgres_changes`; **`stale_lead_notifications` (`useStaleLeadNotifications.
  ts:54-77`) é o padrão exato do diálogo** (INSERT user-scoped → evento → UI).
- Email: **Resend** via `send-system-email`/`send-welcome-email` + tabela `email_templates`; **sem
  fila/rate-limit/provider_message_id/dedup**. From `no-reply@origemcrm.com`.
- Scheduling: **`pg_cron` ativo** (9 jobs; padrão `cron→pg_net→edge fn`, jobs 6/11/12). **`pgmq`
  instalado, 0 filas**. `pg_net` p/ fire-and-forget. Backup scheduler = `schedules-tick`. WhatsApp
  BullMQ (5 filas, backoff, DLQ, idempotência) **atrás do limite de módulo — espelhar, não importar**.

### A5. Inventário DB (live MCP)
- **`app_auth.tarefas`**: existe, RLS on, **0 policies** (inacessível), sem `cliente_id`, FK
  `id_nota` sem índice, coluna `tarefa_objetvo` (typo), PK bigint sem sequence. → **NÃO reusar**,
  remover em hygiene. `ai_tasks`/`round_robin_activity_settings`/`user_activity_tracking` ≠ atividade.
- Tenant: `cliente_id uuid` (topo) + `hospital_id bigint` (sub). Filhos via `paciente_id` herdam.
- Convenções: tabelas novas usam **uuid PK gen_random_uuid()**; enums nativos; numeric; `created_at`/
  `updated_at` + trigger com `SET search_path`; soft-delete `_excluidos` (legado) ou `deleted_at`
  (novo OK); migrations nomeadas `YYYYMMDDHHMMSS_...`. Indexar FK. **Última migration
  `20260615143949` UNNAMED** (verificar).
- Extensões: `pg_cron` 1.6, `pgmq` 1.5.1, `pg_net` 0.19, `moddatetime` 1.0. Cron jobs ativos
  (stage transition, retention, sla/stale redistribution via service_role). **pgmq.meta vazio**.
- Storage: `notas-anexos` **público** (PII pré-existente) → atividades usam **`atividades-anexos`
  privado**. `paciente-media`/`documents` privados.
- Advisors: ERROR app_auth.tarefas (RLS sem policy), security_definer_view `lifeone_sync_health`,
  3 tabelas backup sem RLS; WARN várias fns sem `SET search_path`. → toda fn nova com search_path.

## B. Design + risco — Run 2 (detalhe nos artefatos; aqui o essencial)

- **B1 Async**: híbrido **pgmq (filas) + pg_cron (scheduler/dispatcher) + pg_net (invocar edge fn)**.
  Tabelas `activity_outbox`/`activity_reminders`/`activity_deliveries` (uniques de idempotência +
  índices parciais `WHERE status='pending'`). Scheduler claim `FOR UPDATE SKIP LOCKED` + fairness
  `row_number() PARTITION BY cliente_id`. Workers com VT/backoff+jitter/DLQ/breaker(email)/rate-limit.
  **Matriz de falhas** resolvida por SKIP LOCKED + VT + status-check + `version` + uniques. Slice
  mínimo = outbox+reminders+in-app (W4); hardening (email/breaker/fairness/webhooks) depois.
  Padrão `net.http_post` GUC-URL + `x-internal-secret` confirmado em
  `20260602120000_adr_0018_phase4_notify_publish_trigger.sql:55-87`. Abertas: "gate" é fila ou
  síncrono? cardinalidade de reminders por atividade? retenção dos arquivos pgmq/deliveries.
- **B2 Domínio/RLS**: tabelas/enums/índices/RLS da §2-4 da SPEC. Decisões: (A) tenant próprio na
  atividade (paciente opcional); (B) soft-delete `deleted_at`; (C) consultor `own`. Trigger
  `enforce_atividade_transitions` (OLD→NEW) p/ complete/reschedule/reopen/edit-completed/override.
  Mascarar `valor` por view `atividades_safe`. Trigger de procedimento **separado** do existente
  `trg_sync_situacao_from_procedimento` (confirmado em `20260615120000_sync_situacao_from_
  procedimento.sql`), só enfileira no outbox. Migrations em ondas A..G reversíveis; regenerar types.
- **B3 LGPD/segurança**: checklist + 24 NO-GO (PII em log/Sentry/realtime/email; bucket público;
  paridade RLS; cross-tenant; consultor só front; novo ERROR advisors; verify_jwt=false; tenant do
  body; service_role no front; DEFINER sem search_path/REVOKE; UUID hardcoded; gate bloqueando
  logout/atividade inválida; sem idempotência email; fora do Art.18/retenção). GATE-01..10 testáveis.
  Refs ADR-0002/0011/0014/0019/0034 + `_shared/redact-pii.ts`/`logger.ts`/`tenant.ts`.
- **B4 QA**: 50 casos + carga mapeados a layers (unit/integration/RLS-SQL/concorrência), **sem e2e**.
  Harness RLS = two-JWT node ou SQL via MCP (sem pgTAP). Concorrência determinística (SKIP LOCKED,
  uniques, outbox) + load mínimo. DoD por wave. Cobertura ~80%/70%. Layout `src/test/{rls,load}/`.
- **B5 UX**: inventário REUSE/BUILD (35 itens); specs da aba, da página `/atividades` (período do
  dashboard ≠ filtro de data da lista), das 6 seções de Configurações; spec do gate dialog
  (gate-on/off, fila "1 de N", a11y, override, portal do Ver Paciente); deriveActivityStatus puro;
  badge variants. Riscos: 5-tab mobile, focus-trap vs. modal sobre gate, NotaComposer no gate.

## C. Agentes (IDs p/ continuidade via SendMessage, se necessário)
Run1: a230c7bddd6a2fab0 (modal/notas), af00a95ac0c5f8366 (permissões), a5dc767d299b9516b
(procedimentos/dash), adee562a2992e614e (notif/realtime/email), a3649d4eb0294687a (DB inventory).
Run2: aba131a8e57955abe (async), afeb65345ee28f623 (domínio/RLS), ae0991cab25b5eb81 (LGPD),
a05f15cedeefda22f (QA), a86d0a730c2762c0c (UX).
