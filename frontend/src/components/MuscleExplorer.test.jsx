// @vitest-environment happy-dom
// Issue #71 (the same rule Library and the exercise picker already keep): choosing a body part
// after picking an equipment type must not reset the equipment filter back to "any equipment"
// when the new body part still has exercises under it. MuscleExplorer used to clear it on every
// body-part tap regardless — the only one of the three exercise browsers that did.
// The later describes cover the enhanced explorer: the muscle detail panel (this week's
// completed vs planned sets, best e1RM exercise, window selector), the muscle search, and the
// fatigue overlay toggle.
import React, { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
// The first render indexes all 5,600+ catalogue exercises for search and the muscle map, which
// takes over a second here on its own and longer on a busy runner.
vi.setConfig({ testTimeout: 15000 })
import { createRoot } from 'react-dom/client'
import MuscleExplorer from './MuscleExplorer.jsx'
import { fatigueOf } from '../lib/recovery.js'
import { fatigueStateOf } from '../lib/recovery-view.js'
import { exerciseMuscleSnapshot } from '../lib/muscles.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({ S: state.S, user: null, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})

const mounted = []
function render(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<MuscleExplorer {...props} />))
  return host
}
// BodyMap loads its geometry with a dynamic import; a couple of awaited acts let the resolved
// module reach the map's state (the file's beforeAll has already paid the module load itself).
const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => {}) }
const chipByText = (host, text) =>
  [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.trim() === text)
const muscleChip = (host, label) =>
  [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.startsWith(label))
const isOn = el => el.className.split(/\s+/).includes('on')
const type = (el, value) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  mocks.S = {
    unit: 'kg', lang: 'en', body: 'male', routines: [], workouts: [], customEx: [], exWeights: {},
    equipProfiles: [], activeEquipId: null, equipFilterOn: false, favEx: [],
  }
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('MuscleExplorer body-part chips keep the equipment filter', () => {
  // Biceps has dumbbell exercises under both "lower arms" and "upper arms" in the catalog, the
  // same shape as issue #71's original repro (lower arms/upper arms + dumbbell).
  it('keeps the dumbbell filter when switching from lower arms to upper arms', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })

    act(() => { chipByText(host, 'lower arms').click() })
    const dumbbell = chipByText(host, 'dumbbell')
    expect(dumbbell, 'dumbbell chip should be offered under lower arms').toBeTruthy()
    act(() => { dumbbell.click() })
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(true)

    act(() => { chipByText(host, 'upper arms').click() })
    expect(isOn(chipByText(host, 'upper arms'))).toBe(true)
    const dumbbellAfter = chipByText(host, 'dumbbell')
    expect(dumbbellAfter, 'dumbbell chip should still be present under upper arms').toBeTruthy()
    expect(isOn(dumbbellAfter)).toBe(true)
    expect(isOn(chipByText(host, 'Any equipment'))).toBe(false)
  })

  // "All" body parts is the one chip that does clear the equipment filter — it spans every
  // body part, so there is no "still valid here" question to answer.
  it('"All" body parts still clears the equipment filter', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })
    act(() => { chipByText(host, 'lower arms').click() })
    act(() => { chipByText(host, 'dumbbell').click() })
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(true)

    act(() => { chipByText(host, 'All').click() })
    expect(isOn(chipByText(host, 'Any equipment'))).toBe(true)
  })
})

describe('MuscleExplorer search: the × and live count the Library has (#338)', () => {
  // The explorer now has two search fields — muscles above the stage, exercises under it — so
  // the exercise one is found by its placeholder, not by being the first on the page.
  const exerciseSearch = host => [...host.querySelectorAll('.search')]
    .find(s => s.querySelector('input')?.getAttribute('placeholder') === 'Search…')
  it('shows a count while narrowed and a × that empties only the text', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })
    const search = exerciseSearch(host)
    const input = search.querySelector('input')
    const count = () => search.querySelector('.search-count')
    const clear = () => search.querySelector('.clear')
    const rows = () => host.querySelectorAll('.list .item').length
    expect(count()).toBeNull()
    expect(clear()).toBeNull()
    act(() => type(input, 'curl'))
    expect(clear().getAttribute('aria-label')).toBe('Clear')
    expect(Number(count().textContent)).toBeGreaterThan(0)
    expect(rows()).toBe(Math.min(40, Number(count().textContent)))
    act(() => clear().click())
    expect(input.value).toBe('')
    expect(clear()).toBeNull()
    expect(count()).toBeNull()
    act(() => { chipByText(host, 'upper arms').click() })
    expect(count()).toBeTruthy()
    expect(clear()).toBeNull()
  })
})

// ── the enhanced explorer ─────────────────────────────────────────────────────────
// A fixed "today" so the week window and the fatigue scan are deterministic.
const NOW = new Date(2026, 8, 30, 12).getTime()   // 2026-09-30, a Wednesday
const set = (w, r) => ({ w, r, done: true })
const workout = (d, entries) => ({ d, start: new Date(d + 'T12:00:00').getTime(), entries })
const press = { id: 'press', n: 'Bench Press', primaries: ['chest'], secondaries: ['triceps'], custom: true }
const fly = { id: 'fly', n: 'Cable Fly', primaries: ['chest'], custom: true }
const incline = { id: 'incline', n: 'Incline DB Press', primaries: ['chest'], custom: true }
// Two chest sessions inside 30 days, one of them inside this week (Mon 2026-09-28): three
// done chest sets this week, four in 30 days. The plan programs twelve. Entries carry the
// muscle snapshot a finished workout persists (lib/muscles.js exerciseMuscleSnapshot), which
// is what the fatigue scan and the strength rows read a deleted-or-custom exercise through.
const entry = (ex, sets) => ({ id: ex.id, exercise: ex, muscleSnapshot: exerciseMuscleSnapshot(ex), sets })
const panelFixture = () => ({
  ...mocks.S,
  routines: [{ id: 'push', name: 'Push', ex: [{ id: 'press', sets: 12 }] }],
  week: { 1: ['push'] },
  customEx: [press, fly, incline],
  workouts: [
    workout('2026-09-29', [
      entry(press, [set(100, 5), set(95, 8)]),
      entry(fly, [set(30, 12)]),
    ]),
    workout('2026-09-15', [entry(incline, [set(50, 3)])]),
  ],
})
const panel = host => host.querySelector('[data-muscle-panel]')
const statValues = host => [...panel(host).querySelectorAll('.mx-stat .v')]
const topRows = host => [...panel(host).querySelectorAll('.list .item')]

describe('MuscleExplorer detail panel', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); mocks.S = panelFixture() })
  afterEach(() => vi.useRealTimers())

  it('opens with this week\'s completed vs planned sets, the fatigue state and the best e1RM exercise', () => {
    const host = render()
    act(() => { muscleChip(host, 'Chest').click() })

    expect(panel(host)).toBeTruthy()
    expect(panel(host).dataset.muscle).toBe('chest')
    // Three done chest sets this week (bench ×2, fly ×1) against the twelve planned.
    expect(statValues(host)[0].textContent.trim()).toBe('3 / 12')
    expect(statValues(host)[0].getAttribute('aria-label')).toBe('Completed 3 sets · Planned 12 sets')
    // The best estimate is bench's 95×8 (Epley 120.3), at full retention a day later.
    expect(statValues(host)[1].textContent.trim()).toBe('120.3 kg')
    // The panel's fatigue chip carries the same state the map shades chest with.
    const chip = panel(host).querySelector('.mx-state')
    const expected = fatigueStateOf(fatigueOf(mocks.S.workouts, NOW, { unit: 'kg' }).chest)
    expect(chip.className).toBe('mx-state ' + expected)
    expect(panel(host).querySelector('h4.sec').textContent).toBe('Best exercise')
    expect(panel(host).querySelector('.item .ss').textContent).toContain('120.3 kg')
    // The top-exercises list is the same ranking minus the hero row: only the fly is left.
    expect(topRows(host).map(row => row.textContent)).toEqual(['Cable Fly30'])
  })

  it('the window selector moves the panel\'s numbers', () => {
    const host = render()
    act(() => { muscleChip(host, 'Chest').click() })
    const win30 = [...panel(host).querySelectorAll('.seg button')].find(b => b.textContent === '30d')

    act(() => { win30.click() })
    // 30 days adds September 15th's incline set, and planned sets are a week-only reading.
    expect(statValues(host)[0].textContent.trim()).toBe('4')
    expect(statValues(host)[0].getAttribute('aria-label')).toBe('4 sets')
    expect(panel(host).textContent).not.toContain('/ 12')
    // The e1RM ranking gains the incline session, between bench and fly.
    expect(topRows(host).map(row => row.textContent)).toEqual(['Incline DB Press50', 'Cable Fly30'])
  })
})

describe('MuscleExplorer muscle search', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); mocks.S = panelFixture() })
  afterEach(() => vi.useRealTimers())

  it('filters the chips and outlines the matches on the map', async () => {
    const host = render()
    const input = host.querySelector('input[placeholder="Search muscles…"]')
    act(() => type(input, 'chest'))
    expect([...host.querySelectorAll('.chips .chip')].map(c => c.textContent.trim())).toEqual(
      [expect.stringMatching(/^Chest/)])
    await settle()
    const chest = host.querySelector('.mx-onemap .bm-m[aria-label="Chest"]')
    const biceps = host.querySelector('.mx-onemap .bm-m[aria-label="Biceps"]')
    expect(chest.className).toContain('match')
    expect(biceps.className).not.toContain('match')

    act(() => type(input, 'zzz'))
    expect(host.querySelectorAll('.chips .chip')).toHaveLength(0)
    expect(host.querySelector('.chips').textContent).toBe('No match')
  })
})

describe('MuscleExplorer fatigue overlay', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); mocks.S = panelFixture() })
  afterEach(() => vi.useRealTimers())

  it('shades regions by recovery state and the toggle turns it off', async () => {
    const host = render()
    await settle()
    const onemap = () => host.querySelector('.mx-onemap')
    const chest = () => host.querySelector('.mx-onemap .bm-m[aria-label="Chest"]')

    expect(onemap().className).toContain('hm-fatigue')
    expect(host.querySelector('.hm-legend.hm-fatigue')).toBeTruthy()
    expect(chest().className).toMatch(/bm-m l[1-4]/)

    act(() => { host.querySelector('button[aria-label="Fatigue"]').click() })
    expect(onemap().className).not.toContain('hm-fatigue')
    expect(host.querySelector('.hm-legend.hm-fatigue')).toBeNull()
    expect(chest().className).toBe('bm-m l0')
  })
})

// Pre-loading the geometry module here, like BodyMap.test.jsx does, so the waits above cover
// rendering rather than how fast the machine imports ~90 KB of paths.
beforeAll(() => import('../lib/body-paths.js'))
