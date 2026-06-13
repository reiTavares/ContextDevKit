# Playbook: squad-ops

> Reusable procedure. Follow the steps below when invoked.

# ⚙️ Playbook: ops-team

This playbook coordinates infrastructure automation, continuous integration, and build releases.

## 👥 Members
* `devops`: Automates build environments, configures CI/CD scripts, manages secrets plumbing.

## 📝 Best Practices
1. **Isolated Environments:** Keep staging, production, and dev setups separated in infrastructure configurations.
2. **Hardened Pipelines:** Limit workflow triggers. Use strict token permissions on GitHub Actions jobs (e.g. `contents: read`).
3. **Observability:** Ensure structural changes update health checks and monitoring endpoints appropriately.
