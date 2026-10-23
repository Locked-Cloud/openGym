// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))

import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

// Training constraints (lib/constraints.js) ride the same update()/persist()/stampChange path as
// everything else. These pin the contract the settings sheet, the routine editor's warning card
// and the start guard rely on: a fresh profile starts empty, the three actions write through the
// pure helpers, the result persists, and stampChange puts the per-entry `_ts`/`_f` on a changed
// constraint — the stamps mergeConstraints (lib/sync-merge.js) reads on another device.

describe('constraints state', () => {
  it('defaults to an empty items list, and declares the routineHistory key beside it', () => {
    expect(useStore.getState().S.constraints).toEqual({ items: [] })
    expect(useStore.getState().S.routineHistory).toEqual({})
  })

  it('adds a constraint with defaults filled in, and persists it', () => {
    useStore.getState().addConstraint({ label: 'Right shoulder', bodyParts: 'shoulders', muscles: ['delts'] })

    const items = useStore.getState().S.constraints.items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ label: 'Right shoulder', bodyParts: ['shoulders'], muscles: ['delts'], exerciseIds: [], status: 'active', source: 'self' })
    expect(items[0].id).toEqual(expect.any(String))

    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.constraints.items[0].label).toBe('Right shoulder')
  })

  it('updates one constraint and leaves the others untouched', () => {
    useStore.getState().addConstraint({ label: 'A' })
    useStore.getState().addConstraint({ label: 'B' })
    const id = useStore.getState().S.constraints.items[0].id

    useStore.getState().updateConstraint(id, { label: 'A renamed', note: 'pt said six weeks' })

    const items = useStore.getState().S.constraints.items
    expect(items.map(c => c.label)).toEqual(['A renamed', 'B'])
    expect(items[0].note).toBe('pt said six weeks')
  })

  it('resolves a constraint, keeping it on the list with the day it was resolved', () => {
    useStore.getState().addConstraint({ label: 'Left knee' })
    const id = useStore.getState().S.constraints.items[0].id

    useStore.getState().resolveConstraintAction(id)

    const c = useStore.getState().S.constraints.items[0]
    expect(useStore.getState().S.constraints.items).toHaveLength(1)
    expect(c.status).toBe('resolved')
    expect(c.resolvedOn).toEqual(expect.any(String))
  })
})

// The sync contract: a constraint changed here carries its own stamps, so a conflict keeps the
// field edited last (mergeConstraints → mergeEntry), the way a custom exercise's rename survives
// another device's edit of its sets.
describe('constraints stamps', () => {
  it('a new constraint gets a _ts; an edit stamps the field it changed in _f', () => {
    useStore.getState().addConstraint({ label: 'Tennis elbow' })
    let c = useStore.getState().S.constraints.items[0]
    expect(c._ts).toEqual(expect.any(Number))

    useStore.getState().updateConstraint(c.id, { label: 'Golfer’s elbow' })
    c = useStore.getState().S.constraints.items[0]
    expect(c._f).toMatchObject({ label: expect.any(Number) })
    expect(c._f.label).toBeGreaterThan(0)
  })

  it('an unrelated change stamps no constraint, and a resolution stamps the status field', () => {
    useStore.getState().addConstraint({ label: 'Wrist' })
    const id = useStore.getState().S.constraints.items[0].id
    const before = clone(useStore.getState().S.constraints.items[0])

    useStore.getState().update(s => { s.restSec = 75 }, false)
    expect(useStore.getState().S.constraints.items[0]).toEqual(before)   // untouched, unstamped

    useStore.getState().resolveConstraintAction(id)
    const after = useStore.getState().S.constraints.items[0]
    expect(after._f).toMatchObject({ status: expect.any(Number) })
    expect(after.status).toBe('resolved')
  })
})
