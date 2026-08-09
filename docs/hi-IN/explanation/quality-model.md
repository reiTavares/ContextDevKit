# Quality Model

ContextDevKit 4 observations और authority को अलग रखता है।

## Evidence states

```text
passed | violated | unknown | skipped | error
```

`unknown`, `skipped` और `error` को कभी PASS नहीं दिखाया जाता।

## QA

Applicable guarded predicate होने पर `done` transition की रक्षा करता है। Implementation शुरू होने से पहले block नहीं करता।

## DDD

केवल declared, applicable और deterministically violated Class A invariant guarded floor का भाग बन सकता है। Classifier opinion या unconfirmed domain map पर्याप्त evidence नहीं है।

## Technical Debt

यह current diff का ratchet है। केवल वही नया `high`/`critical` debt completion deny कर सकता है जो current change ने introduce किया हो। Historical debt unrelated work को block नहीं करता।

## Architecture Debt

यह broader structural evaluation है और `canary` रहता है। यह risk/evidence दे सकता है, लेकिन स्वयं चौथा guarded gate नहीं बनता।

## Code Review और Lean Code

ये engineering/advisory responsibilities हैं। Finding evidence और context के साथ होना चाहिए; file size अकेले architecture verdict नहीं है।
