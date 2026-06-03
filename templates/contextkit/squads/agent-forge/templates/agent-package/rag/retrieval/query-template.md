<!-- How the user query is turned into a retrieval query + how context is injected. -->

## Retrieval query
{{TRANSFORM of the user input into a search query — e.g. expand acronyms, strip PII}}

## Context injection
Inject the top-k chunks as:

```
<context>
{{retrieved_chunks}}
</context>
```

Instruct the model to answer ONLY from `<context>` and to say when the answer is not
present (faithfulness > fluency).
