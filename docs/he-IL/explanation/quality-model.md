# מודל איכות

ContextDevKit 4 מפריד בין observations לבין authority.

## מצבי Evidence

```text
passed | violated | unknown | skipped | error
```

`unknown`, `skipped` ו-`error` לעולם אינם מוצגים כ-PASS.

## QA

מגן על transition ל-`done` כאשר guarded predicate ישים. הוא לא חוסם את תחילת ה-implementation.

## DDD

רק Class A invariant שהוגדר, ישים, והפרתו הוכחה דטרמיניסטית יכול להשתתף ב-guarded floor. Classifier opinion או domain map שלא אושרה אינם מספיקים.

## Technical Debt

פועל כ-ratchet של ה-diff הנוכחי. רק debt חדש `high`/`critical` שנוסף על ידי השינוי הנוכחי יכול deny completion כאשר המצב מוגדר guarded. Debt היסטורי לא צריך לחסום עבודה לא קשורה.

## Architecture Debt

זהו ניתוח מבני רחב יותר שנשאר `canary`. הוא יכול לזהות risk ולספק evidence, אך לא הופך אוטומטית ל-gate guarded רביעי.

## Code Review ו-Lean Code

אלו responsibilities הנדסיות/advisory. Finding צריך evidence ו-context; גודל קובץ לבדו אינו verdict ארכיטקטוני.
