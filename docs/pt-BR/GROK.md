# Integração com Grok

Grok é uma superfície de execução suportada pelo ContextDevKit. Assim como nos demais hosts, o projeto mantém a autoridade de memória e governança fora do loop específico do modelo.

## Princípios

- o host executa o modelo e ferramentas;
- ContextDevKit preserva state, memory, decisions, context e governance;
- recomendações de modelo/agente não concedem permissão;
- falhas de integração devem ser reportadas sem inventar sucesso.

## Portabilidade

Ao trocar de host, o objetivo é manter Business/Operations/Workflows/tasks/ADRs/reports disponíveis sem reconstruir a história do projeto a partir da conversa do modelo anterior.

Consulte [Trabalhar entre hosts](how-to/work-across-hosts-and-bridges.md) e [Arquitetura](ARCHITECTURE.md).
