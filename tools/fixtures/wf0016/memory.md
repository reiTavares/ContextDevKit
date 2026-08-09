# Workflow Memory - sistema-tarefas (Atividades)

Keep only durable handoffs and learnings that are not already in git, ADRs,
the PRD/PDR, SPEC, or DevPipeline cards.

## Current state

- **Wave 0 (planning) concluída** (2026-06-16). Workflow elevado de blueprint → plano
  production-grade. ADR-0035 (guarda-chuva) criado. Plano W1..W9 com pacotes P0..P2.
- **Wave 1 (Fundação DB) APLICADA EM PRODUÇÃO** (2026-06-16, worktree `../atividades-w1-db`). 3
  decisões ratificadas → ADR-0035 **Accepted**. 4 migrations aplicadas via MCP (owner-gated; backup
  DR manual do owner validado pelo `verify-server` oficial → marker legítimo) + hardening REVOKE dos
  trigger fns. **DoD tudo ✅**: cross-tenant/consultor=own **provado em produção** (chamadas reais a
  `can_access_atividade` c/ Consultor `e41687b6-…`); advisors **0 novo ERROR / 0 trap nosso**;
  tsc-app=0; 60 testes utils. Report `reports/0002-...` §I.
- **Wave 2 (History+Settings+Note-link+Domínio) APLICADA EM PRODUÇÃO** (2026-06-17, worktree
  `../atividades-w2-domain`). 4 migrations via MCP: `atividade_history` (append-only, emit helper,
  `enforce_atividade_transitions` reescrita W2 + trigger `created`), `atividade_settings` (seed 1/tenant,
  Gestor+ write), `notas.atividade_id`, view `atividades_safe` (mask valor, security_invoker). Hooks/
  services/Zod/permissões + `types.ts` regenerado + 92 testes + harness P5/P6. **DoD tudo ✅**:
  advisors **0 novo ERROR** (security 4=baseline, perf 0), tsc-app=0, **P6 fail-closed + created-history
  + append-only provados em dados reais**, seed 3/3 tenants. Adversarial Opus: GO 0-blockers (diff do
  trigger aditivo). Report `reports/0003-wave2-domain.md`.
- **Follow-ups da W1 resolvidos na W2**: (a) `types.ts` regenerado ✅; (b) hardening REVOKE já
  commitado como `_120400` (sessão anterior) ✅; (c) backup cleartext: o de `storage/backups/temp`
  já sumiu; apaguei 2 dumps cleartext de 08/06 em `backups/secure/` ✅. **Bug de tooling**:
  `backup:safe` mandava `backup_type:'pre-change'` (viola CHECK `manual|auto|pre-deploy`) → 500;
  corrigido p/ `pre-deploy`.
- **Carry-forward para frente**: P5 INSERT-path (harness autorado, rodar em CI); **W1 tautologia
  `atividades_restrict_assignee_tenant`** (`cliente_id=cliente_id` no `_120200`) → backlog hardening;
  NB-1 (`cancelled/expirada` sem history), NB-2 (reschedule dupla-emissão); `insert_note_with_validation`
  sem `atividade_id` (W3); Art.18/retenção das tabelas novas (W9).
- Próxima: **Wave 3 = Aba Atividades no modal do paciente** (dep: W2 aplicada). Ver `prompt_next_wave.md`.

## Aprendizados/refinamentos da W1 (durables)
- Helpers de permissão recebem **colunas, não ids** → `can_access_atividade(...)` nunca lê
  `atividades` (evita recursão sob FORCE RLS). Padrão a manter em todas as funções de policy.
- SuperAdmin via `get_user_access_level`, **nunca** o UUID `6c61a75d-...` (ADR-0035 risco A2).
- Atividade→funil = `pacientes.funnel_id`; atividade sem paciente usa MAX `activity_view_scope`
  entre concessões. Paciente é **teto** de visibilidade, não concessão.
- Harness RLS via stub usa superuser (BYPASSRLS) → prova predicados, **não** o caminho INSERT
  das RESTRICTIVE; provar INSERT com JWT `authenticated` real numa integração de W2 (P5).
- `funnel_assignments.activity_*` ficou NULLABLE (tri-state inherit) — revisar coerência em W2.

## Decisions / handoffs (durable)

- **Reuso confirmado** (file:line no report): modal compartilhado `PacienteDetailModal`
  (abas em `DetailModalTabs.tsx` + `ModalContent.tsx`); `NotasTab`/`NotaComposer`/`storageUtils`/
  `FilePreview` (anexos imagem/áudio); `DashboardFiltersDateRange` (período); `IndicadorCard`
  (cards); **`stale_lead_notifications` = padrão realtime do diálogo de lembrete**
  (`useStaleLeadNotifications.ts:54-77`); Resend via `send-system-email` + `email_templates`;
  `formatCurrency` em `src/utils/formatters.ts`.
- **Net-new** confirmado: `app_auth.tarefas` é órfã (0 policies, sem tenant) → NÃO reusar; `notas`
  é log, não task → `atividades` separada (uuid PK, enums nativos, numeric).
- **Async**: `pg_cron` ativo (padrão `cron→pg_net→edge fn`); **`pgmq` instalado, 0 filas (pronto)**;
  email Resend sem fila/dedup/provider_message_id. WhatsApp BullMQ atrás do limite de módulo.
- **Permissões**: estender `funnel_role_defaults`/`funnel_assignments` com colunas `activity_*`
  + resolver `activity_scope_for`/`activity_can`/`can_access_atividade`. **Consultor = `own`**.
- **3 decisões a confirmar com o owner antes da W1**: tenant próprio na atividade; soft-delete
  `deleted_at`; consultor `own`. (Recomendação: SIM nas três.)
- **Convenções de banco** (do agente supabase-guardian): uuid PK; `created_at`/`updated_at` +
  trigger com `SET search_path`; enums nativos (não text+check); migrations nomeadas
  `YYYYMMDDHHMMSS_atividades_<action>`; indexar TODO FK; helper sempre fail-closed (ADR-0034).
- **Última migration `20260615143949` é UNNAMED** — verificar intenção antes de desenhar em cima.

## Open risks

- Cadência sub-minuto do scheduler num DB historicamente frágil sob bulk reads → **load-test antes
  de prod**; começar em 60s. Confirmar granularidade de segundos do `pg_cron` desta instância.
- `pgmq` nunca exercitado nesta prod → maturidade operacional a provar; precisa de sweep de
  retenção dos arquivos pgmq + `activity_deliveries` (LGPD).
- Bucket `notas-anexos` é público (PII pré-existente) → atividades usam bucket **privado** novo
  `atividades-anexos`. NÃO herdar a exposição.
- Acessibilidade do gate dialog vs. focus-trap ao abrir "Ver Paciente" por cima (Radix) — definir
  com o agente `accessibility` antes da wave do gate.
- "Gate" como fila vs. checagem síncrona in-process: confirmar (não há fila `gate` entre as 6).
- Mascarar `valor` exige view `atividades_safe` (Postgres não tem RLS de coluna).
- Número do ADR (0035) pode colidir com worktrees paralelos → reconciliar no merge de governança.
