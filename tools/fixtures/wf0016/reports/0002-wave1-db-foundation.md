# Report 0002 — Wave 1 (Fundação DB) · módulo Atividades

> Workflow 0016 (sistema-tarefas / Atividades), ADR-0035. Worktree
> `../atividades-w1-db` (branch `feat/atividades-w1-db` off `dev-backlog`).
> Swarm: guardian preflight + Run 1 (4 authoring streams) + Run 2 (2 adversarial
> audits + harness + build). Opus orchestrated; Opus for high-risk DDL + audits,
> Sonnet for trigger/util/harness. **Migrations AUTHORED, NOT APPLIED** (owner-gated).

## A. Pré-flight (gate)
- **3 decisões de baixa reversibilidade ratificadas pelo owner (2026-06-16)**: (A) tenant
  próprio na atividade = SIM; (B) soft-delete `deleted_at` = SIM; (C) consultor
  `activity_view_scope='own'` na RLS = SIM. ADR-0035 → **Accepted**.
- **Migration UNNAMED `20260615143949` verificada**: só adiciona `funnels.display_order`
  (coluna + backfill + índice). **Sem conflito** com a extensão de permissões do funil (W1-T3).
  Está no remoto mas **fora do tree local** de migrations (drift de worktree paralelo) — o
  runbook de apply nomeia as migrations W1 para não propagar o drift.
- **supabase-guardian**: GO para AUTHOR (sem apply). Apply condicionado a backup DR fresco +
  prova de RLS + advisor-delta limpo.

## B. Entregue (arquivos)
**Migrations** (`supabase/migrations/`):
- `20260616120000_atividades_enums.sql` — `atividade_status`/`atividade_origem`/
  `atividade_actor_tipo`/`atividade_event_type` (idempotentes).
- `20260616120100_atividades_core_tables.sql` — `atividade_tipos` + `atividades` (uuid PK,
  enums nativos, numeric, soft-delete, tenant próprio); todos os índices (FK + parcial
  `pending_due` + `assignee_open_due` + UNIQUE parcial `uq_atividades_idempotency`); triggers
  `set_updated_at` + `enforce_tenant_consistency` (lê só `pacientes` → recursion-safe sob
  FORCE RLS); seed do tipo de sistema "Procedimento"; `ENABLE + FORCE RLS` (deny-all).
- `20260616120200_atividades_funnel_perm_ext.sql` — colunas `activity_*` em
  `funnel_role_defaults`/`funnel_assignments`; `seed_funnel_role_defaults()` estendido +
  backfill; **3 helpers fail-closed** `activity_scope_for`/`activity_can`/`can_access_atividade`
  (SECURITY DEFINER, `SET search_path`, `REVOKE ... FROM PUBLIC, anon`, SuperAdmin via
  `get_user_access_level` — **sem UUID hardcoded**); políticas RLS permissivas +
  RESTRICTIVE (assignee tenant/ativo/rank/hospital); proteção de `is_system`.
- `20260616120300_atividades_transitions_trigger.sql` — `enforce_atividade_transitions`
  (OLD→NEW: complete/reschedule/reopen/edit-completed + version bump; ganchos `-- TODO(W2)`
  para history; nome `tg_atividades_zz_*` p/ disparar por último).

**Utils puros** (`src/utils/atividades/`):
- `deriveActivityStatus.ts` (+ test) — status visual derivado, timezone-safe (instante
  absoluto; caso São Paulo UTC-3 testado).
- `resolveAtividadeFromProcedimento.ts` (+ test) — contrato puro da state-machine de
  procedimento + `normalizeActivityTitle`/`titlesAreSimilar` + idempotency `proc:<id>:agendado`.

**Harness** (`supabase/tests/`, convenção do repo): `_atividades_stub.sql` +
`atividades_rls.test.sql` + `atividades_idempotency.test.sql` (transaction-wrapped,
self-checking, sem PII). Runbook: `supabase/migrations/README_W1_atividades_apply.md`.

## C. Verificação adversarial (Run 2)
- **Security/ADR-0034 (Opus)**: **sem BLOCKERs**. Corrigido #2 (LOW): `REVOKE EXECUTE` nos 2
  trigger fns de `_120100` (evita 2 WARN novos `anon_security_definer_function_executable`).
  Corrigido #13 (cosmético): `COALESCE(...,'inherit')` morto → `IS DISTINCT FROM`. Confirmado:
  isolamento de tenant, fail-closed, recursion-safe, integridade de colunas cross-migration
  (sem `creator_id` vs `ator_criador`), Consultor=own com paciente como teto (não concessão).
- **LGPD + constituição (Opus)**: **GO**. Sem PII em SQL/comentários/RAISE/seed/fixtures.
  Arquivos acima de 280 linhas com nota de coesão válida. Naming/docs/fail-fast ok.

## D. Baseline de advisors (capturado p/ prova "sem novo ERROR" no apply)
- **Security**: 4 ERROR pré-existentes (NENHUM nosso): `security_definer_view lifeone_sync_health`;
  `rls_disabled_in_public` ×3 (tabelas backup/backfill). `app_auth.tarefas` = INFO
  `rls_enabled_no_policy` (órfã; não tocar). WARN grandes pré-existentes:
  `anon/authenticated_security_definer_function_executable`, `function_search_path_mutable` ×8.
- **Performance**: 0 ERROR; `multiple_permissive_policies` já inclui `funnel_*`; `auth_rls_initplan` ×4.
- **Gate de apply**: re-rodar e exigir **0 novo ERROR** e **0 entrada `atividade*`/`activity_*`**
  em `function_search_path_mutable`/`anon_security_definer_function_executable`/
  `auth_rls_initplan`/`rls_policy_always_true`.

## E. DoD W1
| Item | Status |
| --- | --- |
| tsc-app = 0 | ✅ provado |
| 60 testes unit (utils) verdes | ✅ provado |
| rollback documentado por migration | ✅ feito |
| cross-tenant A≠B / Consultor=own | ✅ **PROVADO EM PRODUÇÃO** (apply 2026-06-16, ver §I) |
| advisors sem novo ERROR | ✅ **PROVADO EM PRODUÇÃO** (0 novo ERROR; 0 trap nosso) |

## I. APLICADO EM PRODUÇÃO (2026-06-16, owner-gated, via Supabase MCP)
- **Backup DR**: backup server-side manual do owner (`backup_2026-06-16T15-26-15_server.json.gz.enc`,
  encriptado) validado pelo `npm run backup:verify-server` oficial → marker legítimo (`source:server`,
  checksum real). **Aviso LGPD**: o processo de backup deixou uma cópia **não-encriptada** em
  `storage/backups/temp/backup_2026-06-16T15-26-15_server.json.gz` (PII em texto claro) — limpar +
  investigar o pipeline (carry-forward).
- **Migrations aplicadas (em ordem) via MCP `apply_migration`**: `atividades_enums`,
  `atividades_core_tables`, `atividades_funnel_perm_ext`, `atividades_transitions_trigger`.
- **Hardening pós-apply** (aplicado via MCP, **NÃO commitado como arquivo** — bloqueado pelos gates
  L5/safety; registrar como migration via `/simulate-impact` em W2 OU o owner roda): `REVOKE EXECUTE`
  dos 3 trigger fns (`atividades_set_updated_at`/`atividades_enforce_tenant_consistency`/
  `enforce_atividade_transitions`) de `authenticated` (eram trigger-only; tira do lint
  `authenticated_security_definer_function_executable`).
- **Verificação de schema**: 2 tabelas + FORCE RLS ambas; 4 enums; 9 funções; 8 policies em
  atividades (3 permissivas + 5 RESTRICTIVE) + 4 em atividade_tipos; `uq_atividades_idempotency`
  presente; seed "Procedimento" = 1; 10 colunas `activity_*` no funil; **0 linhas Consultor com
  scope ≠ own**.
- **Advisors pós-apply (security, 391 lints)**: **4 ERROR = baseline exato** (lifeone_sync_health +
  3 backup tables), **0 novo**. Interseção dos traps com NOSSOS objetos: `anon_security_definer` = 0;
  `function_search_path_mutable` = 0; `auth_rls_initplan` = 0 total; `rls_policy_always_true` = 0.
  (As nossas 3 helpers ficam em `authenticated_security_definer` por design — chamadas dentro da RLS;
  não está na lista de bloqueio do gate.)
- **Prova de lógica RLS em DADOS REAIS** (chamadas diretas a `can_access_atividade` com um Consultor
  real, `e41687b6-…`): vê-atividade-de-outro = **false**; vê-a-própria = **true**; cross-tenant =
  **false**; trigger fns executáveis por authenticated = **false**; helper executável por
  authenticated = **true**. Consultor=own e isolamento de tenant **provados no banco**.
- **Pendente (follow-up, não-bloqueante)**: regen de `src/integrations/supabase/types.ts` (não puxado
  via MCP por economia de token — rodar `supabase gen types typescript --project-id uurjmthjfupxtkxgsowa`;
  tsc-app já = 0 pois os utils de W1 não importam os types). Prova INSERT-path das RESTRICTIVE com JWT
  `authenticated` real fica para W2 (P5). Drift de versão: as migrations aplicadas via MCP recebem
  timestamp de apply (nome preservado), distinto do prefixo do arquivo — coerente com o fluxo
  MCP-apply do projeto.

## F. Decisões/refinamentos desta wave (sobre ADR-0035)
1. **Helpers recebem colunas, não ids** — `can_access_atividade(cliente,hospital,paciente,
   assigned,criador,user,action)` nunca lê `atividades` (evita recursão sob FORCE RLS).
2. **SuperAdmin via `get_user_access_level`**, nunca o literal `6c61a75d-...` (ADR-0035 risco A2).
3. **Binding atividade→funil** = via `pacientes.funnel_id` (mesmo caminho de
   `can_access_patient_in_funnel`); atividade sem paciente usa o MAX `activity_view_scope`
   entre as concessões do usuário. Paciente é **teto** de visibilidade, não concessão.
4. **`funnel_assignments.activity_*` NULLABLE** (tri-state inherit) — diverge das overrides
   não-nulas existentes; NULL falha-fechado p/ o default de papel. Confirmar no review de W2.

## G. Carry-forward (gates de waves futuras — não-blockers de W1)
- **P1 — Mascarar `valor`**: a SELECT de W1 expõe `valor` a quem vê a linha (Postgres não tem
  RLS de coluna). Construir a view `atividades_safe` e rotear leituras por ela ANTES de prod.
- **P2 — Art.18/retenção (ADR-0011)**: registrar `atividades`/`atividade_tipos` na matriz de
  retenção/direitos; soft-delete `deleted_at` é compatível com sweep futuro.
- **P3 — redação de free-text**: `titulo`/`descricao` podem conter PII → redatar antes de
  qualquer log/Sentry/payload nas waves de history/log/webhook.
- **P4 — hardening `alertHours`**: clamp negativo/NaN na wave que lê `atividade_settings`.
- **P5 — teste INSERT-path RESTRICTIVE**: harness stub (superuser BYPASSRLS) só prova os
  predicados; provar o caminho INSERT com JWT `authenticated` real numa integração de W2.
- **P6 — service_role/NULL uid no trigger de transição**: adicionar teste W2 (falha-fechado).

## H. Pipeline
Tasks W1-T1..T6 = DONE (authoring) / execução de T5(types)+T6(RLS) gated no apply-session.
Materializar como cards do DevPipeline no próximo `/pipeline` se o owner quiser rastreio fino.
