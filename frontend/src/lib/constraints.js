// Injury-aware training constraints.
//
// Everything here is pure metadata overlap: a constraint names body parts, muscles and
// exercise ids in the same vocabulary the exercise catalogue uses, and this module reports
// where the two agree. That is all it reports. It never claims an exercise is medically
// safe, never diagnoses an injury and never prescribes rehab — "flagged" means "these two
// things name the same tissue", and the wording that a person decides belongs to the UI
// layer. Where the metadata cannot decide (only a secondary muscle overlaps, or the
// exercise cannot be resolved at all), the honest answer is "uncertain", which the app
// renders as professional review — never as a green light. There are no medical rules here
// beyond the overlap itself, on purpose.
//
// Severity is deliberately coarse, and ordered:
//   blocked   the constraint lists this exercise id outright — someone named this exact lift
//   flagged   the exercise's body part or primary muscle (tg/mg) is on the constraint
//   uncertain only a secondary muscle (sm) overlaps — may be nothing, a professional says
//
// Constraints live in the store as S.constraints = { items: [...] }; every function below
// takes the items array as a parameter and returns new data, so nothing here touches the
// store or mutates its arguments.

// --- item lifecycle -----------------------------------------------------------------------------

export function emptyConstraints() {
  return { items: [] }
}

// A fresh id for a constraint that arrived without one. A test, an import or a sync may
// supply its own id; it is kept exactly as given.
const newId = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

const listOf = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v])

// Stored with defaults filled in, so a reader never has to guard every field. Arrays are
// copied: the caller's objects stay untouched.
export function addConstraint(items, constraint) {
  const c = constraint || {}
  const item = {
    id: c.id != null && c.id !== '' ? String(c.id) : newId(),
    label: c.label ?? '',
    bodyParts: listOf(c.bodyParts),
    muscles: listOf(c.muscles),
    exerciseIds: listOf(c.exerciseIds),
    status: c.status ?? 'active',
    source: c.source ?? 'self',
    startedOn: c.startedOn ?? null,
    resolvedOn: c.resolvedOn ?? null,
    requiresReview: c.requiresReview === true,
    note: c.note ?? ''
  }
  return [...(items || []), item]
}

export function updateConstraint(items, id, patch) {
  return (items || []).map(c => (c && c.id === id ? { ...c, ...(patch || {}) } : c))
}

export function resolveConstraint(items, id, resolvedOn = null) {
  return (items || []).map(c => (c && c.id === id ? { ...c, status: 'resolved', resolvedOn } : c))
}

export const activeConstraints = items => (items || []).filter(c => c && c.status === 'active')

// Badge counts. `professional` counts every constraint a qualified professional supplied,
// resolved ones included — a history of professional involvement is worth a badge too.
export function constraintSummary(items) {
  const list = items || []
  return {
    total: list.length,
    active: list.filter(c => c && c.status === 'active').length,
    resolved: list.filter(c => c && c.status === 'resolved').length,
    professional: list.filter(c => c && c.source === 'professional').length
  }
}

// --- exercise resolution ------------------------------------------------------------------------

// Resolve an exercise id against `lookup`, which may be any of:
//   · a function  id => entry       — the caller's own accessor
//   · a plain id→entry object map   — EXIDX itself, or a stub map in tests
//   · one exercise entry passed directly — an EXIDX[id] object, which carries its own id
// An id that resolves to nothing gives null, never a crash: a custom exercise deleted on
// another device still has to render (exOr's pattern in exercises.js), and an explicit-id
// block against it still has to show.
function exerciseFor(exId, lookup) {
  if (typeof lookup === 'function') return lookup(exId) || null
  if (!lookup || typeof lookup !== 'object') return null
  if (typeof lookup.id === 'string' && (lookup.n != null || lookup.bp != null || lookup.tg != null)) return lookup
  return lookup[exId] || null
}

// --- matching -----------------------------------------------------------------------------------

const norm = v => String(v ?? '').trim().toLowerCase()

// An exercise's muscles as the catalogue states them. The raw dataset speaks in aliases
// (tg "quads", mg "glutes", sm "lower back"); where the muscle map has redrawn a lift more
// precisely (exercises.js), the entry additionally carries canonical primaries/secondaries
// ("quadriceps", "lower-back"). Both vocabularies are compared as-is: a constraint stores
// whichever spelling its picker offered, and this module's job is overlap, not translation.
const primaryOf = ex => [ex?.tg, ex?.mg, ...listOf(ex?.primaries)].filter(Boolean)
const secondaryOf = ex => [...listOf(ex?.sm), ...listOf(ex?.secondaries)].filter(Boolean)

// Which of the exercise's own spellings the constraint also names, in the exercise's order.
const hitsOf = (values, wanted) => {
  const set = new Set((wanted || []).map(norm).filter(Boolean))
  return [...new Set(values.filter(v => set.has(norm(v))))]
}

// One constraint against one exercise: the matched dimensions and the level they add up to,
// or null when nothing overlaps. Matching is case-insensitive on trim — the catalogue is
// lowercase but a professional's note, or a translation, may not be.
function matchOf(exId, ex, c) {
  const matchedOn = {}
  if (listOf(c.exerciseIds).some(x => String(x) === String(exId))) matchedOn.exerciseId = true
  if (ex) {
    const bodyPart = hitsOf([ex.bp], c.bodyParts)
    if (bodyPart.length) matchedOn.bodyPart = bodyPart
    const primaryMuscle = hitsOf(primaryOf(ex), c.muscles)
    if (primaryMuscle.length) matchedOn.primaryMuscle = primaryMuscle
    const secondaryMuscle = hitsOf(secondaryOf(ex), c.muscles)
    if (secondaryMuscle.length) matchedOn.secondaryMuscle = secondaryMuscle
  }
  const level = matchedOn.exerciseId ? 'blocked'
    : matchedOn.bodyPart || matchedOn.primaryMuscle ? 'flagged'
      : matchedOn.secondaryMuscle ? 'uncertain'
        : null
  if (!level) return null
  return { level, constraintId: c.id, constraintLabel: c.label, matchedOn, source: c.source }
}

const SEVERITY = { uncertain: 1, flagged: 2, blocked: 3 }

// The verdict for one exercise against the active constraints, or null when they all pass.
// When several match, the most severe level wins; among equals the first constraint in the
// list does, so a verdict always names the oldest constraint that reached that level, never
// an arbitrary later duplicate.
export function conflictFor(exId, items, lookup) {
  let worst = null
  for (const c of activeConstraints(items)) {
    const v = matchOf(exId, exerciseFor(exId, lookup), c)
    if (v && (!worst || SEVERITY[v.level] > SEVERITY[worst.level])) worst = v
  }
  return worst
}

// --- routines and substitutes -------------------------------------------------------------------

// One verdict per routine slot, in slot order (routine.ex — the shape routines.js and
// history.js already use: { id, ex: [{ id, sets, ... }] }). A slot whose exercise no longer
// resolves keeps its exId with a null name and a null verdict: the routine still renders,
// and the deletion is visible instead of taking the view down.
export function validateRoutine(routine, items, lookup) {
  return ((routine && routine.ex) || []).map((slot, i) => {
    const exId = slot && slot.id != null ? slot.id : null
    const ex = exId == null ? null : exerciseFor(exId, lookup)
    return {
      slotIndex: i,
      exId,
      exName: ex?.n ?? null,
      verdict: exId == null ? null : conflictFor(exId, items, lookup)
    }
  })
}

// Substitutes for one exercise: the exercises that share its target muscle (tg) or muscle
// group (mg), ranked same-tg first, then same-mg, with the same body part ordering ties.
// Candidate metadata is read from `allExercises` itself, so a caller examining several
// exercises does not have to hand over a second resolver. A candidate the active
// constraints block or flag is left out entirely; one that only scores "uncertain" is kept
// and carries its verdict, because the UI must be able to attach the review wording to it.
// sharedMuscles is metadata overlap, not a promise of an equivalent training effect, and an
// entry on this list is never a statement that the substitute is safe.
export function suggestSubstitutes(exId, items, lookup, allExercises) {
  const byId = {}
  for (const e of allExercises || []) if (e && e.id != null) byId[String(e.id)] = e
  const orig = exerciseFor(exId, lookup) || byId[String(exId)] || null
  if (!orig) return []
  const origMuscles = new Set([...primaryOf(orig), ...secondaryOf(orig)].map(norm).filter(Boolean))
  const seen = new Set([String(exId)])
  const out = []
  for (const e of allExercises || []) {
    if (!e || e.id == null) continue
    const key = String(e.id)
    if (seen.has(key)) continue
    seen.add(key)
    const sameTg = !!orig.tg && norm(e.tg) === norm(orig.tg)
    const sameMg = !!orig.mg && norm(e.mg) === norm(orig.mg)
    if (!sameTg && !sameMg) continue
    const verdict = conflictFor(key, items, byId)
    if (verdict && verdict.level !== 'uncertain') continue
    out.push({
      exId: key,
      name: e.n ?? null,
      verdict,
      sharedMuscles: [...new Set([...primaryOf(e), ...secondaryOf(e)].filter(v => origMuscles.has(norm(v))))],
      sameTg,
      sameBp: !!orig.bp && norm(e.bp) === norm(orig.bp)
    })
  }
  return out
    .sort((a, b) => (b.sameTg - a.sameTg) || (b.sameBp - a.sameBp))   // stable: list order holds the ties
    .slice(0, 8)
    .map(({ sameTg, sameBp, ...rest }) => rest)
}
