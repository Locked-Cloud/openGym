// Version history for a routine's own definition — the plan, not the training under it. The
// workouts a routine produces already live in S.workouts; this keeps what the routine *was* at
// each save, so a bad edit, an unwanted exercise swap or a whole reorganization can be walked
// back to any earlier point instead of being retyped from memory.
//
// Storage shape, owned by the store and merged like any other part of S:
//   S.routineHistory = { [routineId]: [ { id, ts, label, routine }, … oldest first ] }
// The list is capped per routine (ROUTINE_HISTORY_CAP), so a routine edited every session for
// years cannot grow the state file without bound.
//
// Like everything in lib/ this module is pure: it takes a history object and returns plain data,
// never touches the store. Restoring is deliberately not automatic — the caller snapshots the
// state it is about to leave before overwriting it (see restoreVersion).

/** How many versions one routine keeps. Oldest are dropped first. */
export const ROUTINE_HISTORY_CAP = 20

// Routines are plain JSON data, so structuredClone is the honest copy; the JSON fallback covers
// the odd runtime where it is missing or refuses a value, which for this shape never happens.
const deepCopy = v => {
  try { return structuredClone(v) } catch { return JSON.parse(JSON.stringify(v ?? null)) }
}

/**
 * A deterministic form of a value: every object's keys sorted, arrays kept in order, and the
 * sync layer's bookkeeping dropped (keys starting with `_`, like `_ts`/`_f` — they say when a
 * device saved, not what the routine says). Two routines that differ only in the order their
 * keys were written in — a reload, a merge, another client — canonicalize to the same string,
 * so snapshotRoutine's dedupe never records a "change" that only the writer's key order made.
 */
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical)
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .filter(k => !k.startsWith('_'))
        .sort()
        .map(k => [k, canonical(v[k])])
    )
  }
  return v
}

/** Whether two routines differ in anything a version should remember. Key order and `_`-prefixed
 *  sync fields are not that; everything else — name, slots, sets, reps, weights, prog — is. */
export function routineChanged(a, b) {
  return JSON.stringify(canonical(a ?? null)) !== JSON.stringify(canonical(b ?? null))
}

// The stored versions of one routine, oldest first. A history that is missing, null or malformed
// (anything but an array under the key) reads as none, so no caller has to guard first.
const versionsOf = (history, routineId) => {
  const versions = history?.[routineId]
  return Array.isArray(versions) ? versions : []
}

/**
 * Append a version of `routine` to its history and return the new history object. `label` is
 * the caller's one-liner for what the save did ("Added dip", "Deload week"); `now` (ms since
 * epoch) is injectable so tests can pin it.
 *
 * A save that leaves the routine canonically identical to the latest stored version is a no-op:
 * `history` comes back by the same reference, so the caller can tell "nothing was recorded" from
 * `next === history`, and the list never fills with copies of one state. Going A → B → A still
 * keeps all three — only a repeat of the *latest* state is skipped.
 */
export function snapshotRoutine(history, routineId, routine, label, now = Date.now()) {
  const versions = versionsOf(history, routineId)
  const latest = versions[versions.length - 1]
  if (latest && !routineChanged(latest.routine, routine)) return history
  const version = {
    id: 'v_' + now + '_' + Math.random().toString(36).slice(2, 7),
    ts: now,
    label,
    routine: deepCopy(routine)
  }
  // Oldest first, and only the newest CAP of them: slice(-CAP) drops the far end.
  return { ...(history || {}), [routineId]: [...versions, version].slice(-ROUTINE_HISTORY_CAP) }
}

// What a version row shows: how big the routine it froze was. Derived from the stored routine at
// read time, so it is always true of the data and never had to be written when the snapshot was
// taken. A malformed entry (no routine, a non-array ex) is a count of 0, not a crash — an old or
// hand-merged history can hold anything.
const summaryOf = routine => {
  const n = Array.isArray(routine?.ex) ? routine.ex.length : 0
  return `${n} ${n === 1 ? 'exercise' : 'exercises'}`
}

/** The versions of one routine, newest first, as `{ id, ts, label, summary }` rows for a
 *  history list. The stored order is untouched (a copy is reversed, not the array itself). */
export function listVersions(history, routineId) {
  return versionsOf(history, routineId)
    .slice()
    .reverse()
    .map(v => ({ id: v?.id, ts: v?.ts, label: v?.label, summary: summaryOf(v?.routine) }))
}

/** One stored version by id, or null when it is not there. */
export function getVersion(history, routineId, versionId) {
  return versionsOf(history, routineId).find(v => v?.id === versionId) || null
}

/**
 * The routine as a version froze it, plus the history unchanged. Restoring does NOT snapshot the
 * state being left — that is the caller's call to make (and usually the right one, or what is
 * being replaced has no copy to come back to). The returned routine is a deep copy, so editing
 * it in the editor can never reach into the stored version it came from.
 */
export function restoreVersion(history, routineId, versionId) {
  const version = getVersion(history, routineId, versionId)
  return version ? { routine: deepCopy(version.routine), history } : null
}

/** A history without one routine's versions — for when the routine itself is permanently deleted
 *  and its past has nothing left to restore into. Other routines' histories are kept. */
export function deleteRoutineHistory(history, routineId) {
  const out = { ...(history || {}) }
  delete out[routineId]
  return out
}
