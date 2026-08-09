# نموذج الجودة

يفصل ContextDevKit 4 بين observations وبين authority.

## حالات Evidence

```text
passed | violated | unknown | skipped | error
```

لا يتم تقديم `unknown` أو `skipped` أو `error` على أنها PASS.

## QA

تحمي transition إلى `done` عندما يكون guarded predicate قابلاً للتطبيق. لا تمنع بداية implementation.

## DDD

فقط Class A invariant معلنة وقابلة للتطبيق ومثبت انتهاكها حتمياً يمكن أن تدخل guarded floor. رأي classifier أو domain map غير مؤكدة لا يكفيان.

## Technical Debt

تعمل كـ ratchet للـ diff الحالي. فقط debt جديدة `high`/`critical` أدخلها التغيير الحالي يمكن أن تمنع completion عندما يكون الوضع guarded. Debt تاريخية لا تمنع عملاً غير مرتبط.

## Architecture Debt

هي تقييم هيكلي أوسع وتبقى `canary`. يمكنها اكتشاف مخاطر وتقديم evidence، لكنها لا تتحول تلقائياً إلى رابع guarded gate.

## Code Review وLean Code

هما مسؤوليتان هندسيتان/advisory. يجب أن يحمل finding evidence وسياقاً؛ حجم الملف وحده ليس verdict معماري.
