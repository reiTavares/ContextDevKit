/**
 * Whitelisted condition parser + evaluator for the squad pipeline DSL
 * ([ADR-0015](../../memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md) Part A).
 *
 * Single responsibility: turn a `condition:` string from `pipeline.yaml` into
 * a tiny AST, then evaluate it against the pipeline context. No arbitrary
 * expression evaluation, no function calls, no boolean chaining — by design.
 *
 * Grammar (full reference in docs/SQUAD-PIPELINE-FORMAT.md §condition):
 *   condition := dotted_id <op> literal
 *              | dotted_id ".length" <op> int
 *   dotted_id := identifier ( "." identifier )*
 *   op        := "==" | "!=" | ">=" | "<=" | ">" | "<"
 *   literal   := string | int | float | bool | null
 *
 * API:
 *   parseCondition(expr) → { ok: true, ast } | { ok: false, reason }
 *   evalCondition(ast, ctx) → boolean
 *
 * Pure, zero-dep. Stays under the 280-line budget by keeping the lexer and
 * the comparator inline (one small file, two ~40-line halves).
 */

const OP_RE = /^(==|!=|>=|<=|>|<)/;
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*/;
const INT_RE = /^-?\d+(?![.\d])/;
const FLOAT_RE = /^-?\d+\.\d+/;
const STRING_RE = /^"([^"]*)"|^'([^']*)'/;
const VALID_OPS = ['==', '!=', '>=', '<=', '>', '<'];

/**
 * Parses a condition expression into an AST.
 *
 * @param {string} expr — the raw `condition:` value from `pipeline.yaml`
 * @returns {{ ok: true, ast: { path: string[], isLength: boolean, op: string, literal: unknown } }
 *        | { ok: false, reason: string }}
 */
export function parseCondition(expr) {
  if (typeof expr !== 'string' || expr.trim() === '') {
    return { ok: false, reason: 'empty condition' };
  }

  let src = expr.trim();

  // --- identifier path -----------------------------------------------------
  const path = [];
  const firstId = src.match(IDENT_RE);
  if (!firstId) return { ok: false, reason: 'expected identifier' };
  path.push(firstId[0]);
  src = src.slice(firstId[0].length);

  while (src.startsWith('.')) {
    src = src.slice(1);
    const nextId = src.match(IDENT_RE);
    if (!nextId) return { ok: false, reason: 'expected identifier after "."' };
    path.push(nextId[0]);
    src = src.slice(nextId[0].length);
  }

  const isLength = path[path.length - 1] === 'length' && path.length > 1;

  // --- operator ------------------------------------------------------------
  src = src.trimStart();
  const opMatch = src.match(OP_RE);
  if (!opMatch) {
    return { ok: false, reason: `expected one of ${VALID_OPS.join(' / ')} after dotted_id` };
  }
  const op = opMatch[0];
  src = src.slice(op.length).trimStart();

  // --- literal -------------------------------------------------------------
  const lit = parseLiteral(src);
  if (!lit.ok) return { ok: false, reason: lit.reason };

  // .length restricts the RHS to int
  if (isLength && !Number.isInteger(lit.value)) {
    return { ok: false, reason: '.length must be compared to an integer literal' };
  }

  // --- nothing else is allowed --------------------------------------------
  if (lit.rest.trim() !== '') {
    return { ok: false, reason: `unexpected trailing input: "${lit.rest.trim()}"` };
  }

  return { ok: true, ast: { path, isLength, op, literal: lit.value } };
}

/**
 * Reads one literal off the front of `src`. Returns the value and the
 * remainder so the caller can assert nothing trails.
 *
 * @param {string} src
 * @returns {{ ok: true, value: unknown, rest: string } | { ok: false, reason: string }}
 */
function parseLiteral(src) {
  if (src.startsWith('true')) {
    return { ok: true, value: true, rest: src.slice(4) };
  }
  if (src.startsWith('false')) {
    return { ok: true, value: false, rest: src.slice(5) };
  }
  if (src.startsWith('null')) {
    return { ok: true, value: null, rest: src.slice(4) };
  }

  const str = src.match(STRING_RE);
  if (str) return { ok: true, value: str[1] ?? str[2], rest: src.slice(str[0].length) };

  const flt = src.match(FLOAT_RE);
  if (flt) return { ok: true, value: Number(flt[0]), rest: src.slice(flt[0].length) };

  const int = src.match(INT_RE);
  if (int) return { ok: true, value: parseInt(int[0], 10), rest: src.slice(int[0].length) };

  return { ok: false, reason: 'expected literal (string / int / float / bool / null)' };
}

/**
 * Resolves a dotted path against `ctx`. Returns `undefined` on any miss.
 * `.length` is special-cased for arrays and strings.
 *
 * @param {string[]} path
 * @param {Record<string, unknown>} ctx
 * @returns {unknown}
 */
function resolve(path, ctx) {
  let cur = ctx;
  for (let i = 0; i < path.length; i += 1) {
    const key = path[i];
    if (cur == null || typeof cur !== 'object') return undefined;
    if (key === 'length' && i === path.length - 1 && i > 0) {
      if (typeof cur === 'string' || Array.isArray(cur)) return cur.length;
      return undefined;
    }
    cur = cur[key];
  }
  if (typeof cur === 'function') return undefined;
  return cur;
}

/**
 * Evaluates a parsed condition against `ctx`. The grammar guarantees the
 * AST is well-formed; the only runtime concerns are `undefined`-resolution
 * and the no-coercion compare semantics.
 *
 * Rules:
 *   - `undefined <op> <literal>` → false (always).
 *   - `==` / `!=` use strict equality (no coercion).
 *   - `>` / `<` / `>=` / `<=` require both sides to be `typeof "number"`;
 *     otherwise → false.
 *
 * @param {{ path: string[], isLength: boolean, op: string, literal: unknown }} ast
 * @param {Record<string, unknown>} ctx
 * @returns {boolean}
 */
export function evalCondition(ast, ctx) {
  const left = resolve(ast.path, ctx ?? {});
  if (left === undefined) return false;
  const right = ast.literal;
  switch (ast.op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return typeof left === 'number' && typeof right === 'number' && left > right;
    case '<':
      return typeof left === 'number' && typeof right === 'number' && left < right;
    case '>=':
      return typeof left === 'number' && typeof right === 'number' && left >= right;
    case '<=':
      return typeof left === 'number' && typeof right === 'number' && left <= right;
    default:
      return false;
  }
}

/**
 * One-shot helper: parse + evaluate. Useful in tests and for the engine
 * when it doesn't need to cache the AST.
 *
 * @param {string} expr
 * @param {Record<string, unknown>} ctx
 * @returns {boolean}
 * @throws {Error} if the expression refuses to parse (grammar violation —
 *   the engine catches this and exits 1).
 */
export function parseAndEval(expr, ctx) {
  const parsed = parseCondition(expr);
  if (!parsed.ok) throw new Error(`condition refused: ${parsed.reason}`);
  return evalCondition(parsed.ast, ctx);
}
