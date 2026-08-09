# ארכיטקטורה

ContextDevKit הוא **AI Software Engineering Governance Harness** שאינו תלוי ב-host. ה-host ממשיך להיות אחראי על ה-agent loop, הכלים וגבולות הבטיחות של הפלטפורמה; ContextDevKit מספק את שכבת ההנדסה העמידה של הפרויקט: project intelligence, long-term memory, context, work lifecycle, evidence ו-governance.

## זרימת interaction

```text
request
  ↓
conversation | exploration | mutation | unclassified
  ↓ (mutation בלבד)
Intake Envelope
  ↓
Business | Operation | none
  ↓
direct | batch | workflow
```

`conversation` ו-`exploration` לקריאה בלבד אינן יוצרות מצב עמיד. כאשר הכוונה אינה ברורה, נשאלת שאלה קצרה אחת. ניסיון כתיבה אמיתי מקדם באופן authoritative את ה-interaction ל-`mutation`.

## Intake Envelope

זהו מבט זמני על signals שכבר קיימים: interaction, existing work, nature, execution shape, tier/complexity, domain/risk, value intent, decision need/match, Business match, reasons ו-evidence. זה אינו קובץ חובה חדש ואינו ceremony נוספת.

## סמכויות מצב

| מצב | Authority |
| --- | --- |
| הגדרת Workflow | `workflow.json` |
| lifecycle של Workflow | `workflow-state.json` |
| tasks/status/events | `pipeline/tasks.json` |
| run זמני | `memory/runs/<id>/state.json` |
| owner preferences | `memory/preferences/owner-preferences.json` |

Markdown הוא authored context או projection נגזרת, ולא writer שני של state.

## Governance

כברירת מחדל רק QA sign-off, DDD Class A invariants ישימים, ו-Technical Debt חדש ברמת high/critical שנוסף על ידי ה-diff הנוכחי יכולים להיות `guarded`. Architecture Debt הוא `canary`; Privacy/LGPD הוא `shadow`. כשל runtime פנימי מתדרדר ל-`continue`.

## Hosts

מקורות canonical מייצרים projections עבור Claude Code, Codex, Antigravity ו-Grok. אפשר להחליף host בלי לאבד את הזיכרון והאינטליגנציה המנוהלים של הפרויקט.
