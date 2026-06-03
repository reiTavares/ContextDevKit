# Example — with RAG (Python)

Requires `spec.capabilities.rag: true` and a built index (see `rag/`).

```python
from agent import create_agent  # ../adapters/python/agent.py

agent = create_agent(
    manifest_path="../manifest.yaml",
    credentials={"anthropic": os.environ["ANTHROPIC_API_KEY"]},
)

# The adapter retrieves from the configured index (rag/config.yaml) and injects
# context per rag/retrieval/query-template.md before calling the model.
out = agent.invoke({"{{input_field}}": "{{a question answerable from the knowledge base}}"})
print(out)
```

Retrieval, reranking, and the score threshold are all read from `rag/`. The model is
instructed to answer only from retrieved context (faithfulness > fluency).
