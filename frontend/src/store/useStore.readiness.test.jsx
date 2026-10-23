// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))

import { DEF, useStore } from './useStore.js'
import { SLEEPS_CAP } from '../lib/readiness.js'

const clone = value => JSON.parse(JSON.stringify(value))

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

// The sleep-based readiness module (lib/readiness.js) rides the same update()/persist()/
// stampChange path as everything else. These pin the contract the Home card and the readiness
// sheet rely on: the default shape, importSleeps merging by id+date and re-capping, a hand
// entry replacing its date and standing over later pulls, and stampChange putting the
// `_ts`/`_f` on a night this change added or corrected — the stamps mergeReadiness
// (lib/sync-merge.js) reads on another device.

const day = n => new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10)
const hc = (n, minutes, over = {}) => ({ id: 'hc-' + day(n), date: day(n), minutes, ...over })

describe('readiness state', () => {
  it('defaults to no nights', () => {
    expect(useStore.getState().S.readiness).toEqual({ sleeps: [] })
  })

  it('imports nights newest-first and persists them', () => {
    useStore.getState().importSleeps([hc(3, 400), hc(1, 410), hc(2, 405)])
    const sleeps = useStore.getState().S.readiness.sleeps
    expect(sleeps.map(x => x.date)).toEqual([day(3), day(2), day(1)])
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.readiness.sleeps).toHaveLength(3)
  })

  it('merges by id+date: a re-pull replaces its night, adds new ones, keeps the rest', () => {
    useStore.getState().importSleeps([hc(2, 400), hc(1, 410)])
    useStore.getState().importSleeps([hc(2, 442), hc(0, 430)])   // the pull that saw more of the night
    const sleeps = useStore.getState().S.readiness.sleeps
    expect(sleeps.map(x => x.date)).toEqual([day(2), day(1), day(0)])
    expect(sleeps.find(x => x.date === day(2)).minutes).toBe(442)
    expect(sleeps.find(x => x.date === day(1)).minutes).toBe(410)
  })

  it('an unchanged re-pull stamps nothing new on the night', () => {
    useStore.getState().importSleeps([hc(1, 410)])
    const before = clone(useStore.getState().S.readiness.sleeps[0])
    useStore.getState().importSleeps([hc(1, 410)])
    const after = useStore.getState().S.readiness.sleeps[0]
    expect(after._ts).toBe(before._ts)
    expect(after._f).toBe(before._f)
    // the copy's own `_ts` moves with any change, as everywhere; the night's stamps do not
  })

  it('drops malformed rows, ignores junk arguments, and re-caps at SLEEPS_CAP', () => {
    useStore.getState().importSleeps(null)
    useStore.getState().importSleeps([])
    expect(useStore.getState().S.readiness.sleeps).toEqual([])
    useStore.getState().importSleeps([null, { date: 'nope', minutes: 5 }, hc(1, 400)])
    expect(useStore.getState().S.readiness.sleeps).toHaveLength(1)
    for (let i = 0; i < SLEEPS_CAP + 5; i++) useStore.getState().importSleeps([hc(i, 400)])
    const sleeps = useStore.getState().S.readiness.sleeps
    expect(sleeps).toHaveLength(SLEEPS_CAP)
    expect(sleeps[0].date).toBe(day(SLEEPS_CAP + 4))
    expect(sleeps.at(-1).date).toBe(day(5))
  })

  it('saveNight replaces every row of its date, and stands over a later pull for it', () => {
    useStore.getState().importSleeps([hc(1, 442), hc(2, 410)])
    expect(useStore.getState().saveNight({ date: day(1), minutes: 390 })).toBe(true)
    let sleeps = useStore.getState().S.readiness.sleeps
    expect(sleeps.filter(x => x.date === day(1))).toEqual([{ id: 'm-' + day(1), date: day(1), minutes: 390, manual: true, _ts: expect.any(Number) }])
    // the phone syncs again, and Health Connect still says 442 for that morning
    useStore.getState().importSleeps([hc(1, 442)])
    sleeps = useStore.getState().S.readiness.sleeps
    expect(sleeps.filter(x => x.date === day(1))).toHaveLength(1)
    expect(sleeps.find(x => x.date === day(1)).minutes).toBe(390)
  })

  it('saveNight refuses a malformed night and writes nothing', () => {
    useStore.getState().importSleeps([hc(1, 442)])
    const before = clone(useStore.getState().S.readiness)
    expect(useStore.getState().saveNight({ date: '2026-10-99', minutes: 400 })).toBe(false)
    expect(useStore.getState().saveNight({ date: day(1), minutes: 0 })).toBe(false)
    expect(useStore.getState().saveNight()).toBe(false)
    expect(useStore.getState().S.readiness).toEqual(before)
  })

  it('works on a state whose readiness key is missing (an old profile overlaid on DEF)', () => {
    useStore.setState(s => ({ S: { ...s.S, readiness: undefined } }))
    useStore.getState().importSleeps([hc(1, 410)])
    expect(useStore.getState().S.readiness.sleeps).toHaveLength(1)
  })
})

// The sync contract: a night carries its own `_ts`, and a corrected night `_f` on its changed
// fields, so a conflict keeps the version corrected last (mergeReadiness → mergeEntry).
describe('readiness stamps', () => {
  it('a new night takes _ts and no _f; a corrected one stamps the minutes field', () => {
    useStore.getState().importSleeps([hc(1, 410)])
    let n = useStore.getState().S.readiness.sleeps[0]
    expect(n._ts).toEqual(expect.any(Number))
    expect(n._f).toBeUndefined()

    useStore.getState().importSleeps([hc(1, 442)])
    n = useStore.getState().S.readiness.sleeps[0]
    expect(n._f).toMatchObject({ minutes: expect.any(Number) })
    expect(n._f.minutes).toBeGreaterThanOrEqual(n._ts)
  })

  it('an unrelated change stamps nothing in the module', () => {
    useStore.getState().importSleeps([hc(1, 410)])
    const before = clone(useStore.getState().S.readiness)
    useStore.getState().update(s => { s.restSec = 75 }, false)
    expect(useStore.getState().S.readiness).toEqual(before)
  })
})
