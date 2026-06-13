# Playbook: squad-compliance

> Reusable procedure. Follow the steps below when invoked.

# ⚖️ Playbook: compliance-team

This playbook establishes regulatory compliance, data protection, and user rights governance.

## 👥 Members
* `privacy-lgpd`: Specializes in Lei Geral de Proteção de Dados (Law 13.709/2018).
* `governance-officer`: Manages policies (cost, quality, compliance thresholds).

## 📝 Best Practices
1. **PII Audits:** Check schemas for personal fields (`email`, `cpf`, `phone`). Every PII attribute must have a registered purpose and a valid legal basis (Art. 7/11).
2. **Revocability & Subject Rights:** Build access, correction, and deletion triggers conforming to Art. 18. Soft deletes must purge or irreversibly anonymize personal records.
3. **Decision Reviews:** Trigger compliance check reviews on schema refactors or when setting up new third-party telemetry systems.
