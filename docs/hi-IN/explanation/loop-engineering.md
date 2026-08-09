# Evidence-Driven Loop Engineering

ContextDevKit delivery को one-shot generation नहीं, बल्कि engineering loop मानता है।

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

Agent loop host का है। Engineering loop project का है और context compaction, नई session, दूसरे model या दूसरे host के बाद भी जारी रह सकता है।

## Adaptive depth

Active agent complexity, scope, risk, blast radius, affected contracts, domain weight, critical paths, owner instruction और available evidence से depth चुनता है।

Typo के लिए focused validation पर्याप्त हो सकती है। Material feature को tests + code review चाहिए हो सकता है। Critical change में full QA, DDD, architecture, security, debt, integration/E2E या performance शामिल हो सकते हैं।

## Evaluators

QA, DDD, Technical Debt, Architecture Debt, Code Review, Security, Lean Code, Performance और Accessibility evidence देते हैं। हर evaluator blocking authority नहीं रखता।

## Fresh QA cycle

`qa-reject` task को `testing` या `done` से `backlog` में लौटा सकता है। Current-cycle evidence साफ होता है; historical events बने रहते हैं। Completed Workflow भी reopen हो सकता है।

## Completion

`unknown`, `skipped` और `error` PASS नहीं हैं। लेकिन optional evaluator failure platform को स्वतः block भी नहीं करता। केवल configured guarded quality floors अपने documented moments पर deny कर सकते हैं।

> **Model completion propose कर सकता है। Evidence उसे justify करता है। Outcome owner तय करता है।**
