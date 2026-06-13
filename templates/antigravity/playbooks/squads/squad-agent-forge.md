# Playbook: squad-agent-forge

> Reusable procedure. Follow the steps below when invoked.

# 🤖 Playbook: agent-forge

This playbook governs the design, routing, testing, and deployment of specialized Agent Packages.

## 👥 Members
* `forge-orchestrator`: Manages workflow routing and packages compilation.
* `agent-architect`: Dictates agent capabilities mapping and structural patterns.
* `prompt-engineer`: Builds system instructions, constraints, and canonical templates.
* `tool-designer`: Constructs MCP tool schemas and validation parameters.
* `eval-designer`: Scaffolds verification evals and tests thresholds.
* `packager`: Bundles modules into standardized APF zip distributions.
* `model-router`: Computes cost-performance metrics to choose the best upstream model.
* `governance-officer`: Enforces quality policies, cost budgets, and compliance.
* `rag-designer`: Designs vector contexts, chunking, and retrieval benchmarks.

## 📝 Best Practices
1. **Pillars Enforcement:** Ensure the three policies (cost, quality, compliance) have resolved values before compiling.
2. **Evaluations Integration:** Every custom agent must pass golden evals with a deterministic score above defined thresholds.
3. **Smart Scaffolding:** Recommend building custom agents using `/forge-new` when the workspace references SDK clients that require focused domain instructions.
