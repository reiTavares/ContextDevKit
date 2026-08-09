# Privacidade e postura de dados

O ContextDevKit é local-first. Hooks normais e comandos de contexto somente leitura não enviam conteúdo do repositório para um serviço ContextDevKit.

## Dados locais

| Dado | Local | Objetivo |
| --- | --- | --- |
| memória autorada | `contextkit/memory/` | decisões, sessões, reports, Workflows |
| autoridade de tasks | `pipeline/tasks.json` de cada scope | definição e status |
| workspace claims | `.claude/.workspace/` | warnings locais de colisão |
| Project Map | `contextkit/memory/project-map/` | índice estrutural regenerável |
| telemetria econômica | `contextkit/memory/economics/` | medições explícitas opcionais |
| cache/staging de update | `contextkit/.cache/`, `contextkit/.updates/` | suporte local descartável |

Na 4.x não existe ledger de edit por tool. Conversa e exploração não criam task, Workflow, counter, receipt ou session state durável.

## Fronteiras de rede

Dispatchers normais de governança não fazem fetch de rede. Rede só é usada quando o usuário chama comando cuja função exige isso, como registry de dependências, GitHub, geração de mídia ou Git.

Dados indisponíveis devem ser reportados como `skipped`/indisponíveis, nunca inventados.

Specialists podem receber context pack bounded pelo host ativo. Controles de privacidade do modelo/provider pertencem ao host/provider.

Não coloque secrets, credenciais, dados pessoais ou payloads brutos de produção em memory, reports, títulos de tasks ou prompts de agentes.

## Remoção

`.claude/.workspace/`, `contextkit/.cache/` e `contextkit/.updates/` são estado local descartável.

Memória autorada e autoridades JSON canônicas são registros do projeto; remova somente por decisão explícita de dados.

`privacy-lgpd` é shadow-only por padrão. Pode apontar riscos e sugerir controles, mas não é aprovação jurídica nem pré-requisito de escrita.
