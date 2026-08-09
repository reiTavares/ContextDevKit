# تشغيل Business case

استخدم هذا المسار فقط عندما يمثل العمل outcome استراتيجياً دائماً.

## 1. Intake للقراءة فقط

```bash
node contextkit/tools/scripts/work.mjs intake "<objective>" --json
```

راجع `nature` و`executionMode` وclarification وreasons وevidence. القيمة `none` صحيحة؛ لا تنشئ Business لميزة عادية.

## 2. أنشئ Business بشكل مقصود

استخدم سطح `work.mjs business` في المشروع. الـ classifier يقدّم معلومات؛ إنشاء ownership أو تأكيده قرار صريح.

## 3. اختر أصغر execution shape

يمكن لـ Business استخدام direct أو batch أو Workflow. اختر Workflow فقط بسبب topology حقيقية.

## 4. Operations مرتبطة

يمكن لـ Operation أن تحمي أو تدعم outcome الخاص بـ Business. يستطيع matcher اقتراح link، لكنه لا يؤكد strategic ownership تلقائياً.

## 5. Decisions وevidence

أنشئ ADR عند وجود material decision. Reports تحفظ الحقائق، وJSON يحتفظ بـ state authority.

## 6. Outcome

الهدف هو حفظ السياق الاستراتيجي الذي يجب أن يبقى بين الجلسات، لا إجبار كل تغيير تقني على الانتماء إلى Business.
