# Integração com Google Antigravity

Antigravity usa projeções geradas a partir das fontes canônicas do ContextDevKit.

## Superfícies

- `INSTRUCTIONS.md` — contrato de boot do host;
- `.agents/skills/` — skills projetadas de commands;
- `.agents/agents/` — personas projetadas dos agentes;
- `.agents/playbooks/` e `.agents/workflows/` — projeções declaradas quando aplicável.

## Paridade

O converter é determinístico e o manifest `host-projections.json` define exatamente o que é gerenciado. Arquivos órfãos ou stale devem ser removidos/regenerados pelo build, não mantidos manualmente.

## Semântica

Adaptações de linguagem do host não alteram o contrato do projeto: state authority, owner-wins, gates, memory e work lifecycle continuam compartilhados.

## Falha de feature do host

Se Antigravity não oferecer um mecanismo equivalente a um subagent/command específico, o agente ativo mantém a responsabilidade; a ausência da feature não vira bloqueio metodológico.
