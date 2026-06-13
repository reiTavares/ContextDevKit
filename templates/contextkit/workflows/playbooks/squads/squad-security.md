# 🔐 Playbook: security-team

This playbook enforces threat protection, supply-chain checks, and credential hygiene.

## 👥 Members
* `security`: Lead specialist. Reviews authorization, tokens, crypto, and trust boundaries.
* `code-security`: SAST triage, third-party library licenses, SBOM checks.
* `infra-security`: Threat modeling cloud setups, CI/CD hardening, Docker configurations.
* `devops`: Integrates security checks in build pipelines and manages environments.

## 📝 Best Practices
1. **Zero Secret Leaks:** Verify that no API tokens, encryption keys, or credentials exist in logs, database fixtures, or commits.
2. **Safe Input Sanitization:** Validate all incoming parameters at the boundary. Block SQL injection, shell injection, and XSS risks.
3. **L5 Gate Compliance:** Any files matching high-risk patterns require static security clearance before merge. Run dependency scans regularly.
