# مسرد المصطلحات

| المصطلح | المعنى |
| --- | --- |
| Harness | طبقة دائمة حول coding host للسياق والذاكرة ودورة العمل والأدلة والحوكمة |
| interaction | `conversation` أو `exploration` أو `mutation` أو `unclassified` |
| Intake Envelope | عرض مؤقت لإشارات intake؛ ليس artifact دائماً |
| Business | سياق استراتيجي دائم `BIZ-####` |
| Operation | سياق تشغيلي دائم `OP-####` |
| none | عمل عادي بلا Business/Operation owner دائم |
| direct | execution shape صغيرة ومتماسكة |
| batch | tasks مترابطة من دون ترتيب قوي |
| Workflow | عمل منسق مع dependencies/waves/multi-session/cutover |
| task | وحدة عمل داخل `pipeline/tasks.json` |
| guarded | وضع يمكنه deny فقط عند اكتمال deterministic predicate |
| canary | يقيّم ويبلغ من دون deny |
| shadow | يراقب من دون تغيير outcome |
| Architecture Debt | تحليل canary للمخاطر الهيكلية |
| Technical Debt | guarded ratchet لـ high/critical debt الجديدة في الـ diff الحالي |
| engineering loop | implement → evaluate → correct → re-evaluate باستخدام fresh evidence |
| owner override | قبول بشري صريح وقابل للتدقيق لـ guarded verdict |

حالات task: `backlog`, `working`, `blocked`, `testing`, `done`, `cancelled`.
