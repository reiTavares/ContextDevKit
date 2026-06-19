# Decisions - sistema-tarefas (Atividades)

ADRs relacionados a este workflow:

- **[ADR-0035](../../decisions/0035-atividades-module-architecture.md)** — Módulo Atividades:
  arquitetura, domínio, permissões e camada assíncrona. *(Proposed, 2026-06-16, número
  provisório — reconciliar no merge de governança.)* É o ADR-guarda-chuva do módulo.

Refina/depende de: ADR-0002 (tenant isolation), ADR-0011 (LGPD lifecycle),
ADR-0014 (edge auth classes), ADR-0019 (RLS SELECT/UPDATE parity),
ADR-0034 (SECURITY DEFINER contract + bucket fail-closed).

## Decisões confirmadas pelo owner ANTES da Wave 1  ✅ (2026-06-16 — todas SIM)

1. **Tenant próprio na atividade** (`cliente_id`/`hospital_id` na linha, paciente opcional) — ✅ SIM.
2. **Soft-delete por `deleted_at`** (não tabela `_excluidos`) — ✅ SIM.
3. **Consultor `activity_view_scope = own`** (fronteira no banco, não no frontend) — ✅ SIM.

Ratificadas na abertura da W1 → **ADR-0035 movida para Accepted**.

## Refinamentos de implementação decididos na W1 (sobre ADR-0035, sem ADR-filho)
- Helpers de permissão recebem **colunas (não ids)** → recursion-safe sob FORCE RLS.
- SuperAdmin via `get_user_access_level`, nunca o UUID hardcoded (ADR-0035 risco A2).
- Binding atividade→funil = `pacientes.funnel_id`; atividade sem paciente = MAX scope entre
  concessões; paciente é **teto** de visibilidade.
- `funnel_assignments.activity_*` NULLABLE (tri-state inherit) — revisar coerência em W2.

## ADRs-filho possíveis (abrir se o detalhe divergir na implementação)

- Camada assíncrona de lembretes (pgmq + pg_cron) — caso a cadência/forma mude sob load-test.
- Gate de conclusão (síncrono vs. fila) — confirmar se "gate" é fila ou checagem in-process.
