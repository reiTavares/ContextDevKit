# Glossary

| Term | अर्थ |
| --- | --- |
| Harness | coding host के आसपास durable context, memory, work lifecycle, evidence और governance layer |
| interaction | `conversation`, `exploration`, `mutation` या `unclassified` |
| Intake Envelope | intake signals का transient view; persisted artifact नहीं |
| Business | durable strategic context `BIZ-####` |
| Operation | durable operational context `OP-####` |
| none | Business/Operation durable owner के बिना सामान्य work |
| direct | छोटी cohesive execution shape |
| batch | strong ordering के बिना related tasks |
| Workflow | dependencies/waves/multi-session/cutover वाला coordinated work |
| task | `pipeline/tasks.json` में work unit |
| guarded | mode जो complete deterministic predicate पर deny कर सकता है |
| canary | evaluate/report करता है, deny नहीं |
| shadow | outcome बदले बिना observe करता है |
| Architecture Debt | structural-risk canary analysis |
| Technical Debt | current diff के नए high/critical debt पर guarded ratchet |
| engineering loop | implement → evaluate → correct → re-evaluate with fresh evidence |
| owner override | guarded verdict की explicit auditable human acceptance |

Task statuses: `backlog`, `working`, `blocked`, `testing`, `done`, `cancelled`।
