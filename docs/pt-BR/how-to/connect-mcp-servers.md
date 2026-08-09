# Conectar servidores MCP

MCP amplia as ferramentas disponíveis ao host; ele não altera o contrato de autoridade do ContextDevKit.

## Princípios

- configure o MCP no host/superfície suportada pelo projeto;
- não armazene secrets em documentação ou memória authored;
- trate indisponibilidade da integração como diagnóstico explícito;
- MCP não substitui state authority, QA evidence ou confirmação real do host para ações externas.

## Governança

Um MCP pode fornecer dados ou executar ações, mas o ContextDevKit continua distinguindo leitura, mutação de projeto e ação externa destrutiva.

Ferramentas externas devem respeitar as confirmações e permissões da plataforma que realmente executa a ação.

Depois de conectar, use `doctor`/checks do host para confirmar que a integração aparece sem duplicar configurações gerenciadas.
