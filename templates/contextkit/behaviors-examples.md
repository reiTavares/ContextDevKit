# Behavioral Discipline — examples

> Concrete before/after diffs for the four guidelines in
> [`behaviors.md`](./behaviors.md). Each shows what an LLM commonly does wrong and
> the disciplined alternative. Examples are in Python for brevity; the *behavior*
> is language-agnostic.
>
> Adapted from the MIT-licensed `karpathy-guidelines` skill (Andrej Karpathy's
> observations on LLM coding pitfalls).

---

## 1. Think before coding

### Hidden assumptions

**Request:** "Add a feature to export user data."

❌ **What LLMs do** — implement `export_users(format='json')` that dumps *all*
users to a hardcoded file path with a guessed field list. Four silent
assumptions (scope, location, fields, privacy), any of which can be wrong.

✅ **Disciplined** — surface the assumptions and ask before coding:

```
Before implementing, I need to clarify:
1. Scope: all users or a filtered subset? (privacy implications)
2. Delivery: browser download, background job + email, or an API endpoint?
3. Fields: which ones? (some may be sensitive)
4. Volume: how many rows typically? (changes the approach)

Simplest path: a paginated JSON endpoint. File exports need more info — preference?
```

### Multiple interpretations

**Request:** "Make the search faster."

❌ **What LLMs do** — silently add caching *and* indexes *and* async in one
200-line diff, optimizing a dimension the user may not care about.

✅ **Disciplined** — name the interpretations with rough cost, then let the user pick:
latency (indexes/cache, ~2h) · throughput (async/pooling, ~4h) · perceived speed
(progressive results, ~3h). "Current ~500ms typical — which matters most?"

---

## 2. Simplicity first

### Over-abstraction

**Request:** "Add a function to calculate a discount."

❌ **What LLMs do** — `DiscountStrategy(ABC)` + `PercentageDiscount` +
`FixedDiscount` + `DiscountConfig` + `DiscountCalculator`: 30+ lines of patterns
for one calculation.

✅ **Disciplined:**

```python
def calculate_discount(amount: float, percent: float) -> float:
    """Discount amount. percent is 0-100."""
    return amount * (percent / 100)
```

> Add the strategy pattern **when a second discount type actually exists** —
> refactor then, not now.

### Speculative features

**Request:** "Save user preferences to the database."

❌ **What LLMs do** — a `PreferenceManager` with injected cache + validator and a
`save(..., merge=True, validate=True, notify=False)` signature: caching,
validation, merging, and notifications nobody asked for.

✅ **Disciplined:**

```python
def save_preferences(db, user_id: int, preferences: dict):
    db.execute("UPDATE users SET preferences = ? WHERE id = ?",
               (json.dumps(preferences), user_id))
```

> Add caching when performance bites, validation when bad data appears, merging
> when the requirement emerges.

---

## 3. Surgical changes

### Drive-by refactoring

**Request:** "Fix the bug where empty emails crash the validator."

❌ **What LLMs do** — fix the empty-email check *and* "improve" email validation,
*and* add username length/alphanumeric rules, *and* add a docstring, *and* rewrite
the comments. The bug fix is buried in unrelated changes.

✅ **Disciplined** — change only the lines that fix empty-email handling:

```diff
  def validate_user(user_data):
      # Check email format
-     if not user_data.get('email'):
+     email = user_data.get('email', '')
+     if not email or not email.strip():
          raise ValueError("Email required")
```

Username validation, docstrings, and comment rewrites are *not in this diff*.

### Style drift

**Request:** "Add logging to the upload function."

❌ **What LLMs do** — while adding logging, switch `'single'` to `"double"`
quotes, add type hints, insert a docstring, and reformat whitespace. Every one of
those is noise that hides the real change and fights the file's existing style.

✅ **Disciplined** — add the logging lines and **nothing else**; match the file's
existing single quotes, no-type-hint, existing-boolean-pattern style. The diff
contains logging and only logging.

---

## 4. Goal-driven execution

### Reproduce before fixing

**Request:** "The sorting breaks when there are duplicate scores."

❌ **What LLMs do** — immediately rewrite the sort key without confirming the bug,
so there's no proof the fix addresses the real failure (or that it won't return).

✅ **Disciplined** — write the failing test first, *then* fix:

```python
def test_sort_with_duplicate_scores():
    scores = [{'name':'Alice','score':100},{'name':'Bob','score':100},{'name':'Charlie','score':90}]
    result = sort_scores(scores)              # run repeatedly — order must be stable
    assert [s['name'] for s in result] == ['Alice', 'Bob', 'Charlie']
# Verify it FAILS (reproduces the non-deterministic order), then:

def sort_scores(scores):
    """Score desc, then name asc for ties (stable)."""
    return sorted(scores, key=lambda s: (-s['score'], s['name']))
# Verify it now passes, consistently.
```

### Incremental with verification

**Request:** "Add rate limiting to the API."

❌ **What LLMs do** — a 300-line Redis-backed, multi-strategy, configurable
system in one commit with no verification steps.

✅ **Disciplined** — a plan where each step is independently verifiable:

```
1. In-memory limit, one endpoint → verify: 11th request gets 429
2. Extract to middleware (all endpoints) → verify: applies to /users + /posts; old tests green
3. Redis backend (multi-server) → verify: limit persists across restart; shared across instances
4. Per-endpoint config → verify: /search 10/min, /users 100/min
```

---

## Anti-pattern summary

| Guideline | Anti-pattern | Fix |
|---|---|---|
| Think before coding | Silently assumes scope/format/fields | List assumptions, ask before coding |
| Simplicity first | Strategy pattern for one calculation | One function until a 2nd consumer is real |
| Surgical changes | Reformats + adds type hints while fixing a bug | Only the lines that fix the reported issue |
| Goal-driven | "I'll review and improve the code" | "Failing test for X → make it pass → no regressions" |

## The key insight

The overcomplicated versions aren't obviously wrong — they follow real design
patterns. The problem is **timing**: complexity added *before it's needed* is
harder to read, more bug-prone, slower to ship, and harder to test. Good code
solves **today's** problem simply; it doesn't pre-solve tomorrow's.
