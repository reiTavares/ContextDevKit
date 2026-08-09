# الحوكمة وEnforcement

يفصل ContextDevKit بين quality floors الحتمية وبين الإرشاد الهندسي advisory.

## الأوضاع

- `off`: معطل؛
- `shadow`: يراقب من دون تغيير outcome؛
- `canary`: يقيّم ويبلغ من دون deny؛
- `guarded`: يمكنه deny فقط عند وجود violation قابلة للتطبيق وحتمية ومثبتة بالأدلة في اللحظة الموثقة.

## ثلاثة quality floors من نوع guarded افتراضياً

1. QA sign-off عند completion؛
2. DDD Class A invariants المعلنة والقابلة للتطبيق؛
3. Technical Debt جديد من مستوى `high`/`critical` أدخله الـ diff الحالي.

Architecture Debt هو `canary`، وPrivacy/LGPD هو `shadow`. Graph وrouting وswarm وeconomy وsimulations وcouncils وspecialist selection ليست آليات إذن خفية.

## فشل الـ Harness

Invalid config أو timeout أو evaluator error أو optional unknown evidence تتدهور إلى `canary/continue`. لا يجب أن تمنع الحوكمة العمل الحقيقي بسبب فشل داخلي فيها.

## سيادة الـ Owner

القيمة الافتراضية `humanAuthority=owner-wins`. يسجل guarded override الـ actor والسبب والscope والrevision والoutcome، لكنه لا يحول failed evidence إلى PASS ولا يتجاوز حدود أمان الـ host/platform الحقيقية.
