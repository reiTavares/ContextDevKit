# Trabalhar entre hosts

ContextDevKit mantém fontes canônicas e gera projeções para hosts suportados.

## Hosts atuais

- Claude Code;
- OpenAI Codex;
- Google Antigravity;
- Grok.

O host executa modelo e ferramentas. O projeto mantém memória, estado, decisões e governança independentemente do host.

## Fontes e projeções

Claude commands/agents são sources canônicos para várias projeções. O manifest `contextkit/policy/host-projections.json` declara o que é gerado e onde.

Não edite uma projeção gerada como segunda autoridade. Altere a source e regenere.

## Paridade

Uma mudança de command/agent deve manter as projeções sem drift. O release gate verifica arquivos faltantes, stale ou órfãos.

## Falhas de host

Se um host não suporta um especialista, modelo ou mecanismo específico, preserve a responsabilidade de engenharia no agente ativo. Host capability não deve virar permissão metodológica.
