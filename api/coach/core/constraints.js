/* The server-side twin of the constraint check in frontend/src/lib/constraints.js.
 *
 * Hand-copied, not imported — the same trade-off api/queue.js and payload.js's reading rules
 * already made: api/ and frontend/src/lib are separate packages with no build step in common,
 * and this file has to load under bare node. Only the matching is copied, not the store-side
 * lifecycle helpers: the Coach's gate needs the verdict, and `cleanConstraints` below needs the
 * shape that reaches the payload. frontend/src/lib/constraints.js carries a matching note about
 * this copy; api/test/constraints-parity.test.js pins the two engines together over the same
 * metadata so they cannot drift silently.
 *
 * SHARED SPEC (both copies must hold, and the parity test asserts):
 *   · an id the constraint lists outright is 'blocked', whether or not it resolves — someone
 *     named that exact lift, and a deleted custom exercise does not unname it;
 *   · an overlap on the exercise's body part (bp) or a primary muscle (tg, mg, the muscle-map
 *     overlay's primaries) is 'flagged';
 *   · an overlap on a secondary muscle (sm, the overlay's secondaries) only is 'uncertain' —
 *     the validator lets those through, exactly as the client's apply gate does;
 *   · comparison is case-insensitive on trim, and the exercise's own spelling is what matches;
 *   · the most severe level wins, and among equals the earliest constraint in the list;
 *   · resolved constraints never match. An item with no status field at all does match here:
 *     the payload's cleaned category is active-only, so status was settled before arrival.
 *
 * This module reports overlap, never safety — same rule as the frontend's. Whether an exercise
 * is medically wise for a named injury is nobody's here to say.
 */
import { LIB_BY_ID } from './library.js';

const listOf = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const norm = v => String(v ?? '').trim().toLowerCase();
const hitsOf = (values, wanted) => {
  const set = new Set((wanted || []).map(norm).filter(Boolean));
  return [...new Set(values.filter(v => set.has(norm(v))))];
};

// Resolve an id for the api's own lookups: LIB_BY_ID is a Map, the parity test hands in the
// frontend's plain-object EXIDX, and a bare entry names itself. Everything else reads as null.
export function exerciseFor(exId, lookup) {
  if (typeof lookup === 'function') return lookup(exId) || null;
  if (!lookup || typeof lookup !== 'object') return null;
  if (typeof lookup.get === 'function') return lookup.get(exId) || null;
  if (typeof lookup.id === 'string' && (lookup.n != null || lookup.bp != null || lookup.tg != null)) return lookup;
  return lookup[exId] || null;
}

const primaryOf = ex => [ex?.tg, ex?.mg, ...listOf(ex?.primaries)].filter(Boolean);
const secondaryOf = ex => [...listOf(ex?.sm), ...listOf(ex?.secondaries)].filter(Boolean);

function matchOf(exId, ex, c) {
  const matchedOn = {};
  if (listOf(c.exerciseIds).some(x => String(x) === String(exId))) matchedOn.exerciseId = true;
  if (ex) {
    const bodyPart = hitsOf([ex.bp], c.bodyParts);
    if (bodyPart.length) matchedOn.bodyPart = bodyPart;
    const primaryMuscle = hitsOf(primaryOf(ex), c.muscles);
    if (primaryMuscle.length) matchedOn.primaryMuscle = primaryMuscle;
    const secondaryMuscle = hitsOf(secondaryOf(ex), c.muscles);
    if (secondaryMuscle.length) matchedOn.secondaryMuscle = secondaryMuscle;
  }
  const level = matchedOn.exerciseId ? 'blocked'
    : matchedOn.bodyPart || matchedOn.primaryMuscle ? 'flagged'
      : matchedOn.secondaryMuscle ? 'uncertain'
        : null;
  if (!level) return null;
  return { level, constraintLabel: c.label, matchedOn, source: c.source };
}

const SEVERITY = { uncertain: 1, flagged: 2, blocked: 3 };
const isActive = c => !!c && c.status !== 'resolved';

/** The verdict for one exercise against the active constraints, or null when they all pass.
 *  Mirror of conflictFor in frontend/src/lib/constraints.js — see the shared spec above. */
export function conflictFor(exId, items, lookup = LIB_BY_ID) {
  let worst = null;
  for (const c of (items || []).filter(isActive)) {
    const v = matchOf(exId, exerciseFor(exId, lookup), c);
    if (v && (!worst || SEVERITY[v.level] > SEVERITY[worst.level])) worst = v;
  }
  return worst;
}

/* ---------- the payload's bounded copy ---------- */

// What the payload may carry, and no more. The label is there so the validator's repair message
// can name the constraint back; bodyParts/muscles/exerciseIds are the matching dimensions;
// source says whether a professional wrote it. Everything else the store keeps — the note, the
// dates, requiresReview — stays out on purpose: minimal necessary. A constraint note is free
// text about someone's injury, and the check needs the overlap, not the story.
export const MAX_CONSTRAINTS = 20;
const MAX_DIM = 12;    // body parts / muscles a payload constraint may name
const MAX_IDS = 24;    // exercise ids a payload constraint may name
const LABEL_MAX = 80;  // payload.js NAME_MAX: names are typed by a person, cut like every other
const WORD_MAX = 40;   // payload.js PROFILE_WORD_MAX: room for any muscle spelling, no paragraph
const ID_MAX = 64;     // payload.js ID_MAX: any id an import ever wrote, never a paragraph

const dim = (v, n) => listOf(v).filter(x => typeof x === 'string' && x).slice(0, n).map(x => x.slice(0, WORD_MAX));
const ids = v => listOf(v).filter(x => typeof x === 'string' && x).slice(0, MAX_IDS).map(x => x.slice(0, ID_MAX));

/** The active constraints reduced to the five fields a payload carries, in store order.
 *  The state is the client's, so every field is bounded here like every other payload field. */
export function cleanConstraints(items) {
  return listOf(items)
    .filter(c => c && typeof c === 'object' && c.status !== 'resolved')
    .slice(0, MAX_CONSTRAINTS)
    .map(c => ({
      label: typeof c.label === 'string' ? c.label.slice(0, LABEL_MAX) : '',
      bodyParts: dim(c.bodyParts, MAX_DIM),
      muscles: dim(c.muscles, MAX_DIM),
      exerciseIds: ids(c.exerciseIds),
      source: c.source === 'professional' ? 'professional' : 'self'
    }))
    .filter(c => c.label || c.bodyParts.length || c.muscles.length || c.exerciseIds.length);
}
