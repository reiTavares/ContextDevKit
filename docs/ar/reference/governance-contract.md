# عقد الحوكمة

أحداث runtime:

```text
prompt-preflight | write-preflight | postflight | completion
```

يمر كل event عبر dispatcher مركزي واحد يملك deduplication وtimeout وbudget وre-entry protection وcircuit breaker.

## السياسة الافتراضية

`defaultMode=canary` و`failurePolicy=continue` و`humanAuthority=owner-wins`.

فقط `qa-signoff` و`ddd-invariants` و`technical-debt` موجودة في guarded allowlist. `architecture-debt` هو canary و`privacy-lgpd` هو shadow.

يتطلب guarded deny أن تكون observation في حالة `violated` وأن تكون deterministic وapplicable وevidenced وcurrent، بالإضافة إلى تحقق predicate الخاص بالـ gate.

## Human override

الـ override الصالح مرتبط بـ scope/revision ومحدود زمنياً وقابل للتدقيق. يسجل قرار الـ owner من دون تعديل evidence الأصلية.

## Fail-open

Missing أو stale evidence ليست PASS. فشل الـ harness الداخلي يتبع `continue` ما لم يوجد guarded predicate كامل ومستقل.
