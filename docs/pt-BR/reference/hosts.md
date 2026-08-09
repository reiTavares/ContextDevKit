# Referência de hosts nativos

ContextDevKit é host-agnostic: o host executa modelo, ferramentas, shell/filesystem, MCP e seu próprio safety boundary; o ContextDevKit preserva governança, memória, estado e inteligência do projeto.

## Hosts suportados

- **Claude Code** — fonte canônica das superfícies de comandos/agentes do kit;
- **OpenAI Codex** — projeções nativas de hooks, agents e skills;
- **Google Antigravity** — projeções em `.agents/` e hooks nativos;
- **Grok** — adapter e superfícies nativas do host.

## Paridade sem autoridade duplicada

Fontes canônicas são convertidas para o formato de cada host. Projeções geradas não devem ser editadas como uma segunda fonte de verdade.

O host pode mudar sem alterar as autoridades persistentes de Workflow, Tasks, Business, Operation, ADRs, reports ou owner preferences.

## Limites

ContextDevKit não promete recursos que o host não oferece. Por exemplo, uma recomendação de modelo ou specialist não se transforma em troca de modelo ou spawn obrigatório se o host não expõe essa capacidade.

Veja [Agentes](agents.md), [Arquitetura](../ARCHITECTURE.md) e [Governança](../explanation/governance-and-enforcement.md).
