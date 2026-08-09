# Loop Engineering قائم على الأدلة

يتعامل ContextDevKit مع التسليم كحلقة هندسية، لا كعملية توليد لمرة واحدة.

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

الـ agent loop ملك للـ host. أما engineering loop فهي ملك للمشروع ويمكن أن تستمر بعد context compaction أو جلسة جديدة أو model مختلف أو host مختلف.

## عمق هندسي متكيف

يختار الـ active agent العمق المناسب بناءً على complexity وscope وrisk وblast radius والعقود المتأثرة وdomain weight وcritical paths وتعليمات owner والأدلة المتاحة.

قد يحتاج typo إلى focused validation فقط. وقد تحتاج feature مادية إلى tests + code review. أما التغيير الحرج فقد يبرر full QA وDDD وarchitecture وsecurity وdebt وintegration/E2E أو performance.

## Evaluators

QA وDDD وTechnical Debt وArchitecture Debt وCode Review وSecurity وLean Code وPerformance وAccessibility تنتج evidence. ليست كل evaluator صاحبة blocking authority.

## دورة QA جديدة

يمكن لـ `qa-reject` إعادة task من `testing` أو `done` إلى `backlog`. يتم تنظيف evidence الخاصة بالدورة الحالية مع بقاء التاريخ. ويمكن أيضاً reopen لـ Workflow مكتمل.

## Completion

`unknown` و`skipped` و`error` ليست PASS. وفي الوقت نفسه، فشل evaluator اختيارية لا يقفل المنصة تلقائياً. فقط guarded quality floors المهيأة يمكنها deny في lifecycle moments المحددة.

> **يمكن للـ model اقتراح الاكتمال. الأدلة تبرره. والـ owner يحدد outcome.**
