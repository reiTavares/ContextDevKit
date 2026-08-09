# מילון מונחים

| מונח | משמעות |
| --- | --- |
| Harness | שכבה עמידה סביב coding host עבור context, memory, work lifecycle, evidence ו-governance |
| interaction | `conversation`, `exploration`, `mutation` או `unclassified` |
| Intake Envelope | מבט זמני על signals של intake; אינו persisted artifact |
| Business | context אסטרטגי עמיד `BIZ-####` |
| Operation | context תפעולי עמיד `OP-####` |
| none | עבודה רגילה בלי Business/Operation owner עמיד |
| direct | execution shape קטנה וממוקדת |
| batch | tasks קשורות ללא סדר חזק |
| Workflow | עבודה מתואמת עם dependencies/waves/multi-session/cutover |
| task | יחידת עבודה בתוך `pipeline/tasks.json` |
| guarded | mode שיכול deny רק עם deterministic predicate מלא |
| canary | מעריך/מדווח בלי deny |
| shadow | צופה בלי לשנות outcome |
| Architecture Debt | ניתוח canary של סיכון מבני |
| Technical Debt | guarded ratchet ל-high/critical debt חדש ב-diff הנוכחי |
| engineering loop | implement → evaluate → correct → re-evaluate עם fresh evidence |
| owner override | קבלה אנושית מפורשת וניתנת לביקורת של guarded verdict |

Task statuses: `backlog`, `working`, `blocked`, `testing`, `done`, `cancelled`.
