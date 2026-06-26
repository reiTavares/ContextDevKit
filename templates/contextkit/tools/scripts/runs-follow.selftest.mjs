/**
 * Self-test for `runs.mjs` COMP-003 — `--events <id> --follow` feature.
 *
 * Tests the two pure exported functions:
 *   - `newEventsSince(events, lastIndex)` — the "diff since last seen" core
 *   - `formatEvent(event)` — the per-event formatter
 *
 * Zero-dependency. Runs under plain `node`. Exits 0 = all assertions passed;
 * exits 1 = at least one failed. Never touches the filesystem or a real timer.
 */
import { newEventsSince, formatEvent } from './runs.mjs';

const failures = [];

/**
 * Records a named assertion.
 *
 * @param {string} label
 * @param {boolean} cond
 */
function assert(label, cond) {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!cond) failures.push(label);
}

// --- newEventsSince ---

process.stdout.write('\n# newEventsSince\n');

// Empty array → no new events regardless of lastIndex
assert('empty events + lastIndex 0 → []', newEventsSince([], 0).length === 0);
assert('empty events + lastIndex 5 → []', newEventsSince([], 5).length === 0);

// Non-array input → defensive empty return
assert('null events → []', newEventsSince(null, 0).length === 0);
assert('undefined events → []', newEventsSince(undefined, 0).length === 0);

// Build a fake events array — 5 events, no real I/O needed
const makeEvent = (i) => ({ ts: 1_700_000_000_000 + i * 1000, from: 'backlog', to: 'working', actor: 'human', inverse: 'backlog' });
const ALL_EVENTS = [0, 1, 2, 3, 4].map(makeEvent);

// lastIndex = 0 → all events are new
const fromZero = newEventsSince(ALL_EVENTS, 0);
assert('lastIndex 0 → all 5 events', fromZero.length === 5);

// lastIndex = 3 → only events at index 3 and 4
const fromThree = newEventsSince(ALL_EVENTS, 3);
assert('lastIndex 3 → 2 new events', fromThree.length === 2);
assert('fromThree[0] is event index 3', fromThree[0] === ALL_EVENTS[3]);
assert('fromThree[1] is event index 4', fromThree[1] === ALL_EVENTS[4]);

// lastIndex = 5 (at the end) → nothing new
assert('lastIndex at end → []', newEventsSince(ALL_EVENTS, 5).length === 0);

// lastIndex > length → nothing new (defensive)
assert('lastIndex past end → []', newEventsSince(ALL_EVENTS, 99).length === 0);

// Simulate two sequential polls — no duplicates across polls
let seen = 0;
const poll1 = newEventsSince(ALL_EVENTS, seen);
seen += poll1.length; // advance to 5
const poll2 = newEventsSince(ALL_EVENTS, seen);
assert('poll1 gets 5 events', poll1.length === 5);
assert('poll2 gets 0 events (no duplicates)', poll2.length === 0);

// Simulate a third poll after 2 more events arrive
const GROWN = [...ALL_EVENTS, makeEvent(5), makeEvent(6)];
const poll3 = newEventsSince(GROWN, seen);
seen += poll3.length;
assert('poll3 gets exactly 2 new events', poll3.length === 2);
assert('poll3 events are the newly added ones', poll3[0] === GROWN[5] && poll3[1] === GROWN[6]);
assert('no further new events after seen catches up', newEventsSince(GROWN, seen).length === 0);

// --- formatEvent ---

process.stdout.write('\n# formatEvent\n');

const sampleEvent = {
  ts: new Date('2026-01-15T10:30:00Z').getTime(),
  actor: 'human',
  from: 'backlog',
  to: 'working',
  inverse: 'backlog',
};

const formatted = formatEvent(sampleEvent);
assert('formatted contains ISO date prefix', formatted.includes('2026-01-15 10:30'));
assert('formatted contains actor padded', formatted.includes('human'));
assert('formatted contains from → to arrow', formatted.includes('backlog → working'));
assert('formatted contains undo', formatted.includes('undo → backlog'));

// Without note: no note suffix
assert('no note → no "·" separator', !formatted.includes(' · '));

// With note
const withNote = { ...sampleEvent, note: 'moved by CI' };
const formattedWithNote = formatEvent(withNote);
assert('with note → note visible', formattedWithNote.includes('· moved by CI'));

// Empty from/to → ∅ symbol
const emptyFromTo = { ts: Date.now(), actor: 'auto', from: '', to: 'backlog', inverse: '' };
const emptyFormatted = formatEvent(emptyFromTo);
assert('empty from renders ∅', emptyFormatted.includes('∅ → backlog'));
assert('empty inverse renders ∅', emptyFormatted.includes('undo → ∅'));

// actor padding: shorter than 5 chars still renders (padEnd)
const shortActor = { ts: Date.now(), actor: 'qa', from: 'working', to: 'testing', inverse: 'working' };
assert('short actor pads without throwing', typeof formatEvent(shortActor) === 'string');

// --- summary ---
process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
