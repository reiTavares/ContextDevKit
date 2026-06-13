# ContextDevKit — Guia de Uso (pt-BR)

> Guia prático em português. **Comandos, caminhos e chaves de config** ficam em
> inglês de propósito (é o "principal" do projeto) — só a explicação é em pt-BR.

## O que é

O ContextDevKit transforma "AI-assisted coding" em **engenharia**: em vez de torcer para a
IA lembrar do contexto, o kit faz o ambiente **forçar** boas práticas e guardar
o histórico no próprio repositório. Funciona em qualquer projeto — do zero
(greenfield) ou já existente, qualquer stack — e em **três hosts nativos**:
**Claude Code** (hooks automáticos), **Google Antigravity** (`agy`/`ctx.mjs`) e
**Codex** (`AGENTS.md`, `.codex/` e `cdx.mjs`).

## Novidades na v2.6

> **QA ciente da stack.** O kit agora faz o squad de QA ler sinais reais do
> projeto antes de propor ou criar testes: Node/JavaScript, Python, Go, Rust e
> PHP ganham matriz happy/edge/failure e harness starter com `--write` explícito.

| Feature | O que faz |
|---|---|
| **`scaffold-tests.mjs`** | Script zero-dep usado por `/test-plan` e `/scaffold-tests`; detecta stack/runner, propõe casos específicos e só cria arquivos starter quando você passa `--write` |
| **`agy guard <path>`** | Checkpoint L5 explícito pré-edição no host sem hooks — exit 0 = liberado, exit 1 = rode `/simulate-impact` antes. Mesma definição de gate do hook PreToolUse do Claude Code |
| **Dispatch seguro no `ctx.mjs`/`agy`** | Só nome exato + aliases declarados (sem adivinhação por prefixo); comando desconhecido ganha did-you-mean (3 mais próximos) e `agy help <comando>` mostra o card individual |
| **`/project-map`** | Mapa estrutural determinístico (zero tokens de IA) commitado em `contextkit/memory/project-map/` — stack, módulos, símbolos exportados e **grafo de dependências entre módulos** (quem importa quem) para raciocínio de blast radius |
| **`/debate`** ([ADR-0035](contextkit/memory/decisions/0035-deliberations-multi-agent-debate-artifact.md)) | Deliberação multi-agente: vozes independentes debatem, um sintetizador converge (ou registra `unresolved`) e o artefato alimenta o Context de um ADR |
| **`/context-doctor` ciente do Antigravity** | Verifica o runner, os atalhos `ctx`/`agy`, as 4 árvores `.agents`, o `INSTRUCTIONS.md` e placeholders `{{TOKEN}}` esquecidos |
| **Build determinístico do host** | `npm run build:antigravity` regenera as skills/personas a partir das fontes Claude (limpa antes); um drift-guard no selfcheck falha o build se os dois hosts divergirem |
| **Migração de install legado** | `npx contextdevkit --update` carrega um install `vibekit/` antigo para `contextkit/` automaticamente — memória, config, nível e `.env` preservados |

## Instalação

```bash
# do npm (recomendado)
npx contextdevkit --target . --yes

# ou direto do GitHub (sem npm)
npx github:reiTavares/ContextDevKit --target . --yes
```

Depois, abra o projeto no Claude Code, aprove os hooks uma vez. Um banner de
"first run" aparece no boot e te roteia:

- **Projeto vazio (do zero):** rode **`/aidevtool-from0`** — questionário de
  produto interativo → visão, stack (sugere/refina), **roadmap**, boas práticas
  e DevPipeline. Ele te acompanha e fica ativo conforme o projeto cresce.
- **Projeto existente:** rode **`/setupcontextdevkit`** — detecta a stack, ajusta o
  config, preenche o `CLAUDE.md`, marca paths de risco, **procura/propõe o
  roadmap**, cria um ADR base e registra a sessão.

## Os 7 níveis (suba conforme a confiança)

| Nível | O que ativa |
| --- | --- |
| **L1 Memory** | contexto no boot, `/log-session`, ADRs, changelog |
| **L2 Ledger** | detecção de drift (recomendado começar aqui) |
| **L3 Multi** | claims, worktrees, índices auto-gerados, git hooks (Conventional Commits + pre-push que bloqueia conflito real) |
| **L4 Squads** | sub-agentes especializados — devteam, qa-team, design-team (5 specialists com `seo-specialist` + `landing-architect`), compliance, ops |
| **L5 Proactive** | gate `/simulate-impact`, `/tech-debt-sweep`, `/contract-check`, distill nudge |
| **L6 Autonomy** | pipeline `/ship`, learning loop `/retro`, métricas `/context-stats`, squad agent-forge |
| **L7 Ecosystem** | `/fleet` (multi-repo), `/tune-agents`, testes visuais, playbook runner |

Trocar de nível (de dentro do projeto):

```
/context-level 4        # ou: node contextkit/tools/scripts/context-level.mjs 4
```

Reinicie o Claude Code depois de trocar (ele recarrega os hooks). O instalador
escolhe **L3 pra projeto vazio / L7 pra projeto existente** automaticamente.

## Comandos por finalidade

### Contexto e registro
- `/state` — resumo do estado atual.
- `/log-session` — registra a sessão (use **no fim**). O Stop hook cobra você.
- `/new-adr <título>` — cria um ADR **antes** de uma decisão grande.
- `/debate <questão>` — deliberação multi-agente: vozes independentes debatem,
  um sintetizador converge (ou registra `unresolved`) e o resultado alimenta um ADR.
- `/close-version <x.y.z>` — fecha versão no CHANGELOG.
- `/context-refresh` — gera o snapshot completo do projeto.
- `/resume <session-id>` — re-vincula a uma sessão drift não registrada.

### Modos de trabalho
- `/dev-start <objetivo>` — sessão focada; trava o escopo. Roda `sync-check preflight` antes (mostra PRs abertos com status).
- `/bug-hunt <sintoma>` — investiga a causa raiz antes de escrever feature.
- `/workflow new <slug>` — spec pack: PDR/PRD + SPEC → ADR → roadmap (se feature) → pipeline → ship → testing → conclusion.
- `/ship <feature>` — pipeline completo: design → implementa → review → testa → registra.
- `/audit` — auditoria geral (doctor + métricas + tech-debt + QA + drift).

### Coordenação (L3)
- `/claim <path>` / `/release` — reserva/libera área para sessões paralelas.
- `/worktree-new <feature>` — cria worktree isolado para outra sessão.
- `/git` — workflow Git (Conventional Commits, PR, conectar remoto GitHub/GitLab).

### Visual (L1+)
- `/dashboard` — estado do projeto em HTML auto-contido (kanban + ADRs +
  sessões). `--watch` sobe servidor em `127.0.0.1:4242` com atualização em tempo
  real via SSE.
- `/watch` — acompanha edits da sessão atual. `--follow` faz streaming.
- `/runs` — lista runs recentes (tarefas + pipeline) entre squads.

### Qualidade (L4/L5)
- `/test-plan` · `/scaffold-tests` · `/qa-signoff` — squad de QA. O fluxo começa
  por `scaffold-tests.mjs plan`, que detecta stack/runner e monta casos
  happy/edge/failure antes dos especialistas escreverem testes de domínio.
- `/simulate-impact <objetivo>` — mapeia blast radius antes de mexer em path de risco.
- `/tech-debt-sweep [quick]` — scanner determinístico + interpretação.
- `/analyze-code-ia-practices` — auditoria de boas práticas + refactor inteligente.
- `/contract-check [--save]` — detecta quebra de contrato (exports removidos).
- `/visual-test` — testes visuais (qa-e2e + design-team).

### Auditoria (pack `audit/`)
- `/audit` · `/deep-analysis` · `/security-setup` · `/deps-audit`
- `/tech-debt-sweep` · `/analyze-code-ia-practices` · `/contract-check`
- `/seo-audit` — roda SEO + AISO; falha em `SPA_ENTRYPOINT` crítico.
- `/validate-doc` — gate de qualidade dos artefatos de planejamento (ADRs/roadmap).

### Landing pages e mídia
- **`/landing-page <briefing>`** — o squad de conversão (ADR-0023 + ADR-0050):
  entrevista de estratégia primeiro (`conversion-strategist` — nicho, dor, CTA
  única, sofisticação do público), indexabilidade decidida antes de tudo
  (`landing-architect`), e geração **determinística**: `lp-scaffold.mjs` cria a
  fonte componentizada (uma dobra por arquivo), a IA preenche só
  `lp/content/copy.json` + `legal.json`, e `lp-build.mjs --check` monta o
  `dist/` e recusa placeholders. **LGPD por padrão**: cookie consent ativo,
  GTM direto porém sem ID (inerte), pixels só como modelos comentados
  (`tracking-integrator` + revisão do `privacy-lgpd`), política de privacidade
  e termos de uso gerados como minuta (revisão de advogado obrigatória).
- **`/media-gen image|video --prompt "..." --out PATH`** — gera imagem (Nano
  Banana / Imagen 3) ou vídeo (Veo 3) via Google AI Studio. `.env.example` no
  kit com `GOOGLE_AI_API_KEY` comentado. `--dry-run` testa sem custo.

### Produto e execução
- `/roadmap` — plano de produto (o quê/porquê). Cria com você num projeto novo;
  acha/propõe num existente.
- `/pipeline` — DevPipeline (execução): bugs/increments/chores com prioridade,
  SLA, **DAG de dependências** e complexidade fluindo `backlog → working → testing → conclusion`.
- `/workflow` — organiza features grandes e decisões arquiteturais em
  `contextkit/memory/workflows/<slug>/` com `prd.md`, `spec.md`, índices de ADRs
  e tasks, memória de handoff e relatórios diários. Ele referencia roadmap,
  ADRs e DevPipeline; não cria um segundo board.
- `/retro` — learning loop (L6).
- `/context-stats` — métricas (sessões, drift rate, ADRs, cadência).
- `/distill-sessions` + `/distill-apply` — propõe/aplica refinamentos no `CLAUDE.md`.
- `/playbook list|run|track` — registro de procedimentos reutilizáveis.

### Estrutura e plataforma
- `/squad` — mostra/roteia/cria os **squads** (devteam, qa-team, design-team,
  compliance-LGPD, ops-team, agent-forge L6+).
- `/claude-md` — garante `CLAUDE.md` próprio em cada app/módulo.
- `/fleet list|add|stats|audit` *(L7)* — control plane multi-repo.
- `/tune-agents` *(L6)* — refina briefings de agentes (proposal-only).
- `/context-doctor` — diagnóstico do install.
- `/context-config show|set` — lê/edita `contextkit/config.json`.
- `/context-level [1-7]` — vê/troca o nível.

### Agent-forge *(L6+)* — "o agente que constrói agentes"
14 comandos `forge-*` para o ciclo de vida de Agent Packages portáveis:
`/forge-new` + `forge-{list,show,doctor,policy,budget,audit,eval,redteam,
route,fallback-test,refresh-matrix,killswitch,deprecate}`.

## Squads — sub-agentes organizados por domínio

| Squad | Specialists | Quando |
|---|---|---|
| **devteam** | `architect`, `code-reviewer`, `context-keeper`, `test-engineer` | Design cross-cutting + revisão de PR + higiene de memória |
| **qa-team** | `qa-orchestrator` + unit/integration/fuzzer/perf/e2e | Estratégia + execução de testes |
| **design-team** | `ui-designer`, `ux-designer`, `accessibility`, `seo-specialist`, `landing-architect`, `conversion-strategist`, `tracking-integrator` | UI/UX, WCAG AA, SEO+AISO, landing pages de alta conversão, neurodesign + tracking consent-first |
| **security-team** | `security`, `code-security`, `infra-security` | Auth, segredos, deps, IaC, supply chain |
| **compliance-team** | `privacy-lgpd`, `governance-officer` | LGPD, políticas |
| **ops-team** | `devops` | CI/CD, deploys, ambientes, observabilidade |
| **agent-forge** *(L6+)* | `forge-orchestrator`, `model-router`, `prompt-engineer`, `tool-designer`, `eval-designer`, `packager`, `rag-designer`, `agent-architect` | Pipeline para construir Agent Packages portáveis |

Crie os seus a partir de `_BRIEFING.md.tpl` via `/squad`.

## Playbooks

Procedimentos reutilizáveis em `contextkit/workflows/playbooks/`. Roda com
`/playbook run <nome>` ou lê sob demanda:

| Playbook | Autoridade | O que cobre |
|---|---|---|
| **`landing-page.md`** | ADR-0023 | Regras de dobras, refusals anti-Lovable, recomendações de pacotes datadas, Core Web Vitals |
| **`seo-aiso.md`** | ADR-0025 | Checklist SEO + checklist AISO (`llms.txt`, FAQ schema, semantic HTML5, detecção de robots.txt bloqueando AI crawlers) |
| **`tanstack.md`** | ADR-0017 | Família TanStack (Query/Router/Table/Form/Virtual/Start), disciplina de cache key, params tipados |
| **`simulate-impact.md`** | L5 gate | Mapear blast radius antes de mexer em path de risco |
| **`tech-debt-sweep.md`** | L5 audit | Scan determinístico da constituição + interpretação |
| **`distillation-cycle.md`** | L5 retro | Propor refinamentos do CLAUDE.md a partir do histórico |
| **`security-batch.md`** | security-team | Lote de findings de segurança → ADRs + backlog |

## Provider adapters — surface plugável

### Review providers (`contextkit/runtime/providers/review/`)
Adapters thin sobre CLIs já instalados no host. Hoje: **`gh`** (GitHub CLI).
Adicionar GitLab/Bitbucket é criar `glab.mjs`/`bb.mjs` seguindo o contrato em
`_adapter.mjs`. `detect.mjs` resolve qual adapter usar a partir de `git remote get-url origin`.

### Media providers (`contextkit/runtime/providers/media/`)
Dois adapters Google AI Studio:

| Adapter | Tipo | Auth | Custo (datado 2026-06-02) |
|---|---|---|---|
| **`nano-banana`** | imagem (Imagen 3) | `GOOGLE_AI_API_KEY` | ~$0,04 / imagem |
| **`veo`** | vídeo (Veo 3) | `GOOGLE_AI_API_KEY` | ~$0,50 / segundo |

Setup uma vez:
1. Pega chave em https://aistudio.google.com/apikey
2. Copia `contextkit/.env.example` pra `contextkit/.env`, cola a chave em `GOOGLE_AI_API_KEY=`
3. (Opcional) `CONTEXTDEVKIT_MEDIA_MAX_USD=5.00` pra capar custo por processo
4. Roda com `node --env-file=contextkit/.env contextkit/tools/scripts/media-gen.mjs ...` (Node 20.6+)

Refusa de cara sem credencial (rule 8 — default refuse), nunca substitui por
placeholder silenciosamente.

## Antigravity — o segundo host nativo

O instalador já deixa tudo pronto: `.agents/` (73 skills + 32 personas +
playbooks + workflows), o runner `ctx.mjs` na raiz e o `INSTRUCTIONS.md` (o
"CLAUDE.md" do Antigravity). O Claude Code não é tocado — os dois hosts
coexistem no mesmo projeto, compartilhando o mesmo ledger e a mesma memória.

Como o Antigravity não tem hooks, a governança roda como comandos explícitos:

```bash
node ctx.mjs session start    # início da sessão (boot context) — ou: agy session start
node ctx.mjs session status   # drift pendente + estado
node ctx.mjs guard <path>     # gate L5 antes de editar path de risco (exit 1 = simule antes)
node ctx.mjs session end      # checagem de drift antes de encerrar
node ctx.mjs help [comando]   # menu por categorias ou card de um comando
```

O dispatch é seguro por design: só nome exato ou alias declarado (errou o nome,
ele sugere os 3 mais próximos — nunca executa um script "parecido"). Detalhes em
[docs/ANTIGRAVITY.md](docs/ANTIGRAVITY.md).

## Codex — o terceiro host nativo

O instalador também gera `AGENTS.md`, `.codex/hooks.json`, sub-agentes TOML em
`.codex/agents/`, skills `source-command-*` em `.agents/skills/` e o runner
`cdx.mjs`:

```bash
node cdx.mjs help
node cdx.mjs doctor
node cdx.mjs pipeline list
```

Os assets Codex são gerados a partir das mesmas fontes Claude com:

```bash
npm run build:codex
```

O selfcheck falha se Claude e Codex divergirem. Detalhes em
[docs/CODEX.md](docs/CODEX.md).

## Fluxo recomendado por sessão

1. Abra o projeto no Claude Code — o boot injeta o contexto sozinho.
2. `/state` para um resumo rápido (opcional).
3. `/dev-start <objetivo>` se for sessão focada (mostra PRs abertos via sync-check).
4. Trabalhe. Decisão arquitetural? `/new-adr` **antes** de implementar.
5. Mexendo em path de risco no L5? `/simulate-impact` antes.
6. Quer visualizar o estado? `/dashboard --watch` em outra aba.
7. No fim: `/log-session`. Ao fechar uma fase: `/close-version`.
8. Periodicamente: `/audit`.

## Boas práticas

- **Onde começar:** projeto **novo/vazio** (context-code do zero) → **L3**; projeto
  que **já tem código** → **L7** (use tudo; os gates ficam inertes até configurar
  `highRiskPaths`). O instalador já escolhe L3/L7. Ajuste com `/context-level <n>`.
- **ADR antes de decidir grande.** Stack, biblioteca, padrão → `/new-adr`. ADR
  aceito é **imutável**; para mudar, crie outro que o substitua.
- **Registre a sessão.** O `drift rate` no `/context-stats` mostra se você está
  esquecendo o `/log-session`. Se perdeu o registro, `/resume`.
- **Ajuste os paths ao seu stack.** Edite `contextkit/config.json` → `ledger.*`
  (ou `/context-config`). Python → `app/`, `tests/`; Go → `cmd/`, `internal/`.
- **Preencha o `CLAUDE.md`.** As regras imutáveis e a constituição de código são
  o que mais melhora a qualidade do que a IA produz. Mantenha-o curto.
- **Não edite arquivos gerados** (`SESSIONS.md`, `WORKSPACE.md`,
  `tech-debt-board.md`, `dashboard.html`) — são regenerados.
- **Sessões paralelas → worktree** (`/worktree-new`), nunca dois chats no mesmo
  diretório.
- **Landing page?** Use `/landing-page` antes de codar — ele recusa SPA puro,
  define fold count, escolhe pacotes da rec table datada e delega imagery pra
  `/media-gen` (não usa stock photos genéricas).

## Manutenção

```bash
node contextkit/tools/scripts/doctor.mjs        # saúde do install
node contextkit/tools/scripts/stats.mjs         # métricas
node contextkit/tools/scripts/tech-debt-scan.mjs --write
node contextkit/tools/scripts/generate-context.mjs   # snapshot p/ refactor/IA externa
node contextkit/tools/scripts/dashboard.mjs     # visual do estado
```

**Atualizar com segurança (sem perder nada):**
```bash
npx contextdevkit@latest --target . --update
```
Atualiza só o engine + slash commands + wiring dos hooks para o **nível atual**.
**Nunca** toca em `CLAUDE.md`, `contextkit/config.json`, memória (ADRs/sessões/
roadmap), tarefas do pipeline, nem nos `CLAUDE.md` de cada módulo. Também
atualiza `contextkit/README.md` pelo manifesto seguro e regenera
`docs/README.md`, sem assumir controle do `README.md` raiz do seu produto. (Offline/
GitHub: `npx github:reiTavares/ContextDevKit --target . --update`.)

Desinstalar: `node <kit>/install.mjs --target . --uninstall` (mantém a memória;
`--purge` também remove o engine).

## Solução de problemas

- **Hook não dispara / pede aprovação** — aprove uma vez por hook; reinicie o
  Claude Code após trocar de nível.
- **Wiring fora do nível** — `/context-doctor` aponta; corrija com `/context-level <n>`.
- **JSON do config quebrado** — os hooks caem nos defaults (não travam); conserte
  o arquivo (o loader tolera BOM do Windows).
- **Git hooks no Windows** — precisam do Git for Windows (usam `#!/bin/sh`).
- **`/media-gen` reclama de `NO_CREDENTIALS`** — preencha `GOOGLE_AI_API_KEY` em
  `contextkit/.env` (template em `contextkit/.env.example`) e rode com `node
  --env-file=contextkit/.env ...`.
- **`/dashboard --watch` não abre em outra porta** — `--port=N` ou
  `CONTEXTDEVKIT_DASHBOARD_PORT=N`. Binda só em `127.0.0.1` (sem acesso remoto por
  design).
- **PR duplicado bloqueado pelo `sync-check prepr`** — outro chat seu já abriu
  PR pra essa branch; reabra ou ajuste título/branch.

---

Documentação completa (em inglês): `README.md`, `docs/LEVELS.md`,
`docs/ARCHITECTURE.md`, `docs/ANTIGRAVITY.md`, `docs/CUSTOMIZING.md`,
`docs/SQUADS/design-team.md`, `docs/SQUADS/agent-forge.md`, `docs/ROADMAP.md`.
