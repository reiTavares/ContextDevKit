# البنية المعمارية

ContextDevKit هو **AI Software Engineering Governance Harness** مستقل عن الـ host. يحتفظ الـ host بملكية agent loop والأدوات وحدود الأمان الخاصة بالمنصة، بينما يوفّر ContextDevKit الطبقة الهندسية الدائمة للمشروع: project intelligence وlong-term memory والسياق ودورة العمل والأدلة والحوكمة.

## مسار التفاعل

```text
request
  ↓
conversation | exploration | mutation | unclassified
  ↓ (mutation فقط)
Intake Envelope
  ↓
Business | Operation | none
  ↓
direct | batch | workflow
```

لا تنشئ `conversation` أو `exploration` للقراءة فقط حالة دائمة. إذا كانت النية غير واضحة، يُطرح سؤال توضيحي قصير واحد. محاولة كتابة حقيقية ترفع التفاعل بشكل authoritative إلى `mutation`.

## Intake Envelope

هو عرض مؤقت للإشارات الموجودة بالفعل: interaction وexisting work وnature وexecution shape وtier/complexity وdomain/risk وvalue intent وdecision need/match وBusiness match وreasons وevidence. ليس ملفاً إلزامياً جديداً ولا ceremony إضافية.

## سلطات الحالة

| الحالة | Authority |
| --- | --- |
| تعريف Workflow | `workflow.json` |
| lifecycle الخاص بـ Workflow | `workflow-state.json` |
| tasks/status/events | `pipeline/tasks.json` |
| run مؤقت | `memory/runs/<id>/state.json` |
| owner preferences | `memory/preferences/owner-preferences.json` |

Markdown هو authored context أو projection مشتقة، وليس writer ثانياً للحالة.

## الحوكمة

افتراضياً، لا يمكن أن تكون `guarded` إلا QA sign-off وDDD Class A invariants القابلة للتطبيق وTechnical Debt الجديد من مستوى high/critical الذي أدخله الـ diff الحالي. Architecture Debt هو `canary` وPrivacy/LGPD هو `shadow`. أخطاء runtime الداخلية تتدهور إلى `continue`.

## الـ Hosts

تولّد المصادر canonical projections لـ Claude Code وCodex وAntigravity وGrok. يمكن تغيير الـ host من دون فقدان ذاكرة المشروع وحوكمته الدائمة.
