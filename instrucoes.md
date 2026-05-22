# VibeDevKit — Guia de Uso (pt-BR)

> Guia prático em português. Os **comandos, caminhos e chaves de config** são em
> inglês de propósito (é o "principal" do projeto) — só a explicação é em pt-BR.

## O que é

O VibeDevKit transforma "vibe coding" em **engenharia**: em vez de torcer para a
IA lembrar do contexto, o kit faz o ambiente (hooks do Claude Code) **forçar** as
boas práticas e guardar o histórico no próprio repositório. Funciona em qualquer
projeto — do zero (greenfield) ou já existente, qualquer stack.

## Instalação

```bash
# do npm (recomendado)
npx vibedevkit --target . --level 2 --yes

# ou direto do GitHub (sem npm)
npx github:reiTavares/VibeDevKit --target . --level 2 --yes
```

Depois, abra o projeto no Claude Code, aprove os hooks uma vez, e rode:

```
/setupvibedevkit
```

Esse comando **adapta o kit ao seu projeto**: detecta a stack, ajusta o config,
preenche o `CLAUDE.md`, marca paths de risco, cria um ADR base e registra a
sessão. Um banner de "first run" aparece no boot até você rodá-lo.

## Os 6 níveis (suba conforme a confiança)

| Nível | O que ativa |
| --- | --- |
| **L1 Memory** | contexto no boot, `/log-session`, ADRs, changelog |
| **L2 Ledger** | detecção de drift (recomendado começar aqui) |
| **L3 Multi** | claims, worktrees, índices auto-gerados, git hooks |
| **L4 Squads** | sub-agentes especializados (`.claude/agents`) |
| **L5 Proactive** | gate `/simulate-impact`, tech-debt, contract drift |
| **L6 Autonomy** | pipeline `/ship`, learning loop `/retro`, métricas |

Trocar de nível (de dentro do projeto):

```
/vibe-level 4        # ou: node vibekit/tools/scripts/vibe-level.mjs 4
```

Reinicie o Claude Code depois de trocar (ele recarrega os hooks).

## Comandos

### Contexto e registro
- `/state` — resumo do estado atual.
- `/log-session` — registra a sessão (use **no fim**). O Stop hook cobra você.
- `/new-adr <título>` — cria um ADR **antes** de uma decisão grande.
- `/close-version <x.y.z>` — fecha versão no CHANGELOG.
- `/context-refresh` — gera o snapshot completo do projeto.

### Modos de trabalho
- `/dev-start <objetivo>` — sessão focada; trava o escopo.
- `/bug-hunt <sintoma>` — investiga a causa raiz antes de escrever feature.
- `/audit` — auditoria geral (doctor + métricas + tech-debt + QA + drift).

### Coordenação (L3)
- `/claim <path>` / `/release` — reserva/libera área para sessões paralelas.
- `/worktree-new <feature>` — cria worktree isolado para outra sessão.

### Qualidade (L4/L5)
- `/test-plan`, `/scaffold-tests`, `/qa-signoff` — squad de QA.
- `/simulate-impact <objetivo>` — mapeia o blast radius antes de mexer em path de risco.
- `/tech-debt-sweep [quick]` — scanner determinístico + interpretação.
- `/contract-check [--save]` — detecta quebra de contrato (exports removidos).

### Autonomia e insight (L6)
- `/ship <feature>` — pipeline completo: design → implementa → review → testa → registra.
- `/retro` — learning loop: vira fricção recorrente em regras/ADRs.
- `/vibe-stats` — métricas (sessões, drift rate, ADRs, cadência).
- `/distill-sessions` + `/distill-apply` — propõe e aplica refinamentos no `CLAUDE.md`.

### Plataforma
- `/vibe-doctor` — diagnóstico do install (node, config, wiring, git hooks).
- `/vibe-config show|set` — lê/edita `vibekit/config.json`.
- `/vibe-level [1-6]` — vê/troca o nível.

## Fluxo recomendado por sessão

1. Abra o projeto no Claude Code — o boot injeta o contexto sozinho.
2. `/state` para um resumo rápido (opcional).
3. Trabalhe. Decisão arquitetural? `/new-adr` **antes** de implementar.
4. No fim: `/log-session`. Ao fechar uma fase: `/close-version`.
5. Periodicamente (ou agendado): `/audit`.

## Boas práticas

- **Comece no L2.** Suba para L3 ao abrir uma 2ª sessão; L4 quando houver
  domínios claros; L5 quando um edit descuidado em arquivo crítico doer; L6
  quando quiser orquestração/autonomia.
- **ADR antes de decidir grande.** Stack, biblioteca, padrão → `/new-adr`. ADR
  aceito é **imutável**; para mudar, crie outro que o substitua.
- **Registre a sessão.** O `drift rate` no `/vibe-stats` mostra se você está
  esquecendo o `/log-session`.
- **Ajuste os paths ao seu stack.** Edite `vibekit/config.json` → `ledger.*`
  (ou `/vibe-config`). Python → `app/`, `tests/`; Go → `cmd/`, `internal/`.
- **Preencha o `CLAUDE.md`.** As regras imutáveis e a constituição de código são
  o que mais melhora a qualidade do que a IA produz. Mantenha-o curto.
- **Não edite arquivos gerados** (`SESSIONS.md`, `WORKSPACE.md`,
  `tech-debt-board.md`) — eles são regenerados.
- **Sessões paralelas → worktree** (`/worktree-new`), nunca dois chats no mesmo
  diretório.

## Manutenção

```bash
node vibekit/tools/scripts/doctor.mjs        # saúde do install
node vibekit/tools/scripts/stats.mjs         # métricas
node vibekit/tools/scripts/tech-debt-scan.mjs --write
node vibekit/tools/scripts/generate-context.mjs   # snapshot p/ refactor/IA externa
```

Atualizar o kit (sem perder memória/config): rode o instalador de novo.
Desinstalar: `node <kit>/install.mjs --target . --uninstall` (mantém a memória;
`--purge` também remove o engine).

## Solução de problemas

- **Hook não dispara / pede aprovação** — aprove uma vez por hook; reinicie o
  Claude Code após trocar de nível.
- **Wiring fora do nível** — `/vibe-doctor` aponta; corrija com `/vibe-level <n>`.
- **JSON do config quebrado** — os hooks caem nos defaults (não travam); conserte
  o arquivo (o loader tolera BOM do Windows).
- **Git hooks no Windows** — precisam do Git for Windows (usam `#!/bin/sh`).

---

Documentação completa (em inglês): `README.md`, `docs/LEVELS.md`,
`docs/ARCHITECTURE.md`, `docs/CUSTOMIZING.md`, `docs/ROADMAP.md`.
