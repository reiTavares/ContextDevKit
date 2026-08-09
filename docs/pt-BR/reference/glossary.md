# Glossário

| Termo | Significado | Autoridade |
| --- | --- | --- |
| harness | camada de engenharia host-agnostic ao redor dos coding agents que preserva inteligência, memória, estado, governança, evidência e continuidade | contrato de arquitetura/runtime |
| interaction | turno do usuário classificado como conversation, exploration, mutation ou unclassified | contexto transitório do dispatcher |
| mutation | mudança de estado explicitamente pedida ou tentativa real de escrita | instrução atual do owner/evento da tool |
| Intake Envelope | visão transitória normalizada de interaction, existing-work, natureza, forma, complexidade, decisões, matches, reasons e evidence | valor derivado; nunca autoridade persistida |
| existing work | resolução normalizada: explicit, inferred, ambiguous, new ou none | sinal de intake |
| work nature | `business`, `operation`, `none` ou `unclassified` | work classifier determinístico |
| business | capacidade, produto, iniciativa ou decisão estratégica durável | `memory/business/BIZ-*` |
| operation | manutenção, incidente, recuperação, refactor ou melhoria operacional durável | `memory/operations/OP-*` |
| none | resultado normal quando nenhum Business/Operation é justificado | work classifier |
| execution shape | topologia de coordenação: `direct`, `batch`, `workflow` | classifier/contrato ativo |
| direct | trabalho pequeno/coeso, normalmente 1–3 tasks | task scope/agente ativo |
| batch | várias tasks relacionadas, normalmente 4–12, sem ordem forte | batch `tasks.json` |
| workflow | trabalho com dependências, waves, cutover/rollback, multi-session ou pedido explícito | `workflow.json` |
| workflow state | phase/status agregado e metadata compacta | `workflow-state.json` |
| task | unidade de trabalho com priority, dependencies, acceptance, reports e evidence | `pipeline/tasks.json` |
| task projection | render humano das tasks canônicas | `pipeline/tasks.md` |
| engineering loop | ciclo implementar → avaliar → findings → corrigir → reavaliar → evidência nova → done | task/workflow state + reports/evidence |
| evaluator | QA, DDD, architecture, debt, review, security, performance ou outra análise que produz evidência | implementação específica |
| quality floor | condição determinística configurada para proteger boundary de write/completion | gate registry + config |
| gate | policy evaluation em `off`, `shadow`, `canary` ou `guarded` | gate registry + gate-mode |
| guarded | pode negar apenas com predicado completo no momento documentado | governance runtime |
| canary | avalia/report sem negar | governance runtime |
| shadow | observa sem alterar outcome | governance runtime |
| guarded quality floors | QA na conclusão, DDD Classe A aplicável e Technical Debt nova high/critical do diff | governance runtime |
| Architecture Debt | análise estrutural canary por padrão | architecture-debt evaluator |
| Technical Debt | quality floor guarded apenas para debt nova high/critical do diff atual | technical-debt gate |
| owner sovereignty | regra em que intenção explícita do owner é a fronteira de decisão do projeto dentro da governança | `humanAuthority: owner-wins` |
| human override | decisão explícita do owner com escopo, razão, policy provenance, revisão, janela de tempo e outcome | metadata de override |
| recommendation | graph, agent, model, economy, simulation, council, specialist ou guidance de forma | nunca autoridade de execução |
| code-reviewer | especialista de review para diff material; recomendado, não receipt obrigatório | agent registry/projection |
| report | registro factual de mudanças, testes, decisions, blockers e findings | `reports/` do scope |
| fresh evidence | evidência do ciclo/implementação atual, não reaproveitada de ciclo rejeitado | task evidence/events |
| migration bundle | backup/manifest/mapping/rollback fora do runtime para dados v3 | migrador v3→v4 |

`backlog`, `working`, `blocked`, `testing`, `done` e `cancelled` são valores de status, não nomes de diretórios.
