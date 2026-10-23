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

// The powerlifting module (lib/powerlifting.js) rides the same update()/persist()/stampChange
// path as everything else. These pin the contract the Stats card and PowerliftingSheet rely on:
// the default shape, the four actions writing through, the 50-meet cap keeping the newest, and
// stampChange putting the per-field `_f` on the maxes/rules objects and the `_ts`/`_f` on a
// changed meet — the stamps mergePowerlifting (lib/sync-merge.js) reads on another device.

const day = n => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10)
const meet = (date, lifts = {}, id) => ({ ...(id != null ? { id } : {}), date, lifts: { squat: [], bench: [], deadlift: [], ...lifts } })

describe('powerlifting state', () => {
  it('defaults to empty maxes, null rules and no meets', () => {
    expect(useStore.getState().S.powerlifting).toEqual({
      trainingMaxes: { squat: null, bench: null, deadlift: null },
      rules: null,
      meets: [],
    })
  })

  it('sets the training maxes and persists them', () => {
    useStore.getState().setPowerliftingMaxes({ squat: 140, bench: 100, deadlift: 180 })
    expect(useStore.getState().S.powerlifting.trainingMaxes).toMatchObject({ squat: 140, bench: 100, deadlift: 180 })
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.powerlifting.trainingMaxes.squat).toBe(140)
  })

  it('stores rules, and null again for anything that is not a rules object', () => {
    const rules = { incrementKg: 5, openerPct: { min: 0.88, max: 0.92 }, secondPct: { min: 0.95, max: 1 }, thirdPct: { min: 1, max: 1.05 }, maxAttemptsPerLift: 3 }
    useStore.getState().setPowerliftingRules(rules)
    expect(useStore.getState().S.powerlifting.rules).toEqual(rules)
    useStore.getState().setPowerliftingRules('junk')
    expect(useStore.getState().S.powerlifting.rules).toBeNull()
  })

  it('saves meets newest-first, replaces by id, and gives a new meet one', () => {
    useStore.getState().saveMeet(meet(day(2)))
    useStore.getState().saveMeet(meet(day(0)))
    const first = useStore.getState().S.powerlifting.meets
    expect(first.map(m => m.date)).toEqual([day(2), day(0)])
    expect(first.every(m => typeof m.id === 'string' && m.id)).toBe(true)

    useStore.getState().saveMeet({ ...first[1], date: day(5) })
    const after = useStore.getState().S.powerlifting.meets
    expect(after).toHaveLength(2)                       // replaced, not appended
    expect(after.map(m => m.date)).toEqual([day(5), day(2)])
  })

  it('caps the meets at 50, keeping the newest', () => {
    for (let i = 0; i < 53; i++) useStore.getState().saveMeet(meet(day(i)))
    const meets = useStore.getState().S.powerlifting.meets
    expect(meets).toHaveLength(50)
    expect(meets[0].date).toBe(day(52))                 // newest first
    expect(meets.at(-1).date).toBe(day(3))              // day 0–2 fell off
  })

  it('deletes one meet and leaves the others', () => {
    useStore.getState().saveMeet(meet(day(1)))
    useStore.getState().saveMeet(meet(day(2)))
    const id = useStore.getState().S.powerlifting.meets[0].id
    useStore.getState().deleteMeet(id)
    const after = useStore.getState().S.powerlifting.meets
    expect(after).toHaveLength(1)
    expect(after[0].id).not.toBe(id)
    useStore.getState().deleteMeet('no-such-id')
    expect(useStore.getState().S.powerlifting.meets).toHaveLength(1)
  })
})

// The sync contract: maxes/rules carry per-field stamps and meets their own `_ts`/`_f`, so a
// conflict keeps the field edited last (mergePowerlifting → mergeEntry), the way a constraint's
// resolve survives a note edited on the other device.
describe('powerlifting stamps', () => {
  it('editing one max stamps that field in _f and leaves the others on their older stamps', () => {
    useStore.getState().setPowerliftingMaxes({ squat: 140, bench: 100, deadlift: 180 })
    let tm = useStore.getState().S.powerlifting.trainingMaxes
    expect(tm._ts).toEqual(expect.any(Number))
    expect(tm._f).toMatchObject({ squat: tm._ts, bench: tm._ts, deadlift: tm._ts })

    useStore.getState().setPowerliftingMaxes({ squat: 145, bench: 100, deadlift: 180 })
    tm = useStore.getState().S.powerlifting.trainingMaxes
    expect(tm._f.squat).toBeGreaterThan(tm._f.bench)
    expect(tm._f.bench).toBe(tm._f.deadlift)
  })

  it('an unrelated change stamps nothing in the module, and rules take _f on edit', () => {
    useStore.getState().setPowerliftingRules({ incrementKg: 5 })
    let rules = useStore.getState().S.powerlifting.rules
    expect(rules._ts).toEqual(expect.any(Number))
    expect(rules._f).toBeUndefined()                    // a new object stamps no field

    const before = clone(useStore.getState().S.powerlifting)
    useStore.getState().update(s => { s.restSec = 75 }, false)
    expect(useStore.getState().S.powerlifting.trainingMaxes).toEqual(before.trainingMaxes)
    expect(useStore.getState().S.powerlifting.rules).toEqual(before.rules)

    useStore.getState().setPowerliftingRules({ incrementKg: 5, openerPct: { min: 0.9, max: 0.93 } })
    rules = useStore.getState().S.powerlifting.rules
    expect(rules._f).toMatchObject({ openerPct: expect.any(Number) })
  })

  it('a saved meet carries _ts, and editing its attempts stamps the lifts field', () => {
    useStore.getState().saveMeet(meet(day(1), { squat: [{ weightKg: 140, result: 'good' }] }))
    let m = useStore.getState().S.powerlifting.meets[0]
    expect(m._ts).toEqual(expect.any(Number))
    expect(m._f).toBeUndefined()                        // a new meet stamps no field

    useStore.getState().saveMeet({ ...m, lifts: { ...m.lifts, squat: [{ weightKg: 145, result: 'good' }] } })
    m = useStore.getState().S.powerlifting.meets[0]
    expect(m._f).toMatchObject({ lifts: expect.any(Number) })
    expect(m._f.lifts).toBeGreaterThanOrEqual(m._ts)
  })
})
