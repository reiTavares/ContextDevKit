# Business-Driven Development

Business-Driven Development तीन अलग प्रश्नों को अलग रखता है: क्या वास्तव में project work है, उस काम के कारण का durable owner कौन है, और execution के लिए कौन-सी shape चाहिए।

## 1. Interaction पहले

`conversation` और `exploration` inert हैं। केवल confirmed `mutation` intake तक जाती है। Evidence पर्याप्त न हो तो ContextDevKit काम invent करने के बजाय एक छोटा clarification पूछता है।

## 2. Existing work पहले

Resolver `explicit`, `inferred`, `ambiguous`, `new` या `none` दे सकता है। Ambiguous match silently select नहीं होता और `done` item explicit आदेश के बिना reopen नहीं होता।

## 3. Nature

- **Business**: durable strategic capability, product, initiative या decision जिसका outcome/KPI/sponsor/investment/horizon याद रखना उपयोगी है।
- **Operation**: existing capability के भीतर durable maintenance, incident, recovery या improvement context।
- **none**: focused feature, bug, docs या technical change के लिए सामान्य result जहाँ durable owner की जरूरत नहीं।
- **unclassified**: competing/insufficient evidence; छोटा clarification चाहिए।

## 4. Execution shape स्वतंत्र है

`direct`, `batch` और `workflow` Business/Operation से स्वतः नहीं निकलते। Business Workflow को force नहीं करता। Architecture, ADR या compliance vocabulary भी नहीं।

Workflow केवल real dependencies, waves, mandatory ordering, multi-session work, coordinated integration या cutover/rollback पर इस्तेमाल करें।

## 5. Business matching

Operation को deterministic scoring से Business **suggested** मिल सकता है। Weak match `unlinked` रहता है; matcher स्वयं `confirmed` नहीं करता।

> **Durable context तभी बनना चाहिए जब उसे भूलना project को नुकसान पहुँचाए।**
