/**
 * Tech-debt detectors — pure functions over file content, STACK-AGNOSTIC.
 *
 * Each detector takes `(relPath, content, opts)` and returns findings:
 *   { kind, severity, path, line?, snippet?, message }
 *   severity: 1..5 (5 = blocker, 1 = nit)
 *
 * Regex-based (no AST) so the scan is fast and dependency-free. False
 * positives are acceptable — the board is human-reviewed, not enforcing.
 */

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|swift|c|cpp|cs)$/;

/** File length vs the constitution's line budget (configurable). */
export function detectLineBudget(relPath, content, { yellow = 240, red = 308 } = {}) {
  const total = content.split('\n').length;
  if (total > red) {
    return [{ kind: 'line-budget', severity: 5, path: relPath, line: total, message: `${total} lines — RED ZONE (> ${red}). Split by responsibility.` }];
  }
  if (total >= yellow) {
    return [{ kind: 'line-budget', severity: 3, path: relPath, line: total, message: `${total} lines — yellow zone (>= ${yellow}). Plan a split or document cohesion at the top.` }];
  }
  return [];
}

/** Identifiers whose names join two responsibilities ("And"/"Or"/"E"). */
export function detectSrpAnd(relPath, content) {
  if (!CODE_RE.test(relPath)) return [];
  const findings = [];
  const lines = content.split('\n');
  const jsDecl = /(?:function\s+|const\s+|let\s+|var\s+|async\s+function\s+|export\s+(?:function\s+|const\s+|async\s+function\s+))([a-z][a-zA-Z0-9_]*)/g;
  const jsBad = /[a-z](And|Or|E)[A-Z][a-zA-Z0-9]*/;
  const pyDecl = /def\s+([a-z][a-z0-9_]*)/g;
  const pyBad = /_(and|or)_/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const [re, bad] of [[jsDecl, jsBad], [pyDecl, pyBad]]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        if (bad.test(m[1])) {
          findings.push({ kind: 'srp-and', severity: 2, path: relPath, line: i + 1, snippet: line.trim().slice(0, 120), message: `Identifier \`${m[1]}\` joins two responsibilities — split into separate functions.` });
        }
      }
    }
  }
  return findings;
}

/** TODO/FIXME/HACK/XXX markers — debt the author already flagged. */
export function detectTodoMarkers(relPath, content) {
  if (!CODE_RE.test(relPath)) return [];
  const findings = [];
  const re = /\b(TODO|FIXME|HACK|XXX)\b/;
  content.split('\n').forEach((line, i) => {
    if (re.test(line) && /\/\/|#|\/\*|\*/.test(line)) {
      findings.push({ kind: 'todo-marker', severity: 1, path: relPath, line: i + 1, snippet: line.trim().slice(0, 120), message: 'Unresolved TODO/FIXME marker.' });
    }
  });
  return findings;
}

/** React components with > 2 useState AND >= 1 useEffect → extract a hook. */
export function detectReactStateLoop(relPath, content) {
  if (!/\.(tsx|jsx)$/.test(relPath)) return [];
  if (/(^|\/)hooks?\//.test(relPath) || /use[A-Z]/.test(relPath.split('/').pop() || '')) return [];
  const states = (content.match(/\buseState\s*\(/g) || []).length;
  const effects = (content.match(/\buseEffect\s*\(/g) || []).length;
  if (states > 2 && effects >= 1) {
    return [{ kind: 'react-state-loop', severity: 3, path: relPath, message: `${states} useState + ${effects} useEffect — extract logic into a custom hook.` }];
  }
  return [];
}

export const ALL_DETECTORS = [detectLineBudget, detectSrpAnd, detectTodoMarkers, detectReactStateLoop];
export { CODE_RE };
