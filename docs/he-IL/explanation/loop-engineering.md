# Loop Engineering מבוסס Evidence

ContextDevKit מתייחס למסירה כאל engineering loop ולא כאל generation חד-פעמי.

```text
implement
  ↓
evaluate
  ↓
findings
  ↓
correct
  ↓
re-evaluate
  ↓
fresh evidence
  ↓
done
```

ה-agent loop שייך ל-host. ה-engineering loop שייך לפרויקט ולכן יכול לשרוד context compaction, session חדשה, model אחר או host אחר.

## עומק אדפטיבי

ה-active agent בוחר עומק לפי complexity, scope, risk, blast radius, contracts שנפגעו, domain weight, critical paths, הוראת owner ו-evidence זמינה.

Typo יכול לדרוש focused validation בלבד. Feature משמעותית עשויה לדרוש tests + code review. שינוי קריטי יכול להצדיק full QA, DDD, architecture, security, debt, integration/E2E או performance.

## Evaluators

QA, DDD, Technical Debt, Architecture Debt, Code Review, Security, Lean Code, Performance ו-Accessibility מייצרים evidence. לא לכל evaluator יש blocking authority.

## QA cycle חדש

`qa-reject` יכול להחזיר task מ-`testing` או `done` ל-`backlog`. Evidence של המחזור הנוכחי נמחקת לפי הצורך, בעוד ההיסטוריה נשמרת. Workflow שכבר הושלם יכול להיפתח מחדש.

## Completion

`unknown`, `skipped` ו-`error` אינם PASS. מצד שני, כשל ב-evaluator אופציונלי אינו נועל אוטומטית את הפלטפורמה. רק guarded quality floors שהוגדרו יכולים deny ברגעי lifecycle המתועדים שלהם.

> **ה-model יכול להציע completion. Evidence מצדיק אותה. ה-owner מגדיר את ה-outcome.**
