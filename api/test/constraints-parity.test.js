/* The constraint check the Coach's gate runs is a hand-copied twin
 * (api/coach/core/constraints.js) of frontend/src/lib/constraints.js — the same trade-off
 * payload.js's reading rules and queue.js already made, since api/ and frontend/src/lib share
 * no build step. A hand copy can drift silently, so this file pins the two engines together
 * over the same metadata, the way payload-parity.test.js pins readSession. It also walks the
 * pipeline's one repair round for a constrained proposal, the review-repair.test.js scenario
 * with a constraint in place of the duplicate.
 *
 * The frontend import is safe under plain node: constraints.js is dependency-free and pure. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';
import { conflictFor as frontendConflictFor } from '../../frontend/src/lib/constraints.js';

tempData();
const twin = await import('../coach/core/constraints.js');
const { LIB_BY_ID } = await import('../coach/core/library.js');
const { runPipeline } = await import('../coach/core/pipeline.js');
const { buildPromptParts } = await import('../coach/core/prompt.js');

/* The exercises the comparison runs over, with the metadata the regenerated library now
   carries: raw tg/mg/sm plus the muscle-map overlay's primaries/secondaries where it drew a
   lift more precisely. Asserting the overlay really is there first, or the table below would
   pass trivially on fields that silently went missing. */
const IDS = ['0001', '0002', '0025', '3593', '0009', '1274'];
const LOOKUP = Object.fromEntries(IDS.map(id => [id, LIB_BY_ID.get(id)]));

test('the server catalogue carries the muscle fields the twin matches on', () => {
  const squat = LIB_BY_ID.get('3593');
  assert.equal(squat.bp, 'upper legs');
  assert.equal(squat.tg, 'quads');
  assert.equal(squat.mg, 'glutes');
  assert.ok(squat.sm.includes('lower back'));
  const bench = LIB_BY_ID.get('0025');
  assert.deepEqual(bench.primaries, ['chest'], 'the muscle-map overlay was applied at generation');
  assert.ok(bench.secondaries.includes('deltoids'));
});

/* One constraint shape per matching dimension, incl. the awkward ones: case and whitespace on
   the constraint side, a resolved item, an explicit id nothing resolves to, and severity
   ordering among several matches. `id` rides along so the frontend's verdict is complete; the
   twin never reads it (payload items carry no id), so the comparison is on the fields that
   decide — level, label, matchedOn, source. */
const CONSTRAINTS = [
  { id: 'c1', label: 'No sit-ups', bodyParts: [], muscles: [], exerciseIds: ['0001'], status: 'active', source: 'self' },
  { id: 'c2', label: 'Legs', bodyParts: [' Upper Legs '], muscles: [], exerciseIds: [], status: 'active', source: 'self' },
  { id: 'c3', label: 'Quads', bodyParts: [], muscles: ['quads'], exerciseIds: [], status: 'active', source: 'self' },
  { id: 'c4', label: 'Glutes', bodyParts: [], muscles: ['GLUTES'], exerciseIds: [], status: 'active', source: 'professional' },
  { id: 'c5', label: 'Chest', bodyParts: [], muscles: ['chest'], exerciseIds: [], status: 'active', source: 'self' },          // overlay primaries
  { id: 'c6', label: 'Delts', bodyParts: [], muscles: ['deltoids'], exerciseIds: [], status: 'active', source: 'self' },       // overlay secondaries
  { id: 'c7', label: 'Lower back', bodyParts: [], muscles: ['lower back'], exerciseIds: [], status: 'active', source: 'self' },// sm only
  { id: 'c8', label: 'Resolved long ago', bodyParts: ['waist'], muscles: [], exerciseIds: [], status: 'resolved', source: 'self' },
  { id: 'c9', label: 'Gone exercise', bodyParts: [], muscles: [], exerciseIds: ['deleted-custom'], status: 'active', source: 'self' }
];

test('the twin and the frontend engine agree on every id × constraint pair, and on the worst verdict', () => {
  const shape = v => v && { level: v.level, constraintLabel: v.constraintLabel, matchedOn: v.matchedOn, source: v.source };
  for (const id of IDS.concat(['deleted-custom', 'nope'])) {
    for (const c of CONSTRAINTS) {
      const mine = twin.conflictFor(id, [c], LOOKUP);
      const theirs = frontendConflictFor(id, [c], LOOKUP);
      assert.deepEqual(shape(mine), shape(theirs), `${id} × ${c.label}`);
    }
  }
  // The whole list at once: the most severe level wins, and among equals the earliest item.
  for (const id of IDS) {
    assert.deepEqual(shape(twin.conflictFor(id, CONSTRAINTS, LOOKUP)), shape(frontendConflictFor(id, CONSTRAINTS, LOOKUP)), id);
  }
});

test('the twin reads the api\'s own Map index and the payload\'s status-free items', () => {
  // LIB_BY_ID is a Map; the frontend's EXIDX is a plain object. Same verdict either way.
  assert.deepEqual(
    twin.conflictFor('3593', CONSTRAINTS, LIB_BY_ID),
    twin.conflictFor('3593', CONSTRAINTS, LOOKUP)
  );
  // cleanConstraints emits active-only items with no status field; the twin must still match them.
  const cleaned = twin.cleanConstraints(CONSTRAINTS);
  assert.ok(!cleaned.some(c => 'status' in c));
  assert.ok(cleaned.every(c => c.label !== 'Resolved long ago'));
  assert.equal(twin.conflictFor('0001', cleaned, LOOKUP).level, 'blocked');
});

/* ---------- the pipeline's one repair round, with a constraint in the payload ---------- */

const plan = {
  routines: [{ id: 'push', name: 'Push Day', ex: [{ id: '0001', sets: 3, reps: 8 }, { id: '0007', sets: 3, reps: 10 }] }],
  week: { 1: ['push'] }
};
// What payload.build would hand over for one active constraint (the parity table above covers
// the cleaning); the model sees it, and the validator reads the same list back out. 'Waist
// work off' flags 0002 (45° side bend, bp waist); 0001 is waist too but the plan already trains
// it, and only an exercise being introduced is ever checked.
const withConstraints = () => ({ coach_contract: 1, plan, library: [], constraints: [{ label: 'Waist work off', bodyParts: ['waist'], muscles: [], exerciseIds: [], source: 'self' }] });
const constrainedSwap = JSON.stringify({
  coach_contract: 1, summary: 's',
  changes: [{ id: 'c1', type: 'swap-exercise', target: { routineId: 'push', exId: '0001' }, after: { id: '0002', sets: 4, reps: 8 }, why: 'stalled four times' }]
});
const fixedSwap = JSON.stringify({
  coach_contract: 1, summary: 's',
  changes: [{ id: 'c1', type: 'swap-exercise', target: { routineId: 'push', exId: '0001' }, after: { id: '0009', sets: 4, reps: 8 }, why: 'stalled four times' }]
});

function stub(answers) {
  const calls = [];
  return { calls, adapter: { spawns: false, async invoke(req) { calls.push(req); return { code: 0, text: answers[calls.length - 1] }; } } };
}

test('the common rules tell the model never to propose a constrained exercise', () => {
  const { system } = buildPromptParts('review', withConstraints(), null);
  assert.match(system, /Never propose an exercise the user's active constraints rule out/);
});

test('a constrained add goes back for repair naming the exercise and the constraint, and a fixed answer applies', async () => {
  const s = stub([constrainedSwap, fixedSwap]);
  const r = await runPipeline({ adapter: s.adapter, cfg: {}, kind: 'review', payload: withConstraints() });
  assert.equal(r.ok, true);
  assert.equal(r.result.changes.length, 1);
  assert.equal(s.calls.length, 2);
  const repair = s.calls[1].prompt;
  assert.match(repair, /"0002".*Waist work off/);
  assert.match(repair, /ruled out by the user's constraint/);
});

test('repeating the constrained exercise in the repair round still fails as unusable, never applies it', async () => {
  const s = stub([constrainedSwap, constrainedSwap]);
  const r = await runPipeline({ adapter: s.adapter, cfg: {}, kind: 'review', payload: withConstraints() });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, 'unusable');
  assert.equal(s.calls.length, 2);
});
