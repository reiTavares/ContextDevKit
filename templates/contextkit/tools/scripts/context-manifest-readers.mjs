/**
 * Context-manifest SECTION READERS (CDK-052, PKG-05) — the metadata-extraction
 * half of the manifest generator. Split from `context-manifest.mjs` at the
 * read-vs-compose seam (this file owns "turn a memory dir into metadata records";
 * the orchestrator owns biasing, capping, signing, rendering, export).
 *
 * Every reader is METADATA-ONLY and FAIL-OPEN: it returns ids/titles/paths/counts
 * (never a file body) and degrades to `[]` / `null` on any missing dir or file —
 * never throws. Read-if-present, degrade-if-absent (the kit's hot-path contract).
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { ADR_FILENAME_RE, parseAdr } from './adr-digest-core.mjs';
import { SESSION_FILENAME_RE, parseSessionLog } from '../../runtime/hooks/session-digest-core.mjs';

const readSafe = (abs) => readFile(abs, 'utf-8').catch(() => null);
const listDir = (abs) => readdir(abs).catch(() => []);

/** Decision ADRs as metadata records (`{id,title,path}`). Fail-open to []. */
export async function readDecisions(decisionsDir) {
  const files = (await listDir(decisionsDir))
    .filter((f) => ADR_FILENAME_RE.test(f) && f !== '_TEMPLATE.md')
    .sort();
  const out = [];
  for (const name of files) {
    const text = await readSafe(resolve(decisionsDir, name));
    if (text === null) continue;
    const record = parseAdr(text, name);
    out.push({ id: record.number, title: record.title || record.slug || name, path: `decisions/${name}` });
  }
  return out;
}

/** Session logs as metadata records (`{id,title,path}`). Fail-open to []. */
export async function readSessions(sessionsDir) {
  const files = (await listDir(sessionsDir)).filter((f) => SESSION_FILENAME_RE.test(f)).sort();
  const out = [];
  for (const name of files) {
    const text = await readSafe(resolve(sessionsDir, name));
    if (text === null) continue;
    const record = parseSessionLog(text, name);
    const id = record.number != null
      ? String(record.number).padStart(2, '0')
      : (SESSION_FILENAME_RE.exec(name)?.[2] || '');
    out.push({ id, title: record.title || record.slug || name, path: `sessions/${name}` });
  }
  return out;
}

/**
 * Glossary TERMS only — the left column of the markdown table. Never the notes
 * column or any prose; the path anchor points the reader at the source row.
 * Fail-open to [].
 */
export async function readGlossary(glossaryPath) {
  const text = await readSafe(glossaryPath);
  if (!text) return [];
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const term = (line.split('|')[1] || '').trim();
    if (!term || term === 'Domain term (UI / business)' || /^-+$/.test(term) || /^_example/i.test(term)) continue;
    out.push({ term, path: 'GLOSSARY.md' });
  }
  return out;
}

/**
 * Project-map manifest as METADATA ONLY — the manifest path + module count, never
 * the module bodies or symbol bytes. Fail-open to `null`.
 */
export async function readProjectMap(projectMapDir) {
  const text = await readSafe(resolve(projectMapDir, 'manifest.json'));
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
  const moduleCount = Array.isArray(parsed?.modules) ? parsed.modules.length : 0;
  return { manifestPath: 'project-map/manifest.json', moduleCount };
}

/** Playbook TITLES only (`# Playbook — Title` heading) + path. Fail-open to []. */
export async function readPlaybooks(playbooksDir) {
  const files = (await listDir(playbooksDir)).filter((f) => f.endsWith('.md')).sort();
  const out = [];
  for (const name of files) {
    const text = await readSafe(resolve(playbooksDir, name));
    if (text === null) continue;
    const heading = text.split('\n').find((l) => l.startsWith('# '));
    const title = heading
      ? heading.slice(2).replace(/^Playbook\s*[—:-]\s*/i, '').trim()
      : basename(name, '.md');
    out.push({ title, path: `${basename(playbooksDir)}/${name}` });
  }
  return out;
}
