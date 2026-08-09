# Referência de configuração

O runtime lê `contextkit/config.json` e aplica defaults defensivos quando uma seção está ausente ou inválida.

## Áreas principais

- `level`: capacidades habilitadas;
- `governance`: modos, failure policy e human authority;
- `qa`: critical paths e coverage targets;
- `projectMap`: roots/provider/opções de descoberta;
- `analysis`: exclusões e sinais de análise;
- `economy`: compaction, perfis e telemetria opcional;
- `routing`: recomendações de modelos/agentes;
- `riskAcknowledgement`: contexto para ações externas de alto risco.

## Defaults de governança

`defaultMode=canary`, `failurePolicy=continue`, `humanAuthority=owner-wins`.

Somente `qa-signoff`, `ddd-invariants` e `technical-debt` podem permanecer `guarded` no allowlist. Tentar configurar outro gate como guarded é clampado para canary pelo resolver.

## Compatibilidade

Chaves 3.x de autonomy/strict/advisory são tratadas apenas na migração. Não copie objetos antigos para config v4.

Para alterações, valide config/doctor e mantenha JSON como configuração explícita, não como depósito de estado de sessão.
