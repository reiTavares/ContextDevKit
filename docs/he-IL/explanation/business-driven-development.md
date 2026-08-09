# Business-Driven Development

Business-Driven Development מפריד בין שלוש שאלות: האם יש עבודה אמיתית בפרויקט, מי מחזיק לאורך זמן את הסיבה לעבודה הזאת, ואיזו צורת execution באמת נדרשת.

## 1. interaction קודם

`conversation` ו-`exploration` הן inert. רק `mutation` מאושרת נכנסת ל-intake. אם אין מספיק evidence, ContextDevKit שואל שאלה קצרה במקום להמציא עבודה חדשה.

## 2. עבודה קיימת לפני עבודה חדשה

Resolver יכול להחזיר `explicit`, `inferred`, `ambiguous`, `new` או `none`. התאמה ambiguous לא נבחרת בשקט, ופריט `done` לא נפתח מחדש בלי הוראה מפורשת.

## 3. Nature

- **Business**: capability, product, initiative או decision אסטרטגיים ועמידים שבהם outcome/KPI/sponsor/investment/horizon שווים זיכרון בין סשנים.
- **Operation**: context עמיד של maintenance, incident, recovery או improvement בתוך capability קיימת.
- **none**: תוצאה רגילה עבור feature ממוקדת, bug, docs או שינוי טכני שלא צריך owner עמיד.
- **unclassified**: evidence מתחרה או לא מספיק; נדרשת הבהרה קצרה.

## 4. Execution shape עצמאית

`direct`, `batch` ו-`workflow` אינן נגזרות אוטומטית מ-Business/Operation. Business לא כופה Workflow, וגם מילים כמו architecture, ADR או compliance לא.

Workflow מתאים רק ל-dependencies אמיתיות, waves, סדר חובה, multi-session, coordinated integration או cutover/rollback.

## 5. Business matching

Operation יכולה לקבל Business **suggested** באמצעות scoring דטרמיניסטי. התאמה חלשה נשארת `unlinked`; ה-matcher לא קובע `confirmed` בעצמו.

> **Context עמיד צריך להיווצר כאשר שכחתו תפגע בפרויקט.**
