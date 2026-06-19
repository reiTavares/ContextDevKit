---
slug: sistema-tarefas
kind: feature
number: 0016
started: 2026-06-15T17:54:46.192Z
branch: dev-backlog
currentPhase: ship
intake: done
intake-ref: prompt de implementação do owner (feature_implementation_origem_crm_activities_prompt.md)
prd: done
prd-ref: prd.md (reescrito na Wave 0)
spec: done
spec-ref: spec.md (reescrito na Wave 0 a partir do swarm de 10 agentes)
adr: done
adr-ref: ADR-0035
roadmap: done
roadmap-ref: plano de waves W1..W9 (tasks.md / spec.md §Waves)
pipeline: done
pipeline-ref: tasks.md (pacotes P0..P2 por wave)
ship: pending
testing: pending
conclusion: pending
---

# Workflow - sistema-tarefas (módulo "Atividades")

## Purpose

Track the PRD/PDR, SPEC, ADR, roadmap, pipeline, and completion evidence for this workflow.
Módulo operacional **Atividades** — tarefas por paciente com tipos configuráveis, histórico
imutável, permissões (extensão do funil), lembretes multi-canal (notificação interna + email +
diálogo/gate), integração automática com procedimentos e camada assíncrona (outbox + filas pgmq
+ scheduler pg_cron + workers). Entrega em waves W1..W9; cada wave roda em worktree próprio com
swarm de 10 agentes (2 runs de 5) e fecha em commit → merge `dev-backlog` → log-session →
prompt_next_wave.md.

## History

- 2026-06-16 - **Wave 1 DB migrations AUTHORED, NOT APPLIED** (owner-gated) — per `reports/0002-wave1-db-foundation.md` §header; pending owner apply.
- Created; next phase: intake.
- 2026-06-15 - intake done (ref: migrado do blueprint planos-futuros); next phase: prd
- 2026-06-15 - prd done (ref: migrado do blueprint planos-futuros); next phase: spec
- 2026-06-15 - spec done (ref: migrado do blueprint planos-futuros); next phase: adr
- 2026-06-16 - **Wave 0 (planning)**: swarm de 10 agentes (discovery + design/risco) em worktree
  `../atividades-w0-planning`. PRD/SPEC reescritos, ADR-0035 criado, tasks W1..W9 com pacotes
  P0..P2, report de síntese em `reports/0001-wave0-discovery-synthesis.md`. adr/roadmap/pipeline
  done; next phase: ship (Wave 1 = fundação DB).
- 2026-06-16 - **Wave 1 (Fundação DB)** em worktree `../atividades-w1-db` (branch
  `feat/atividades-w1-db`). 3 decisões ratificadas pelo owner → **ADR-0035 Accepted**. Migration
  UNNAMED `20260615143949` verificada (só `funnels.display_order`, sem conflito). Swarm: guardian
  preflight + Run 1 (4 streams de autoria) + Run 2 (2 auditorias adversariais Opus + harness + build).
  Entregue: 4 migrations (enums/core/perm-RLS/transitions), utils puros + 60 testes verdes, harness
  RLS+idempotência (`supabase/tests/`), runbook de apply. Security **sem BLOCKERs** (2 fixes
  aplicados), LGPD **GO**, tsc-app=0. **APLICADA EM PRODUÇÃO** (2026-06-16, owner-gated). Report
  `reports/0002-wave1-db-foundation.md`. next phase: ship (Wave 2).
- 2026-06-17 - **Wave 2 (History+Settings+Note-link+Domínio)** em worktree `../atividades-w2-domain`
  (branch `feat/atividades-w2-domain`). Swarm: guardian preflight (CONDITIONAL GO; B1 nota_id=bigint)
  + Run 1 (4 autoria) + Run 2 (DB-security/fixes + integração + RLS-SQL + build + **adversarial Opus
  GO 0-blockers**; diff aditivo do trigger provado). Entregue: 4 migrations (history append-only +
  emit helper + transitions-W2 + created trigger; settings + seed; `notas.atividade_id`; view
  `atividades_safe` mascarando valor — carry-forward P1), hooks/services/Zod/permissões puras,
  `types.ts` regenerado, 92 testes + harness P5/P6. **APLICADA EM PRODUÇÃO** (2026-06-17, owner-gated;
  backup app + verify-server; fix do bug `backup_type` no `backup:safe`). Advisors 0 novo ERROR;
  tsc-app=0; P6 fail-closed + append-only + masking provados em dados reais. Report
  `reports/0003-wave2-domain.md`. next phase: ship (Wave 3 = aba Atividades no modal).
