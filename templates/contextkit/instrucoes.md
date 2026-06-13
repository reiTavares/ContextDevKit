# ContextDevKit — Guia de Uso (pt-BR)

> Guia prático em português. **Comandos, caminhos e chaves de config** ficam em
> inglês de propósito (é o "principal" do projeto) — só a explicação é em pt-BR.

## O que é

O ContextDevKit transforma "AI-assisted coding" em **engenharia**: em vez de torcer pra
IA lembrar do contexto, o ambiente (hooks do Claude Code) **força** boas
práticas e guarda o histórico no próprio repositório.

## Primeiro uso

Abra o projeto no Claude Code, aprove os hooks, e rode **`/setupcontextdevkit`** —
ele detecta a stack, ajusta o config, preenche o `CLAUDE.md`, marca paths de
risco, cria um ADR base e registra a sessão. Um banner de "first run" aparece
no boot até você rodá-lo.

Projeto vazio (greenfield)? Use **`/aidevtool-from0`** — questionário interativo
de produto → visão, stack, roadmap, boas práticas e DevPipeline montados num
único passo.

## Os 7 níveis

| Nível | O que ativa |
| --- | --- |
| **L1 Memory** | contexto no boot, `/log-session`, ADRs, changelog |
| **L2 Ledger** | detecção de drift |
| **L3 Multi** | claims, worktrees, índices auto-gerados, git hooks (Conventional Commits + pre-push contra conflito real) |
| **L4 Squads** | 35 sub-agentes em 7 squads (devteam, qa-team, design-team com `seo-specialist` + `landing-architect`, security, compliance-LGPD, ops, agent-forge) |
| **L5 Proactive** | gate `/simulate-impact`, tech-debt, distill-detect, contract drift |
| **L6 Autonomy** | pipeline `/ship`, learning loop `/retro`, métricas, agent-forge ativo |
| **L7 Ecosystem** | `/fleet` (multi-repo), `/tune-agents`, testes visuais, playbook runner |

Trocar de nível: `/context-level <n>` (reinicie o Claude Code depois).

## Comandos principais

- **Setup:** `/aidevtool-from0` (vazio) · `/setupcontextdevkit` (existente)
- **Diário:** `/state` · `/log-session` (no fim) · `/new-adr` · `/debate` ·
  `/close-version` · `/context-refresh` · `/bug-hunt` · `/dashboard` · `/watch` ·
  `/playbook` · `/context-stats` · `/distill-sessions` · `/distill-apply`
- **Trabalho focado:** `/dev-start` (mostra PRs abertos via sync-check) ·
  `/workflow` · `/ship` · `/resume`
- **Coordenação (L3):** `/claim` · `/release` · `/worktree-new` · `/git`
- **Qualidade (pack `qa/` + L5):** `/test-plan` · `/scaffold-tests` ·
  `/qa-signoff` · `/visual-test` · `/simulate-impact` · `/tech-debt-sweep` ·
  `/analyze-code-ia-practices` · `/contract-check`
  (`scaffold-tests.mjs plan` detecta Node/JavaScript, Python, Go, Rust e PHP
  antes do squad escrever testes de domínio; `scaffold --write` cria só harnesses starter)
- **Auditoria (pack `audit/`):** `/audit` · `/deep-analysis` · `/security-setup` ·
  `/deps-audit` · **`/seo-audit`** *(novo — SEO + AISO)*
- **Landing pages & mídia *(novo na v1.7)*:** `/landing-page` (architect
  opinionado anti-cookie-cutter) · `/media-gen` (Veo + Nano Banana via `.env`)
- **Produto & execução:** `/roadmap` · `/pipeline` · `/runs` · `/retro` ·
  `/squad` · `/claude-md`
- **Plataforma:** `/context-doctor` · `/context-config` · `/context-level` ·
  `/fleet` *(L7)* · `/tune-agents` *(L6)*
- **Agent-forge** *(L6+)*: 14 comandos `forge-*` para o ciclo de Agent Packages

## Workflow spec pack

Para features grandes e mudanças arquiteturais, `/workflow new <slug>` cria
`contextkit/memory/workflows/<slug>/` com:

- `prd.md` — PDR/PRD: WHAT/WHY, objetivos, usuários, métricas e não-escopo.
- `spec.md` — SPEC técnica: HOW, impacto, interfaces, arquivos prováveis e testes.
- `decisions.md` e `tasks.md` — índices para ADRs globais e cards do DevPipeline.
- `memory.md` — handoffs duráveis que não pertencem a git, ADR, PRD, SPEC ou task.
- `reports/YYYY-MM-DD.md` — relatório factual diário com diff summary e verificação.

Fluxo canônico:

```text
intake -> prd -> spec -> adr -> roadmap(se feature) -> pipeline -> ship -> testing -> conclusion
```

O spec pack não substitui roadmap, ADRs ou DevPipeline. Ele só amarra o contexto
e a evidência. Cards podem ser criados com `--workflow <slug>` e `--spec
contextkit/memory/workflows/<slug>/spec.md`; ao mover para `testing`, o pipeline
carimba `implemented: YYYY-MM-DD`.

## Squads

| Squad | Specialists | Quando |
|---|---|---|
| **devteam** | architect, code-reviewer, context-keeper, test-engineer | Design + revisão + memória |
| **qa-team** | qa-orchestrator + unit/integration/fuzzer/perf/e2e | Testes |
| **design-team** | ui-designer, ux-designer, accessibility, **seo-specialist**, **landing-architect** | UI/UX, WCAG AA, SEO+AISO, landing |
| **security-team** | security, code-security, infra-security | Auth, deps, IaC |
| **compliance-team** | privacy-lgpd, governance-officer | LGPD, políticas |
| **ops-team** | devops | CI/CD, deploys |
| **agent-forge** *(L6+)* | forge-orchestrator + 7 specialists | Pipeline pra Agent Packages portáveis |

## Provider adapters *(novo)*

Dois surfaces plugáveis sob `runtime/providers/`:

- **`review/`** — adapters de CLI de PR (hoje: `gh`; adicione `glab.mjs` /
  `bb.mjs` no mesmo contrato).
- **`media/`** — geração de mídia (hoje: `nano-banana` para imagem via Imagen 3
  e `veo` para vídeo, ambos via `GOOGLE_AI_API_KEY` configurado em
  `contextkit/.env`).

Setup do `/media-gen`:
1. Pega chave em https://aistudio.google.com/apikey
2. Copia `contextkit/.env.example` pra `contextkit/.env`, cola em `GOOGLE_AI_API_KEY=`
3. (Opcional) `CONTEXTDEVKIT_MEDIA_MAX_USD=5.00` pra capar custo por processo
4. Roda com `node --env-file=contextkit/.env contextkit/tools/scripts/media-gen.mjs ...`

## Boas práticas

- **Onde começar:** projeto **vazio** → L3; projeto que **já tem código** → L7
  (use tudo; os gates ficam inertes até configurar `highRiskPaths`). O
  instalador escolhe automaticamente.
- **ADR antes** de decisão grande (`/new-adr`). ADR aceito é imutável.
- **Registre a sessão** (`/log-session`) — veja seu `drift rate` em
  `/context-stats`. Se perdeu, `/resume`.
- Ajuste `contextkit/config.json` → `ledger.*` ao seu stack (ou `/context-config`).
- Mantenha o `CLAUDE.md` curto e com as regras imutáveis preenchidas.
- Não edite arquivos gerados (`SESSIONS.md`, `WORKSPACE.md`, `tech-debt-board.md`,
  `dashboard.html`) — são regenerados.
- Sessões paralelas → `/worktree-new` (nunca dois chats no mesmo diretório).
- **Landing page?** Use `/landing-page` antes de codar — entrevista de
  estratégia, recusa SPA puro, define fold count e gera por script
  (`lp-scaffold.mjs` → preencha `lp/content/*.json` → `lp-build.mjs --check`):
  cookie consent por padrão, GTM sem ID (inerte), pixels só como modelos
  comentados, política de privacidade + termos gerados como minuta (ADR-0050).
  Imagery via `/media-gen` (sem stock photos genéricas).

## Manutenção

- `/context-doctor` — saúde do install. `/context-stats` — métricas.
- `/audit` — auditoria geral (bom agendar via `/loop` ou `/schedule`).
- `/dashboard` — visual do estado em HTML; `--watch` em tempo real.
- Atualizar o kit: rode o instalador de novo (não perde memória/config) ou
  `npx contextdevkit@latest --target . --update`.
  O update também refresca `contextkit/README.md` pelo caminho seguro de
  manifesto e regenera `docs/README.md`; o `README.md` raiz do seu produto
  continua sendo seu.

Docs completos (inglês): `contextkit/README.md` e a pasta `docs/` do kit
(`docs/ARCHITECTURE.md`, `docs/CUSTOMIZING.md`, `docs/SQUADS/design-team.md`,
`docs/SQUADS/agent-forge.md`, `docs/LEVELS.md`).
