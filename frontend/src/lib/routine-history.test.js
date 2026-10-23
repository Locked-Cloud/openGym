import { describe, it, expect } from 'vitest'
import {
  ROUTINE_HISTORY_CAP, snapshotRoutine, routineChanged, listVersions, getVersion,
  restoreVersion, deleteRoutineHistory
} from './routine-history.js'

// Routines shaped exactly as the app stores them (starter.js / Plan.jsx): id, name, a glyph
// emoji, an optional routine-wide progression default, and ex slots whose fields are the
// exercise config of history.js's defaultConfig plus what the editor writes into them
// (repsMin ranges, restSec, notes, superset ids). Exercise ids are real catalogue ones.
const pushDay = (over = {}) => ({
  id: 'push',
  name: 'Push Day',
  emoji: 'barbell',
  prog: 'linear',
  ex: [
    { id: '0025', sets: 4, reps: 8, weight: 60, mode: 'reps' },
    { id: '0047', sets: 3, reps: 10, weight: 40, mode: 'reps' },
    { id: '0426', sets: 3, reps: 10, weight: 0, mode: 'reps', bodyweight: true },
    { id: '0251', sets: 3, sec: 45, weight: 0, mode: 'time' },
    { id: '0334', sets: 3, reps: 12, repsMin: 10, weight: 30, mode: 'reps', restSec: 90 },
  ],
  ...over
})

const pullDay = (over = {}) => ({
  id: 'pull',
  name: 'Pull Day',
  emoji: 'pullup',
  ex: [
    { id: '2330', sets: 4, reps: 10, weight: 0, mode: 'reps', bodyweight: true },
    { id: '0027', sets: 4, reps: 8, weight: 50, mode: 'reps' },
    { id: '1323', sets: 3, reps: 10, weight: 25, mode: 'reps', sg: 'sg-1-2' },
    { id: '0031', sets: 3, reps: 10, weight: 20, mode: 'reps', sg: 'sg-1-2', note: 'slow eccentric' },
  ],
  ...over
})

describe('snapshotRoutine', () => {
  it('appends a version with the label, the timestamp and a frozen copy of the routine', () => {
    const r = pushDay()
    const h = snapshotRoutine(null, 'push', r, 'Created', 1000)
    expect(h.push).toHaveLength(1)
    const v = h.push[0]
    expect(v.id).toMatch(/^v_1000_[a-z0-9]+$/)
    expect(v.ts).toBe(1000)
    expect(v.label).toBe('Created')
    expect(v.routine).toEqual(r)
    // Frozen: editing the caller's routine afterwards cannot reach the stored copy.
    r.name = 'Renamed'
    r.ex[0].weight = 100
    expect(h.push[0].routine.name).toBe('Push Day')
    expect(h.push[0].routine.ex[0].weight).toBe(60)
  })

  it('gives two snapshots in the same millisecond distinct ids', () => {
    let h = snapshotRoutine(null, 'push', pushDay(), 'A', 1000)
    h = snapshotRoutine(h, 'push', pushDay({ name: 'B' }), 'B', 1000)
    const [a, b] = h.push
    expect(a.id).not.toBe(b.id)
  })

  it('keeps other routines\' histories beside the one it appends to', () => {
    let h = snapshotRoutine(null, 'push', pushDay(), 'Push', 1000)
    h = snapshotRoutine(h, 'pull', pullDay(), 'Pull', 2000)
    expect(Object.keys(h).sort()).toEqual(['pull', 'push'])
    expect(h.push).toHaveLength(1)
    expect(h.pull).toHaveLength(1)
  })

  it('skips a save that leaves the routine identical to the latest version', () => {
    let h = snapshotRoutine(null, 'push', pushDay(), 'Created', 1000)
    const again = snapshotRoutine(h, 'push', structuredClone(pushDay()), 'Saved again', 2000)
    expect(again).toBe(h)                       // nothing recorded, same reference
    expect(again.push).toHaveLength(1)
    expect(again.push[0].ts).toBe(1000)
  })

  it('still snapshots a return to an earlier state: A → B → A is three versions', () => {
    let h = snapshotRoutine(null, 'push', pushDay(), 'A', 1000)
    h = snapshotRoutine(h, 'push', pushDay({ name: 'Push Day, heavier' }), 'B', 2000)
    h = snapshotRoutine(h, 'push', pushDay(), 'back to A', 3000)
    const rows = listVersions(h, 'push')
    expect(rows).toHaveLength(3)
    expect(rows.map(v => v.label)).toEqual(['back to A', 'B', 'A'])
  })

  it('keeps only the newest ROUTINE_HISTORY_CAP versions, dropping the oldest', () => {
    expect(ROUTINE_HISTORY_CAP).toBe(20)
    let h = null
    for (let i = 0; i < 25; i++) h = snapshotRoutine(h, 'push', pushDay({ name: 'v' + i }), 'edit ' + i, 1000 + i)
    const rows = listVersions(h, 'push')
    expect(rows).toHaveLength(20)
    expect(rows[0].label).toBe('edit 24')       // newest kept
    expect(rows.at(-1).label).toBe('edit 5')    // the five oldest are gone
    expect(rows.map(v => v.label)).not.toContain('edit 4')
  })
})

describe('routineChanged', () => {
  it('ignores the order keys were written in', () => {
    const a = { id: 'push', name: 'Push Day', prog: 'linear', ex: [{ id: '0025', sets: 4, reps: 8, weight: 60 }] }
    const b = { ex: [{ weight: 60, reps: 8, sets: 4, id: '0025' }], prog: 'linear', name: 'Push Day', id: 'push' }
    expect(routineChanged(a, b)).toBe(false)
  })

  it('ignores sync bookkeeping fields (leading underscore) at any depth', () => {
    const b = { ...structuredClone(pushDay()), _ts: 99, _f: { rev: 3 } }
    b.ex[0]._ts = 5
    b.ex[1]._wid = 'other-device'
    expect(routineChanged(pushDay(), b)).toBe(false)
    // and a routine against an identical copy of itself
    expect(routineChanged(pushDay(), structuredClone(pushDay()))).toBe(false)
  })

  it('sees a real change anywhere in the routine', () => {
    expect(routineChanged(pushDay(), pushDay({ name: 'Other' }))).toBe(true)
    const heavier = structuredClone(pushDay())
    heavier.ex[0].weight = 62.5
    expect(routineChanged(pushDay(), heavier)).toBe(true)
    const cut = structuredClone(pushDay())
    cut.ex.pop()
    expect(routineChanged(pushDay(), cut)).toBe(true)
    const retimed = structuredClone(pushDay())
    retimed.ex[3].sec = 60
    expect(routineChanged(pushDay(), retimed)).toBe(true)
    expect(routineChanged(pushDay(), null)).toBe(true)
  })
})

describe('listVersions', () => {
  it('lists newest first with the label and an exercise-count summary', () => {
    let h = snapshotRoutine(null, 'push', pushDay(), 'Created', 1000)
    const cut = structuredClone(pushDay())
    cut.ex.pop()
    h = snapshotRoutine(h, 'push', cut, 'Cut the plank', 2000)
    const rows = listVersions(h, 'push')
    expect(rows.map(r => r.ts)).toEqual([2000, 1000])
    expect(rows[0]).toEqual({ id: expect.any(String), ts: 2000, label: 'Cut the plank', summary: '4 exercises' })
    expect(rows[1].summary).toBe('5 exercises')
  })

  it('says "1 exercise" for a single-slot routine', () => {
    const single = { id: 'x', name: 'Only squats', emoji: 'legs', ex: [{ id: '0043', sets: 5, reps: 5, weight: 80, mode: 'reps' }] }
    const h = snapshotRoutine(null, 'x', single, 'Created', 1)
    expect(listVersions(h, 'x')[0].summary).toBe('1 exercise')
  })

  it('reads a malformed stored version as a zero count instead of crashing', () => {
    const h = { push: [null, { id: 'v9', ts: 9, label: 'L', routine: {} }] }
    expect(listVersions(h, 'push')).toEqual([
      { id: 'v9', ts: 9, label: 'L', summary: '0 exercises' },
      { id: undefined, ts: undefined, label: undefined, summary: '0 exercises' },
    ])
  })

  it('does not disturb the stored order of the list it read', () => {
    let h = snapshotRoutine(null, 'push', pushDay(), 'A', 1000)
    h = snapshotRoutine(h, 'push', pushDay({ name: 'B' }), 'B', 2000)
    listVersions(h, 'push')
    expect(h.push.map(v => v.label)).toEqual(['A', 'B'])   // still oldest first in storage
  })
})

describe('getVersion', () => {
  it('finds a stored version by id, and reports a miss as null', () => {
    let h = snapshotRoutine(null, 'push', pushDay(), 'Created', 1000)
    h = snapshotRoutine(h, 'push', pushDay({ name: 'B' }), 'Renamed', 2000)
    const id = h.push[0].id
    expect(getVersion(h, 'push', id)).toBe(h.push[0])
    expect(getVersion(h, 'push', 'v_nope')).toBeNull()
    expect(getVersion(null, 'push', 'v_nope')).toBeNull()
  })
})

describe('restoreVersion', () => {
  it('returns the frozen routine and the history unchanged, without snapshotting anything', () => {
    let h = snapshotRoutine(null, 'push', pushDay(), 'Created', 1000)
    h = snapshotRoutine(h, 'push', pushDay({ name: 'Renamed' }), 'Renamed', 2000)
    const oldest = listVersions(h, 'push').at(-1).id
    const out = restoreVersion(h, 'push', oldest)
    expect(out.history).toBe(h)                  // restoring itself records nothing
    expect(out.routine.name).toBe('Push Day')
    expect(out.routine.ex).toHaveLength(5)
  })

  it('hands back a copy the editor cannot leak edits through', () => {
    let h = snapshotRoutine(null, 'push', pushDay(), 'Created', 1000)
    const id = h.push[0].id
    const out = restoreVersion(h, 'push', id)
    out.routine.name = 'Edited'
    out.routine.ex[0].weight = 999
    out.routine.ex.push({ id: '0000', sets: 1, reps: 1 })
    expect(h.push[0].routine.name).toBe('Push Day')
    expect(h.push[0].routine.ex[0].weight).toBe(60)
    expect(h.push[0].routine.ex).toHaveLength(5)
  })

  it('returns null for a version that is not there', () => {
    const h = snapshotRoutine(null, 'push', pushDay(), 'Created', 1000)
    expect(restoreVersion(h, 'push', 'v_nope')).toBeNull()
    expect(restoreVersion(null, 'push', 'v1')).toBeNull()
  })
})

describe('deleteRoutineHistory', () => {
  it('drops one routine\'s versions and leaves every other routine\'s', () => {
    let h = snapshotRoutine(null, 'push', pushDay(), 'Push', 1000)
    h = snapshotRoutine(h, 'pull', pullDay(), 'Pull', 2000)
    const out = deleteRoutineHistory(h, 'push')
    expect(out).toEqual({ pull: h.pull })
    expect(out.pull).toBe(h.pull)
  })

  it('treats a missing history as an empty one', () => {
    expect(deleteRoutineHistory(null, 'push')).toEqual({})
    expect(deleteRoutineHistory(undefined, 'push')).toEqual({})
  })
})

describe('a missing or malformed history is treated as empty everywhere', () => {
  it('reads as no versions', () => {
    for (const h of [null, undefined]) {
      expect(listVersions(h, 'push')).toEqual([])
      expect(getVersion(h, 'push', 'v1')).toBeNull()
      expect(restoreVersion(h, 'push', 'v1')).toBeNull()
    }
    // a stored non-array under the routine's key is no versions either, not a crash
    expect(listVersions({ push: 'broken' }, 'push')).toEqual([])
    expect(getVersion({ push: 7 }, 'push', 'v1')).toBeNull()
  })

  it('lets the first snapshot create the history', () => {
    const h = snapshotRoutine(undefined, 'push', pushDay(), 'First', 5)
    expect(h.push).toHaveLength(1)
    expect(h.push[0].routine).toEqual(pushDay())
  })
})
