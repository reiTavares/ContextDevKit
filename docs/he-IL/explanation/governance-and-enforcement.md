# Governance ו-Enforcement

ContextDevKit מפריד בין quality floors דטרמיניסטיים לבין guidance הנדסי advisory.

## Modes

- `off`: כבוי;
- `shadow`: צופה בלי לשנות outcome;
- `canary`: מעריך ומדווח בלי deny;
- `guarded`: יכול deny רק violation ישימה, דטרמיניסטית ומגובה evidence ברגע המתועד.

## שלושה guarded quality floors כברירת מחדל

1. QA sign-off ב-completion;
2. DDD Class A invariants שהוגדרו וישימים;
3. Technical Debt חדש ברמת `high`/`critical` שנוסף על ידי ה-diff הנוכחי.

Architecture Debt הוא `canary`; Privacy/LGPD הוא `shadow`. Graph, routing, swarm, economy, simulations, councils ו-specialist selection אינם מנגנוני הרשאה סמויים.

## כשל של ה-Harness

Invalid config, timeout, evaluator error או optional unknown evidence מתדרדרים ל-`canary/continue`. Governance לא אמורה לעצור עבודה אמיתית בגלל כשל פנימי שלה.

## Owner sovereignty

ברירת המחדל היא `humanAuthority=owner-wins`. Guarded override מתעד actor, reason, scope, revision ו-outcome; הוא לא משנה failed evidence ל-PASS ולא עוקף safety boundaries אמיתיים של ה-host/platform.
