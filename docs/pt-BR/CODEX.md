# Integração com OpenAI Codex

ContextDevKit expõe o projeto ao Codex através de projeções geradas, mantendo as fontes canônicas separadas do host.

## Superfícies

- `AGENTS.md` — instruções principais do projeto para Codex;
- `.agents/skills/` — skills geradas a partir dos commands canônicos;
- `.codex/agents/` — subagents TOML gerados a partir dos agents canônicos.

## Autoridade

Não edite `.codex/agents/*.toml` como source independente. O manifest de host declara a origem em `templates/claude/agents`/commands e o converter recompõe Codex.

## Routing

Model routing e agent selection são recomendações. Se uma projeção, modelo ou subagent não estiver disponível, o agente ativo continua dentro do escopo do owner.

## Governança

Codex consome o mesmo runtime, memória, task state e gate registry. A existência de um agent TOML não é receipt de qualidade.

## Verificação

Use o build/check de Codex definido no `package.json` para garantir que não exista drift de projeções antes de release.
