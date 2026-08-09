# הפעלת Business case

השתמשו בזרימה הזו רק כאשר העבודה מייצגת outcome אסטרטגי עמיד.

## 1. Intake לקריאה בלבד

```bash
node contextkit/tools/scripts/work.mjs intake "<objective>" --json
```

בדקו `nature`, `executionMode`, clarification, reasons ו-evidence. `none` היא תוצאה תקפה; אין ליצור Business עבור feature רגילה.

## 2. צרו Business במכוון

השתמשו ב-surface `work.mjs business` של הפרויקט. ה-classifier מספק מידע; יצירה ואישור של ownership הם החלטה מפורשת.

## 3. בחרו execution shape מינימלית

Business יכול להשתמש ב-direct, batch או Workflow. בחרו Workflow רק כאשר topology אמיתית דורשת זאת.

## 4. Operations קשורות

Operation יכולה להגן על או לתמוך ב-outcome של Business. ה-matcher יכול להציע link אך לא לאשר strategic ownership אוטומטית.

## 5. Decisions ו-evidence

צרו ADR כאשר קיימת material decision. Reports שומרים עובדות; JSON שומר state authority.

## 6. Outcome

המטרה היא לשמר context אסטרטגי שצריך לשרוד בין sessions, בלי להכריח כל שינוי טכני להשתייך ל-Business.
