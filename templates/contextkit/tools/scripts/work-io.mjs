/**
 * Shared I/O + CLI plumbing for the `work.mjs` public entry point (BIZ-0001 /
 * WF-0036, A1-T2). Single-sourced so every `work*` command agrees on argv
 * parsing, dry-run posture, receipt shape and atomic writes.
 *
 * Reuse over rebuild: atomic writes come from the kit's `safe-io.mjs`
 * (`writeFileAtomicSync`, ADR-0089) and the managed-block primitives come from
 * the workflow engine's `workflow/io.mjs` — this module re-exports them so the
 * commands never re-implement either. Zero runtime dependencies — `node:*` only
 * (immutable rule 1). Mutators are dry-run by default (constitution §8).
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';
import { isNonEmptyString } from '../../runtime/work/enums.mjs';

export { writeFileAtomicSync };
export { updateManagedBlock, readManagedBlock, writeIfChanged } from './workflow/io.mjs';

/**
 * Parses an argv tail into `{ command, positionals, flags }`. Long flags use
 * `--name` (boolean) or `--name value`; `--name=value` is also accepted. Unknown
 * flags are preserved verbatim — validation is each command's responsibility.
 *
 * @param {string[]} argv - the process argv tail (after the script name).
 * @returns {{ command: string|null, positionals: string[], flags: Record<string, string|boolean> }}
 */
export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
        flags[body] = argv[index + 1];
        index += 1;
      } else {
        flags[body] = true;
      }
    } else {
      positionals.push(token);
    }
  }
  const command = positionals.length ? positionals[0] : null;
  return { command, positionals: positionals.slice(1), flags };
}

/**
 * Resolves the apply/dry-run posture from parsed flags. Refusal-by-default
 * (constitution §8): a mutator only writes when `--apply` is explicit.
 *
 * @param {Record<string, string|boolean>} flags - parsed flags.
 * @returns {{ apply: boolean, json: boolean }} resolved posture.
 */
export function resolvePosture(flags) {
  return { apply: flags.apply === true, json: flags.json === true };
}

/**
 * Slugifies a human title into a filesystem- and id-safe token (lower-kebab).
 * Throws on an empty result so a refused/blank title never silently yields "".
 *
 * @param {string} title - human-facing title.
 * @returns {string} a non-empty lower-kebab slug.
 * @throws {TypeError} when `title` is not a non-empty string.
 * @throws {Error} when the title slugifies to the empty string.
 */
export function slugify(title) {
  if (!isNonEmptyString(title)) throw new TypeError('slugify: title must be a non-empty string');
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`slugify: "${title}" produced an empty slug`);
  return slug;
}

/**
 * Atomically write `content` to `path`, creating parent directories first so a
 * brand-new Operation package directory is materialized in one call.
 *
 * @param {string} path - absolute target path.
 * @param {string} content - file content.
 * @returns {void}
 */
export function writeFileEnsured(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomicSync(path, content);
}

/**
 * Builds the canonical receipt object every `work` mutator returns/prints. The
 * receipt is the audit trail of what a command did (or, in dry-run, WOULD do).
 *
 * @param {object} fields - receipt fields.
 * @param {string} fields.command - the command name (e.g. "operation").
 * @param {boolean} fields.applied - true when an atomic write occurred.
 * @param {string[]} fields.writes - target paths written (or planned).
 * @param {object} [fields.detail] - command-specific structured detail.
 * @returns {{ command: string, applied: boolean, mode: string, writes: string[], detail: object }}
 */
export function makeReceipt({ command, applied, writes, detail = {} }) {
  return {
    command,
    applied: Boolean(applied),
    mode: applied ? 'apply' : 'dry-run',
    writes: Array.isArray(writes) ? writes : [],
    detail,
  };
}

/**
 * Renders a receipt as a concise human line (non-JSON output). Lists planned vs
 * written targets so a dry-run is unmistakable from an applied run.
 *
 * @param {ReturnType<typeof makeReceipt>} receipt - the receipt to print.
 * @returns {string} a multi-line human summary.
 */
export function formatReceipt(receipt) {
  const verb = receipt.applied ? 'wrote' : 'would write (dry-run; pass --apply)';
  const lines = [`work ${receipt.command}: ${verb} ${receipt.writes.length} file(s)`];
  for (const target of receipt.writes) lines.push(`  - ${target}`);
  return lines.join('\n');
}
