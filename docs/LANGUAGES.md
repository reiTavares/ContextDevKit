# Documentation languages

English is the canonical technical documentation. Localized trees preserve command names, paths, ids, JSON keys, code symbols, and status values exactly as defined by the runtime.

| Locale | Language | Direction | Coverage | Documentation |
| --- | --- | --- | --- | --- |
| `en` | English | LTR | canonical/full | [docs/README.md](README.md) |
| `pt-BR` | Português (Brasil) | LTR | extended v4 | [pt-BR/README.md](pt-BR/README.md) |
| `es-ES` | Español | LTR | core v4 | [es-ES/README.md](es-ES/README.md) |
| `ru-RU` | Русский | LTR | core v4 | [ru-RU/README.md](ru-RU/README.md) |
| `hi-IN` | हिन्दी | LTR | core v4 | [hi-IN/README.md](hi-IN/README.md) |
| `zh-CN` | 简体中文 | LTR | core v4 | [zh-CN/README.md](zh-CN/README.md) |
| `ar` | العربية | RTL | core v4 | [ar/README.md](ar/README.md) |
| `he-IL` | עברית | RTL | core v4 | [he-IL/README.md](he-IL/README.md) |

## Locale policy

Locale tags follow BCP 47. `docs/locales.json` is the machine-readable locale manifest used by documentation tooling.

- `en` is the canonical fallback for technical details not yet translated.
- `pt-BR` has the broadest localized operational documentation.
- `core-v4` means the principal ContextDevKit 4 concepts and governance surfaces are translated: architecture, Business-Driven Development/intake, Loop Engineering, governance/enforcement, quality model, governance contract, glossary, and the Business-case operational guide.
- Arabic and Hebrew are declared `rtl`; technical tokens and code blocks remain canonical.
- Translation must never rename commands, paths, ids, JSON keys, status enums, or code symbols.
- If a localized document conflicts with the canonical English runtime contract, the English canonical source and the implementation win until the translation is corrected.
