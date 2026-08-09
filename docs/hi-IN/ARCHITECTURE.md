# आर्किटेक्चर

ContextDevKit एक host-agnostic **AI Software Engineering Governance Harness** है। Host अपने agent loop, tools और platform safety boundaries का मालिक रहता है; ContextDevKit project intelligence, long-term memory, context, work lifecycle, evidence और governance की durable layer देता है।

## Interaction flow

```text
request
  ↓
conversation | exploration | mutation | unclassified
  ↓ (केवल mutation)
Intake Envelope
  ↓
Business | Operation | none
  ↓
direct | batch | workflow
```

Conversation और read-only exploration durable state नहीं बनाते। Intent अस्पष्ट हो तो एक छोटा clarification पूछा जाता है। वास्तविक write attempt interaction को authoritative रूप से `mutation` में promote करता है।

## Intake Envelope

यह पहले से उपलब्ध signals का transient view है: interaction, existing work, nature, execution shape, tier/complexity, domain/risk, value intent, decision need/match, Business match, reasons और evidence। यह कोई नया mandatory file या ceremony नहीं है।

## State authorities

| State | Authority |
| --- | --- |
| Workflow definition | `workflow.json` |
| Workflow lifecycle | `workflow-state.json` |
| tasks/status/events | `pipeline/tasks.json` |
| transient run | `memory/runs/<id>/state.json` |
| owner preferences | `memory/preferences/owner-preferences.json` |

Markdown authored context या derived projection है; वह दूसरा state writer नहीं है।

## Governance

Default रूप से केवल QA sign-off, applicable DDD Class A invariants और current diff द्वारा जोड़ा गया नया high/critical Technical Debt `guarded` हो सकता है। Architecture Debt `canary` है; Privacy/LGPD `shadow` है। Internal runtime failure `continue` पर degrade होता है।

## Hosts

Canonical sources Claude Code, Codex, Antigravity और Grok के लिए projections बनाते हैं। Host बदल सकता है, लेकिन governed project memory और intelligence बनी रहती है।
