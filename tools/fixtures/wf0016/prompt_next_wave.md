# prompt_next_wave.md — Atividades · próxima wave = **W3 (Aba Atividades no modal do paciente)**

> Handoff da Wave 2 (History + Settings + Note-link + Domínio) para a próxima run. **Mantém as
> mesmas diretrizes do owner.** Cole/execute isto na próxima sessão. Leia primeiro: `index.md`,
> `spec.md`, `tasks.md`, `memory.md`, `decisions.md`, `reports/0001-wave0-discovery-synthesis.md`,
> `reports/0002-wave1-db-foundation.md`, `reports/0003-wave2-domain.md` deste workflow +
> [ADR-0035](../../decisions/0035-atividades-module-architecture.md) (**Accepted**).

## O que já foi feito
- **W0 (planning)**: discovery+design swarm (10 agentes), ADR-0035, PRD/SPEC, plano W1..W9, report 0001.
- **W1 (Fundação DB) — APLICADA EM PRODUÇÃO** (2026-06-16). enums/core/perm-RLS/transitions; utils
  puros; helpers `activity_can`/`activity_scope_for`/`can_access_atividade`. Report 0002.
- **W2 (History+Settings+Note-link+Domínio) — APLICADA EM PRODUÇÃO** (2026-06-17, worktree
  `../atividades-w2-domain`, branch `feat/atividades-w2-domain`, merjada em `dev-backlog`).
  4 migrations via MCP: `atividade_history` (append-only + emit helper + `enforce_atividade_transitions`
  reescrita W2 + trigger AFTER INSERT `created`), `atividade_settings` (seed 1/tenant, Gestor+ write),
  `notas.atividade_id`, **view `atividades_safe`** (mascara `valor`/`moeda`, `security_invoker=true`).
  Frontend: `src/hooks/atividades/*` (schemas Zod, atividadesService, useAtividades), `src/utils/
  atividades/permissions.ts`, `types.ts` **regenerado**. 92 testes + harness RLS-SQL/P5/P6. Advisors
  **0 novo ERROR**, tsc-app=0; **P6 fail-closed + append-only + masking provados em prod**. Report 0003.

## ⚠️ Pré-requisito de W3
W2 já está **aplicada e estável** em produção — sem apply pendente. W3 é **frontend** (sem migration
nova prevista). Reusar a camada de dados da W2 (`useAtividades`, `atividadesService`, `atividades_safe`).

## O que falta
W3..W9. **Esta run executa a W3 — Aba Atividades no modal do paciente (P1).**

## Diretrizes permanentes (não-negociáveis, valem em TODA wave)
1. **Worktree novo por wave**: `git worktree add -b feat/atividades-w3-modal ../atividades-w3-modal
   dev-backlog` (+ junction de `node_modules` apontando p/ um worktree com deps instaladas — o main
   worktree pode estar sem `node_modules`; a W2 apontou para o do W1). Trabalhar isolado.
2. **Swarm**: máx. 5 agentes por run, **2 runs = 10 agentes por wave**. Opus orquestra/delega/
   estratégia; Sonnet p/ código de complexidade média; Haiku p/ mecânico. **Contrato congelado**
   compartilhado entre agentes paralelos (lição W1/W2: evita drift de interface).
3. **Economia/token**: project-map + scripts determinísticos; Supabase MCP **read-only** (DB frágil
   — sem bulk reads). Reusar skills/playbooks/scripts/componentes prontos ao máximo.
4. **Backup DR antes de qualquer migration/DDL/deploy** (ADR-0013); `supabase-guardian` no preflight.
   **Como gerar backup** (lição W2): a service-role key local está stale p/ a edge function; o caminho
   que funciona é o **botão de backup no app** (SuperAdmin) OU `npm run backup:safe` (já corrigido p/
   `backup_type:'pre-deploy'`); depois `npm run backup:verify-server` escreve o marker do gate. NUNCA
   escrever o marker à mão (o classifier bloqueia como bypass).
5. **Tasks concretas** (objetivo+aceite+arquivos), nunca abstratas. **Pacote por prioridade** (P0<P1<P2).
6. **Testar tudo MENOS e2e** (unit/integration/RTL/regressão). Suíte verde + (se tocar DB) `get_advisors`
   sem novo ERROR = gate. tsc-app=0 (lembrar: `strictNullChecks=false` → Zod `z.infer` colapsa tudo p/
   opcional; tipar payloads de DB via `TablesInsert<...>`/`TablesUpdate<...>` quando preciso).
7. **Reuso obrigatório**, sem duplicar: **modal compartilhado** `PacienteDetailModal`
   (`DetailModalTabs.tsx` + `ModalContent.tsx`), `NotasTab`/`NotaComposer`/`NotaFeed`/`NotaFilters`,
   `IndicadorCard`, `deriveActivityStatus` (W1), `useAtividades`/`atividadesService`/`atividades_safe`
   (W2). Nomenclatura **"Atividades"** na UI (pt-BR; nunca "Tarefas").
8. **Fechamento da wave (sequência fixa)**: atualizar workflow (index/memory/tasks) + pipeline +
   **report da wave** → **commit de tudo** → **merge no `dev-backlog` local com commit** →
   **`/log-session`** → **atualizar este `prompt_next_wave.md`** apontando para a wave seguinte
   (mantendo estas diretrizes) → **finalizar sessão**.

## Escopo da W3 (ver tasks.md → Wave 3)
- **P1**: estender `DetailModalTabs.tsx` (grid-cols-4→5, trigger "Atividades" entre Procedimentos e
  Notas, ícone CheckSquare) + `ModalContent.tsx` (novo TabsContent) — sem regressão nas abas/mobile.
- **P1**: `AtividadesTab` + `AtividadeListItem`/`AtividadeTimeline` + contadores pendentes/vencidas
  (status colorido derivado via `deriveActivityStatus` + faixas de `atividade_settings`).
- **P1**: `AtividadeForm` (Sheet) create/edit + `RescheduleReasonField`/`DelayReasonField`
  condicionais; auto-fill paciente/hospital/responsável. Transição via trigger (não no front).
- **P1**: seção de notas reusando `NotaComposer`/`NotaFeed` (tipo travado 'Atividade') — **migrar
  `src/hooks/notes/useNoteCreation.ts:92-131` para o RPC `insert_note_with_validation`** e thre_ar
  `atividade_id` (UPDATE pós-insert OU wrapper RPC — ver carry-forward W2).
- **P1**: testes RTL (no-dup-modal, "Ver Paciente" reusa modal, color-band) + regressão mobile 5 abas.

## Carry-forward da W2 a endereçar/registrar em W3
- **Note RPC**: `insert_note_with_validation(p_paciente_id bigint, p_texto text, p_tipo_nota tipo_nota,
  p_usuario_id uuid, p_anexo_path text)` **não tem `atividade_id`** → setar via UPDATE pós-insert ou
  wrapper. Não criar novo caminho de nota.
- **`atividades_safe`**: ler `valor` SEMPRE pela view (já é o default do `atividadesService`).
- **NB-1/NB-2** (history): `cancelled`/`expirada` sem evento; reschedule emite `rescheduled`+`due_changed`
  — a timeline da W3 deve dedupe/representar bem.
- **Redação de free-text (P3)**: `titulo`/`descricao` podem ter PII → nunca logar cru no front.

## Carry-forward para waves de DB (NÃO são da W3, registrar)
- **W1 tautologia** `atividades_restrict_assignee_tenant` (`cliente_id = cliente_id` no WITH CHECK do
  `_120200`) — backlog hardening (architect/security).
- **P5** INSERT-path RESTRICTIVE c/ JWT real: harness `supabase/tests/atividades_insert_path_jwt.test.sql`
  autorado; rodar em CI/DB completo.
- **Art.18/retenção** (ADR-0011): registrar `atividade_history`/`atividade_settings` na matriz (W9).

## Sugestão de swarm da W3 (10 agentes)
Run 1 (autoria): (a) `DetailModalTabs`+`ModalContent` grid-5 sem regressão; (b) `AtividadesTab`+list/
timeline+contadores; (c) `AtividadeForm` (Sheet) create/edit + campos condicionais; (d) seção de notas
reusada + migração do `useNoteCreation` p/ RPC + `atividade_id`; (e) design/ux review do encaixe no modal.
Run 2 (verificação): (f) RTL no-dup-modal/Ver-Paciente/color-band; (g) regressão mobile 5 abas;
(h) a11y (foco/teclado no Sheet+modal); (i) build tsc-app=0 + suíte; (j) code-review final + LGPD
(free-text redaction no front).
