# Tasks - sistema-tarefas (Atividades)

> Pacotes por prioridade dentro de cada wave (P0 antes de P1 antes de P2). Cada task tem objetivo,
> aceite e arquivos-alvo concretos (não-abstratos). Ao iniciar uma wave, materializar como cards do
> DevPipeline (`/pipeline`) e linkar o id aqui. Detalhe técnico em [spec.md](./spec.md); evidência
> em [reports/0001-wave0-discovery-synthesis.md](./reports/0001-wave0-discovery-synthesis.md).

## Wave 0 — Planning  ✅ (2026-06-16)
| Task | Pacote | Objetivo | Aceite |
| --- | --- | --- | --- |
| W0-T1 | P0 | Discovery swarm (5) + design/risk swarm (5) | report 0001 escrito com file:line + live MCP |
| W0-T2 | P0 | ADR-0035 + PRD/SPEC reescritos + plano W1..W9 | artefatos commitados; index phases adr/roadmap/pipeline=done |
| W0-T3 | P0 | prompt_next_wave.md + closeout (commit/merge/log) | merge no dev-backlog; sessão logada |

---

## Wave 1 — Fundação DB  (P0)  ✅ APLICADA EM PRODUÇÃO (2026-06-16) · worktree `../atividades-w1-db`
> **Pré-flight:** ✅ 3 decisões ratificadas; UNNAMED `20260615143949` verificada; guardian GO.
> **Aplicada via MCP** (4 migrations, owner-gated, backup DR validado pelo `verify-server` oficial)
> + hardening REVOKE dos trigger fns. Report `reports/0002-wave1-db-foundation.md` §I.
> **DoD (TUDO ✅):** tsc-app=0 · 60 testes utils · rollback documentado · **cross-tenant/consultor=own
> PROVADO EM PRODUÇÃO** (dados reais) · **advisors 0 novo ERROR / 0 trap nosso**.
> Follow-up: regen `types.ts` (CLI); prova INSERT-path RESTRICTIVE c/ JWT real (W2/P5); commitar a
> migration de hardening via `/simulate-impact`; limpar backup temp não-encriptado (LGPD).

| Task | Pacote | Objetivo (concreto) | Aceite |
| --- | --- | --- | --- |
| W1-T1 | P0 | Migration `..._atividades_enums`: criar os 4 enums (§2.1 spec) | enums existem; rollback `DROP TYPE` documentado |
| W1-T2 | P0 | Migration `..._atividades_core_tables`: `atividade_tipos` + `atividades` + todos os índices (incl. parcial pending e UNIQUE idempotência) + triggers updated_at/consistência-tenant/`enforce_atividade_transitions` + RLS+FORCE + helpers `can_access_atividade`/`activity_scope_for`/`activity_can` (fail-closed, search_path) | RLS A-não-vê-B verde; advisors sem novo ERROR; tipos de sistema (incl. "Procedimento") seedados |
| W1-T3 | P0 | Migration `..._atividades_funnel_perm_ext`: colunas `activity_*` em `funnel_role_defaults`/`funnel_assignments`; estender `seed_funnel_role_defaults()`; backfill defaults; re-point RLS de `atividades` nos resolvers | consultor=own provado em RLS-SQL; defaults seedados p/ funis existentes |
| W1-T4 | P0 | Util puro `src/utils/atividades/deriveActivityStatus.ts` + contrato `resolveAtividadeFromProcedimento` | testes unit verdes (faixas + timezone) |
| W1-T5 | P0 | Regenerar types Supabase (`src/integrations/supabase/types.ts`) pós-migration | build tsc-app = 0 |
| W1-T6 | P0 | Testes RLS-SQL (tenant/consultor/supervisor/hospital) + idempotência UNIQUE | suíte verde (menos e2e) |

## Wave 2 — History + Settings + Note-link + Domínio  (P0/P1)  ✅ APLICADA EM PRODUÇÃO (2026-06-17) · `../atividades-w2-domain`
> 4 migrations via MCP (history append-only/emit/transitions-W2/created; settings+seed; notas.atividade_id;
> view atividades_safe). Hooks/Zod/permissões + types.ts regen + 92 testes + harness P5/P6. Advisors 0 novo
> ERROR; tsc-app=0; P6 fail-closed + append-only + masking provados. Report `reports/0003-wave2-domain.md`.
> Follow-ups: P5 em CI; W1 tautologia assignee_tenant (backlog); NB-1/NB-2; RPC note `atividade_id` (W3).

| Task | Pacote | Objetivo | Aceite |
| --- | --- | --- | --- |
| W2-T1 | P0 | Migration `..._atividades_history` (append-only + REVOKE UPDATE/DELETE) + triggers de history em `atividades` | history grava em create/edit/complete/...; UPDATE/DELETE negado |
| W2-T2 | P0 | Migration `..._atividades_settings` (1 linha/tenant, seed defaults) | seed por cliente; RLS Gestor+ p/ escrita |
| W2-T3 | P1 | Migration `..._atividades_note_link` (`notas.atividade_id` + índice) | nota tipo Atividade liga à atividade; aparece nas Notas do paciente |
| W2-T4 | P0 | Hooks/services `src/hooks/atividades/*` (create/complete/reschedule/softDelete/restore/list) + Zod + view `atividades_safe` (mascarar valor) | integration tests verdes; transição via trigger, não no front |
| W2-T5 | P1 | Fns puras de permissão (`canAssignTo`, `canEditCompleted`, `filterActiveUsers`) | unit tests (hierarquia) verdes |

## Wave 3 — Aba Atividades no modal do paciente  (P1)  · dep: W2  · `../atividades-w3-modal`
| Task | Pacote | Objetivo | Aceite |
| --- | --- | --- | --- |
| W3-T1 | P1 | Estender `DetailModalTabs.tsx` (grid-cols-4→5, trigger "Atividades" entre Procedimentos e Notas, ícone CheckSquare) + `ModalContent.tsx` (TabsContent) | aba aparece desktop+mobile; sem regressão nas abas |
| W3-T2 | P1 | `AtividadesTab` + `AtividadeListItem`/`AtividadeTimeline` + contadores pendentes/vencidas | lista + status colorido derivado; empty/skeleton/error |
| W3-T3 | P1 | `AtividadeForm` (Sheet) create/edit + `RescheduleReasonField`/`DelayReasonField` condicionais; auto-fill paciente/hospital/responsável | criar dentro do modal preenche paciente/hospital; validação inline |
| W3-T4 | P1 | Seção de notas reusando `NotaComposer`/`NotaFeed`/`NotaFilters` (type travado 'Atividade') | nota criada aparece na aba Notas; sem novo editor |
| W3-T5 | P1 | Testes RTL (no-dup-modal, Ver Paciente reusa modal, color-band) + regressão mobile 5-tab | RTL verde; 360px ok |

## Wave 4 — Núcleo assíncrono (slice mínimo)  (P0)  · dep: W1  · `../atividades-w4-async`
| Task | Pacote | Objetivo | Aceite |
| --- | --- | --- | --- |
| W4-T1 | P0 | Migrations: `activity_outbox` + `activity_reminders` + `activity_deliveries` + uniques idempotência + índices parciais + RLS | RLS isolada; uniques provadas |
| W4-T2 | P0 | `pgmq.create` filas `activity_in_app_notifications` + `activity_dead_letter` | filas existem |
| W4-T3 | P0 | pg_cron `activity_scheduler_tick` + edge fn (claim SKIP LOCKED + fairness por cliente_id) | duplo-scheduler não duplica (teste) |
| W4-T4 | P0 | Edge fn worker in-app: read → notificação user-scoped (padrão `stale_lead_notifications`) → delivery → delete | reminder dispara in-app e2e (integration); crash → VT redelivery sem dup |
| W4-T5 | P0 | Hook cliente realtime (`postgres_changes` user-scoped) → diálogo | diálogo aparece; offline → no próximo login |

## Wave 5 — Página `/atividades` + dashboard  (P1)  · dep: W2 (+W4)  · `../atividades-w5-page`
| Task | Pacote | Objetivo | Aceite |
| --- | --- | --- | --- |
| W5-T1 | P1 | Rota + menu + `PeriodRangePicker` (extrair de `DashboardFiltersDateRange`) + `dateRangeToBounds` util | dashboard usa picker; presets corretos |
| W5-T2 | P1 | Cards server-side (edge fn/RPC tenant-derivado) Criadas/Pendentes/Vencidas/Concluídas + tooltips | métricas batem com definições; respeitam RLS/escopo |
| W5-T3 | P1 | Filtros lista + filtro de data da lista (distinto do período) + busca + ordenações + paginação server-side + URL | controles distintos claros; filtros na URL |
| W5-T4 | P1 | Lista com avatares + "Ver Paciente" → modal compartilhado (`defaultTab="atividades"`) | nunca cópia do modal; atividade sem paciente sem botão |
| W5-T5 | P1 | Persistência do último período por usuário (estender `notification_preferences` ou localStorage) | sobrevive remount; multi-device se via DB |

## Wave 6 — Integração com procedimentos  (P1)  · dep: W4  · `../atividades-w6-procedures`
| Task | Pacote | Objetivo | Aceite |
| --- | --- | --- | --- |
| W6-T1 | P1 | Migration trigger `AFTER UPDATE OF status` em `procedimentos_paciente` (separado) → `activity_outbox` (idempotency `proc:<id>:<status>`) | só enfileira; sem fan-out/HTTP no trigger |
| W6-T2 | P1 | Worker `activity_procedure_sync`: upsert `ON CONFLICT (cliente_id, idempotency_key)`; cria tipo "Procedimento"; sync cancelar/auto-concluir | sem dup em retries; estados cobertos |
| W6-T3 | P1 | Similaridade de título (lowercase+unaccent+colapso; ≥99%→não repete nome) | exemplos do prompt passam |
| W6-T4 | P1 | Testes (state machine, upsert idempotência, trigger tenant-scope) | verde; sem backfill auto |

## Wave 7 — Email + gate dialog + hardening  (P1/P2)  · dep: W4  · `../atividades-w7-email-gate`
| Task | Pacote | Objetivo | Aceite |
| --- | --- | --- | --- |
| W7-T1 | P1 | Fila + worker email (Resend via `send-system-email`/novo template; assunto genérico; sem PII; `provider_message_id`) + rate-limit + circuit-breaker | email idempotente; breaker abre sem queimar tentativas; nunca bloqueia gate/in-app/transação |
| W7-T2 | P1 | `ReminderGateDialog` + `useReminderQueueStore` (fila "1 de N") + override (audit) + a11y (focus-trap, Escape/backdrop só quando gated, Ver Paciente em portal) | GATE-01..10 verdes (logout/recuperação/cross-tenant/reatribuída/concluída) |
| W7-T3 | P2 | Fairness (`TENANT_MAX_*`) + DLQ + retry sweep (VT-lapse) | tenant grande não monopoliza; DLQ no max-attempts |

## Wave 8 — Configurações > Atividades + UI permissões  (P2)  · dep: W1+W2  · `../atividades-w8-settings`
| Task | Pacote | Objetivo | Aceite |
| --- | --- | --- | --- |
| W8-T1 | P2 | 7ª aba em `ConfiguracoesCrm.tsx` (lazy) + `AtividadesSettings` | aba no padrão visual; lazy load |
| W8-T2 | P2 | 6 seções: Tipos / Regras-cores / Lembretes / Gates / Motivos / Permissões (padrão `MotivosPerda*`) | CRUD tipos; cores→`atividade_settings` (fonte do deriveStatus) |
| W8-T3 | P2 | Matriz de permissões ligada às colunas `activity_*` (mesma UX do funil) | afeta front+serviço+RLS |

## Wave 9 — Carga/concorrência + observabilidade + LGPD + docs  (P2)  · dep: todas  · `../atividades-w9-hardening`
| Task | Pacote | Objetivo | Aceite |
| --- | --- | --- | --- |
| W9-T1 | P2 | Harness mínimo (`src/test/load/`): 1k linhas, multi-claim Promise.all×10, fairness 2 tenants, backlog recovery | invariantes verdes; guard de regressão |
| W9-T2 | P2 | Métricas/diagnóstico de lembrete + alertas (fila crescendo, scheduler parado, DLQ, breaker) | área admin/consulta segura por tenant |
| W9-T3 | P2 | Estender Art.18/retenção (ADR-0011) às tabelas novas + bucket; ratificação DPO (provisional) | tabelas no fluxo de deleção/retenção |
| W9-T4 | P2 | Docs finais + ADR-0035 → Accepted + `npm run map:refresh` + changelog | entrega final (§14 spec) completa |
