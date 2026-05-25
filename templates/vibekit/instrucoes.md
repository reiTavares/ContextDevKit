# VibeDevKit — Guia de Uso (pt-BR)

> Guia prático em português. Os **comandos, caminhos e chaves de config** são em
> inglês de propósito (é o "principal" do projeto) — só a explicação é em pt-BR.

## O que é

O VibeDevKit transforma "vibe coding" em **engenharia**: em vez de torcer para a
IA lembrar do contexto, o ambiente (hooks do Claude Code) **força** boas práticas
e guarda o histórico no próprio repositório.

## Primeiro uso

Abra o projeto no Claude Code, aprove os hooks, e rode **`/setupvibedevkit`** —
ele detecta a stack, ajusta o config, preenche o `CLAUDE.md`, marca paths de
risco, cria um ADR base e registra a sessão. Um banner de "first run" aparece no
boot até você rodá-lo.

## Os 6 níveis

| Nível | O que ativa |
| --- | --- |
| **L1 Memory** | contexto no boot, `/log-session`, ADRs, changelog |
| **L2 Ledger** | detecção de drift |
| **L3 Multi** | claims, worktrees, índices auto-gerados, git hooks |
| **L4 Squads** | sub-agentes especializados (`.claude/agents`) |
| **L5 Proactive** | gate `/simulate-impact`, tech-debt, contract drift |
| **L6 Autonomy** | pipeline `/ship`, learning loop `/retro`, métricas |
| **L7 Ecosystem** | fleet multi-repo (`/fleet`), agent-tuning, testes visuais, playbooks, custo/tokens |

Trocar de nível: `/vibe-level <n>` (reinicie o Claude Code depois).

## Comandos principais

- **Setup:** `/aidevtool-from0` (vazio) · `/setupvibedevkit` (existente)
- **Contexto:** `/state` · `/log-session` (no fim) · `/new-adr` · `/close-version` · `/context-refresh`
- **Modos:** `/dev-start` · `/bug-hunt` · `/audit`
- **Coordenação (L3):** `/claim` · `/release` · `/worktree-new`
- **Qualidade (L4/L5):** `/test-plan` · `/scaffold-tests` · `/qa-signoff` · `/simulate-impact` · `/tech-debt-sweep` · `/analyze-code-ia-practices` · `/contract-check`
- **Produto & execução:** `/roadmap` · `/pipeline` · `/ship` · `/retro` · `/vibe-stats` · `/distill-sessions` · `/distill-apply`
- **Estrutura & plataforma:** `/git` (controle de versão + remoto) · `/claude-md` (CLAUDE.md por módulo) · `/vibe-doctor` · `/vibe-config` · `/vibe-level`

## Boas práticas

- **Onde começar:** projeto **novo/vazio** (vibe-code do zero) → **L3**; projeto que
  **já tem código** → **L7** (use tudo; os gates ficam inertes até configurar
  `highRiskPaths`). O instalador já escolhe L3/L7 pra você. Suba/desça com `/vibe-level`.
- **ADR antes** de decisão grande (`/new-adr`). ADR aceito é imutável.
- **Registre a sessão** (`/log-session`) — veja seu `drift rate` em `/vibe-stats`.
- Ajuste `vibekit/config.json` → `ledger.*` ao seu stack (ou `/vibe-config`).
- Mantenha o `CLAUDE.md` curto e com as regras imutáveis preenchidas.
- Não edite arquivos gerados (`SESSIONS.md`, `WORKSPACE.md`, `tech-debt-board.md`).
- Sessões paralelas → `/worktree-new` (nunca dois chats no mesmo diretório).

## Manutenção

- `/vibe-doctor` — saúde do install. `/vibe-stats` — métricas.
- `/audit` — auditoria geral (bom agendar via `/loop` ou `/schedule`).
- Atualizar o kit: rode o instalador de novo (não perde memória/config).

Docs completos (inglês): `vibekit/README.md` e a pasta de docs do kit.
