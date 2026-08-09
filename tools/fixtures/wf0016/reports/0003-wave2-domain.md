# Report 0003 — Wave 2 (History + Settings + Note-link + Domínio) · módulo Atividades

> Workflow 0016 (sistema-tarefas / Atividades), ADR-0035. Worktree `../atividades-w2-domain`
> (branch `feat/atividades-w2-domain` off `dev-backlog`). Swarm: guardian preflight + Run 1
> (4 authoring streams) + Run 2 (DB-security/fixes + integration tests + RLS-SQL harness + build +
> adversarial Opus review). **APLICADA EM PRODUÇÃO** (2026-06-17, owner-gated; backup DR fresco).

## A. Pré-flight (gate)
- **supabase-guardian: CONDITIONAL GO**. Achou o **BLOCKER B1** (`atividade_history.nota_id` tinha
  de ser `bigint` — `notas.id` é bigint, não uuid); o agente de history já corrigiu para `bigint`.
  Tightening B2 (REVOKE SELECT anon/PUBLIC + GRANT SELECT authenticated) aplicado. Baseline de
  advisors capturado: 4 ERROR pré-existentes (lifeone_sync_health + 3 backup tables), nenhum nosso.
- **Adversarial review (Opus): GO, 0 blockers**. Diff linha-a-linha provou que a reescrita de
  `enforce_atividade_transitions` é **aditiva** (as 5 regras W1 idênticas; só somou emits de history
  + detecção deleted/restored + edit genérico). Versão sem off-by-one (`v_next_version=OLD.version+1`).
  Non-blockers backlog: NB-1 (transições `cancelada/expirada` ainda sem evento de auditoria — fora
  dos 5 hooks nomeados da W2), NB-2 (reschedule emite `rescheduled`+`due_changed`).

## B. Entregue (arquivos)
**Migrations** (`supabase/migrations/`, aplicadas via MCP nesta ordem):
- `20260616121000_atividades_history.sql` — tabela `atividade_history` (append-only); índices
  (atividade+created desc, cliente_id, nota_id parcial); RLS **ENABLE (não FORCE)** + 1 policy SELECT
  por tenant (`user_has_client_access((SELECT auth.uid()), cliente_id)`) + `REVOKE
  INSERT/UPDATE/DELETE/TRUNCATE` + `REVOKE SELECT FROM anon,PUBLIC` + `GRANT SELECT TO authenticated`;
  helper `atividade_log_event(...)` SECURITY DEFINER (REVOKE de PUBLIC/anon/authenticated — só
  triggers); **`enforce_atividade_transitions()` reescrita (W2)** com emits nos 5 hooks + deleted/
  restored + edit genérico fine-grained; trigger `tg_atividades_aa_history_created` AFTER INSERT
  emitindo `created`.
- `20260616121100_atividades_settings.sql` — `atividade_settings` (1 linha/tenant, PK cliente_id);
  CHECKs (mode hours/days; hours ≥ 0; critical ≥ alert); trigger updated_at (reusa
  `atividades_set_updated_at()`); RLS ENABLE+FORCE; SELECT = membro do tenant, INSERT/UPDATE =
  Gestor+ (`get_user_access_level((SELECT auth.uid())) IN ('Gestor','Admin','SuperAdmin')`); seed
  1 linha por `clientes` (ON CONFLICT DO NOTHING).
- `20260616121200_atividades_note_link.sql` — `notas.atividade_id uuid` (FK → atividades, ON DELETE
  SET NULL) + índice parcial. Documenta reuso obrigatório do RPC `insert_note_with_validation` em W3
  (assinatura confirmada; **não tem `atividade_id` — W3 decide UPDATE pós-insert OU RPC wrapper**).
- `20260616121300_atividades_safe_view.sql` — view `atividades_safe` **`security_invoker=true`**;
  `valor`/`moeda` mascarados por `activity_can(auth.uid(), paciente_id, 'view_value')`; GRANT SELECT
  authenticated, REVOKE anon. (Carry-forward P1 da W1 — endereçado.)

**Frontend** (`src/`):
- `src/hooks/atividades/schemas.ts` — Zod + interfaces (create/update/complete/reschedule/list).
- `src/hooks/atividades/atividadesServiceErrors.ts` — `AtividadeServiceError` + `assertOneRowAffected`.
- `src/hooks/atividades/atividadesService.ts` — data layer: leituras via **`atividades_safe`**;
  escritas via `atividades`; transições = UPDATE com `version` (optimistic lock, `{count:'exact'}`);
  front nunca seta completed_at/reschedule_count nem decide permissão (trigger faz).
- `src/hooks/atividades/useAtividades.ts` — hooks TanStack (create/complete/reschedule/softDelete/
  restore/list + update) com invalidação e erro pt-BR.
- `src/utils/atividades/permissions.ts` — fns puras `canAssignTo`/`canEditCompleted`/`filterActiveUsers`.
- `src/integrations/supabase/types.ts` — **regenerado** pós-apply (reflete history/settings/safe/atividades).

**Testes** (`src/hooks/atividades/*.test.ts(x)`, `src/utils/atividades/permissions.test.ts`,
`supabase/tests/*.sql`): 92 unit/integration verdes (cobertura ≥85% linhas/branch nos arquivos novos);
harness RLS-SQL (history append-only, settings Gestor+, safe-view masking) + **P5 INSERT-path c/ JWT
real** + **P6 NULL-uid fail-closed** (rodáveis em DB completo/CI).

## C. APLICADO EM PRODUÇÃO (2026-06-17, owner-gated, via Supabase MCP)
- **Backup DR**: o owner gerou backup manual no app (SuperAdmin → edge `create-backend-backup`
  server-mode KMS); validado pelo `npm run backup:verify-server` oficial (4 min, server, cifrado) →
  marker legítimo. **Bug de tooling corrigido**: `backup:safe` mandava `backup_type:'pre-change'`,
  que viola o CHECK `backend_backups_backup_type_check (manual|auto|pre-deploy)` → 500; trocado p/
  `pre-deploy` em `contextkit/tools/scripts/backup-safe.mjs`.
- **Migrations aplicadas** (4, na ordem 121000→121100→121200→121300) via MCP `apply_migration`.
- **Verificação de schema**: history (RLS on, FORCE off, 1 policy SELECT, authenticated sem
  INSERT/UPDATE/DELETE), settings (FORCE RLS, **seed 3 = 3 clientes**), `notas.atividade_id` presente,
  `atividades_safe` (security_invoker=true), triggers `aa_history_created`+`zz_enforce_transitions`,
  helper `atividade_log_event` presentes.
- **Advisors pós-apply**: **security 4 ERROR = baseline exato, 0 novo**; **performance 0 ERROR**.
  0 objeto `atividade_*` nosso em `function_search_path_mutable`/`anon_security_definer`/
  `auth_rls_initplan`/`rls_policy_always_true`. (Os hits `*activity*` em anon_security_definer são a
  feature legada de activity-tracking, pré-existentes.) Minor: 1 unindexed_fk + 15 unused_index
  (tabelas novas sem tráfego) — follow-up não-bloqueante.
- **tsc-app = 0** (após regen de types + 5 fixes reais: `cliente_id` no create schema; 4× mover
  `{count:'exact'}` do `.select()` para o `.update()`; cast `TablesInsert` por `strictNullChecks=false`).
- **Provas de RLS em dados reais** (transação, rollback): `created`-history do caminho sistema
  (actor NULL/sistema) ✅; **complete sob uid NULL = NEGADO** (P6 fail-closed) ✅; history grava via
  DEFINER ✅; append-only provado pelo grant (authenticated sem write) ✅.

## D. DoD W2
| Item | Status |
| --- | --- |
| tsc-app = 0 | ✅ |
| 92 testes unit/integration verdes | ✅ |
| migrations aplicadas + rollback documentado | ✅ |
| advisors sem novo ERROR | ✅ **provado em prod** |
| append-only / masking / P6 fail-closed | ✅ **provado em prod** |
| seed settings = nº de tenants | ✅ (3/3) |

## E. Carry-forward (gates de waves futuras)
- **P5 (INSERT-path RESTRICTIVE c/ JWT real)**: arquivo de teste autorado; rodar em CI/DB completo
  (não exercido contra prod por fragilidade — superuser bypassa RLS).
- **W1 tautologia** `atividades_restrict_assignee_tenant` (`cliente_id = cliente_id` no WITH CHECK do
  `_120200`): defeito de fonte da W1 (latente; cross-tenant ainda barrado pela restritiva de
  hospital). **Backlog: hardening W1** (architect/security). Não tocado nesta wave.
- **NB-1**: emitir `cancelled`/`expirada` no history (transições não cobertas pelos 5 hooks). **NB-2**:
  dedup `rescheduled`+`due_changed` na timeline (W3).
- **insert_note_with_validation** sem `atividade_id` → W3: UPDATE pós-insert OU RPC wrapper (não criar
  novo caminho de nota). Migrar `src/hooks/notes/useNoteCreation.ts:92-131` para o RPC.
- **P2 (Art.18/retenção, ADR-0011)**: registrar `atividade_history`/`atividade_settings` (+ W1) na
  matriz de retenção/direitos — anotado para W9.
- **types.ts** regenerado nesta wave (era follow-up da W1) — feito.

## F. Próxima wave
**W3 — Aba Atividades no modal do paciente** (P1, dep: W2). Ver `prompt_next_wave.md`.
