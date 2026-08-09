# Business-Driven Development

يفصل Business-Driven Development بين ثلاثة أسئلة: هل يوجد عمل حقيقي على المشروع، من يملك السبب الدائم لهذا العمل، وما شكل التنفيذ المطلوب فعلياً.

## 1. interaction أولاً

`conversation` و`exploration` حالتان غير مولدتين للعمل الدائم. فقط `mutation` المؤكدة تدخل إلى intake. عندما لا تكفي الأدلة، يطرح ContextDevKit سؤالاً قصيراً بدلاً من اختراع عمل جديد.

## 2. العمل الموجود قبل إنشاء عمل جديد

يمكن للـ resolver أن يعيد `explicit` أو `inferred` أو `ambiguous` أو `new` أو `none`. لا يتم اختيار match غامض بصمت، ولا يعاد فتح عنصر `done` من دون أمر صريح.

## 3. Nature

- **Business**: capability أو product أو initiative أو decision استراتيجية ودائمة، تستحق حفظ outcome/KPI/sponsor/investment/horizon عبر جلسات متعددة.
- **Operation**: سياق دائم للصيانة أو incident أو recovery أو improvement داخل capability موجودة.
- **none**: نتيجة طبيعية لـ feature محددة أو bug أو docs أو تغيير تقني لا يحتاج owner دائماً.
- **unclassified**: أدلة متنافسة أو غير كافية؛ يحتاج سؤالاً توضيحياً قصيراً.

## 4. Execution shape مستقلة

`direct` و`batch` و`workflow` لا تُشتق تلقائياً من Business/Operation. Business لا يفرض Workflow، وكلمات architecture أو ADR أو compliance لا تفعل ذلك أيضاً.

استخدم Workflow فقط عند وجود dependencies حقيقية أو waves أو ترتيب إلزامي أو multi-session أو coordinated integration أو cutover/rollback.

## 5. Business matching

يمكن لـ Operation أن تحصل على Business **suggested** عبر scoring حتمي. المطابقة الضعيفة تبقى `unlinked`، والـ matcher لا يكتب `confirmed` بنفسه.

> **يجب إنشاء سياق دائم عندما يؤدي نسيانه إلى الإضرار بالمشروع.**
