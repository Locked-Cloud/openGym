// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))

import { DEF, useStore } from './useStore.js'
import { ROUTINE_HISTORY_CAP, listVersions } from '../lib/routine-history.js'
import { deleteRoutine, routineSnapshot, restoreRoutine } from '../lib/routines.js'

const clone = value => JSON.parse(JSON.stringify(value))

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

// A routine's version history (lib/routine-history.js) rides the same update()/persist()/
// stampChange path as everything else. These pin the contract the editor's Version history sheet
// relies on: update() snapshots the state a material edit replaces (and nothing else — not a
// no-op, not a brand-new routine's first save), the store's restore action snapshots what it is
// about to leave and then writes through update() like any edit, the cap holds through the store
// path, and a routine's deletion takes its history with it while the Undo toast can still put
// both back (lib/routines.js routineSnapshot/restoreRoutine).

const pushup = { id: 'pushup', sets: 3, reps: 10 }
const dip = { id: 'dip', sets: 3, reps: 8 }
const routineOf = (id, name, ex) => (useStore.getState().S.routines || []).find(r => r.id === id) || { id, name, ex }
const versions = rid => useStore.getState().S.routineHistory?.[rid] || []

// A brand-new routine, the way the editor's flows add one: the first save has nothing to return
// to, so it stores no version — the material edits after it do.
const seed = () => {
  useStore.getState().update(s => { s.routines.push({ id: 'r1', name: 'Push', ex: [pushup] }) })
  return routineOf('r1', 'Push', [pushup])
}

describe('automatic snapshots', () => {
  it('a change elsewhere, and a save that only reorders keys, store no version', () => {
    seed()
    useStore.getState().update(s => { s.restSec = 75 })
    // Same content written back under different key order: canonically the same routine.
    useStore.getState().update(s => { const r = s.routines[0]; s.routines[0] = { ex: r.ex, name: r.name, id: r.id } })
    expect(versions('r1')).toHaveLength(0)
  })

  it('a material edit stores the state it replaced, and persists it', () => {
    seed()
    useStore.getState().update(s => { s.routines[0].ex.push(dip) })
    const vs = versions('r1')
    expect(vs).toHaveLength(1)
    expect(vs[0].label).toMatch(/^Before edit /)
    expect(vs[0].routine.ex).toEqual([pushup])   // what the edit replaced, not what it wrote
    expect(listVersions(useStore.getState().S.routineHistory, 'r1')).toHaveLength(1)
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.routineHistory.r1).toHaveLength(1)
  })

  it('the save that creates a routine stores nothing; an edit after that keeps what it replaced', () => {
    useStore.getState().update(s => { s.routines.push({ id: 'r2', name: 'Pull', ex: [pushup] }) })
    expect(versions('r2')).toHaveLength(0)       // nothing to return to before the first save
    useStore.getState().update(s => { s.routines[0].ex.push(dip) })
    expect(versions('r2')).toHaveLength(1)
    expect(versions('r2')[0].routine.ex).toEqual([pushup])
  })

  it('holds the cap through the store path', () => {
    seed()
    for (let i = 0; i < ROUTINE_HISTORY_CAP + 5; i++) {
      useStore.getState().update(s => { s.routines[0].ex.push({ id: 'e' + i, sets: 3, reps: 8 }) })
    }
    const vs = versions('r1')
    expect(vs).toHaveLength(ROUTINE_HISTORY_CAP)
    // Oldest dropped first: the newest version holds the state the last edit replaced.
    expect(vs[vs.length - 1].routine.ex).toHaveLength(1 + ROUTINE_HISTORY_CAP + 4)
  })
})

describe('snapshotRoutineVersion', () => {
  it('pins the current routine by hand, and no-ops while the latest version says the same', () => {
    seed()
    expect(useStore.getState().snapshotRoutineVersion('r1', 'Deload week')).toBe(true)
    expect(versions('r1')).toHaveLength(1)
    expect(versions('r1')[0].label).toBe('Deload week')
    expect(useStore.getState().snapshotRoutineVersion('r1')).toBe(false)
    expect(versions('r1')).toHaveLength(1)
    expect(useStore.getState().snapshotRoutineVersion('nope')).toBe(false)
  })
})

describe('restoreRoutineVersion', () => {
  it('snapshots what it leaves, then writes the version through the normal edit path', () => {
    seed()
    useStore.getState().update(s => { s.routines[0].name = 'Push day' })
    useStore.getState().update(s => { s.routines[0].ex.push(dip) })
    const oldest = versions('r1')[0]             // 'Push', one exercise
    const cur = routineOf('r1')
    expect(cur.ex).toHaveLength(2)

    expect(useStore.getState().restoreRoutineVersion('r1', oldest.id)).toBe(true)

    const after = routineOf('r1')
    expect(after.name).toBe('Push')
    expect(after.ex).toEqual([pushup])
    expect(after._ts).toBeGreaterThan(cur._ts)   // stamped as edited, so sync keeps the walk-back
    const vs = versions('r1')
    expect(vs).toHaveLength(3)
    expect(vs[2].label).toMatch(/^Before restore /)
    expect(vs[2].routine.ex).toHaveLength(2)     // the state the restore left
  })

  it('restoring what is already on screen writes nothing; a missing version fails', () => {
    seed()
    useStore.getState().update(s => { s.routines[0].ex.push(dip) })
    const oldest = versions('r1')[0]
    useStore.getState().restoreRoutineVersion('r1', oldest.id)
    expect(versions('r1')).toHaveLength(2)       // the edit's snapshot and the restore's
    expect(useStore.getState().restoreRoutineVersion('r1', oldest.id)).toBe(true)   // already on screen
    expect(versions('r1')).toHaveLength(2)       // nothing appended
    expect(useStore.getState().restoreRoutineVersion('r1', 'v_missing')).toBe(false)
    expect(useStore.getState().restoreRoutineVersion('nope', oldest.id)).toBe(false)
  })
})

describe('deletion wiring', () => {
  it('deleting a routine takes its history with it, and the Undo puts both back', () => {
    seed()
    useStore.getState().update(s => { s.routines[0].ex.push(dip) })
    expect(versions('r1')).toHaveLength(1)
    const snap = routineSnapshot(useStore.getState().S, 'r1')

    useStore.getState().update(s => { deleteRoutine(s, 'r1') })
    expect(useStore.getState().S.routines).toHaveLength(0)
    expect(versions('r1')).toHaveLength(0)

    // The toast's Undo path (views/Plan.jsx): routine and its history together.
    useStore.getState().update(s => { restoreRoutine(s, snap) })
    expect(routineOf('r1').ex).toHaveLength(2)
    expect(versions('r1')).toHaveLength(1)
  })
})
