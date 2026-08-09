# Reference: <Component / API / Config key name>

<!-- GENRE: Reference (information-oriented)
     Goal: complete, accurate lookup — describe the machinery exactly as it is.
     Voice: dry, precise, third-person.  No narrative, no step-by-step.
     Rule: every option, flag, field, and return value gets one row or paragraph.
           Omit nothing.  Do not explain WHY — link to explanation for that. -->

## Synopsis

<!-- One-line description of what this component/API/config does.
     If a CLI command: include the usage line, e.g. `command [options] <arg>` -->

```
<usage or import line>
```

## Parameters / Options / Fields

<!-- Table or definition list — one entry per parameter.
     Columns: Name | Type | Default | Required | Description -->

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `param` | `string` | `""` | yes | What it controls. |

## Return value / Output

<!-- Describe the type, shape, and semantics of what this produces.
     If it emits to stdout/files, describe format and encoding. -->

## Error conditions

<!-- Table or list: condition → error thrown / exit code / message. -->

| Condition | Error / Exit | Message |
|-----------|-------------|---------|
| Missing required param | `Error` | `"..."` |

## Examples

<!-- Minimal, complete examples — one per common usage pattern.
     No prose padding; let the code speak. -->

```shell
# Example 1
```

```js
// Example 2
```

## See also

<!-- Links to the how-to guide, the explanation, and any related reference pages. -->
