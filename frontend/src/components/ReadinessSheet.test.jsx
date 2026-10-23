// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { DEF } from '../store/useStore.js'
import { ReadinessCard, ReadinessSheet } from './ReadinessSheet.jsx'

// The card and the sheet only display lib/readiness.js's answer and write through the store
// actions — the arithmetic is pinned in readiness.test.js and useStore.readiness.test.jsx. So
// these stay cheap: the band as the card shows it, and hand entry landing in the store.

// useStore imports the write side of health-sync too, so the mock carries it as no-ops.
vi.mock('../lib/health-sync.js', () => ({
  initHealthSync: vi.fn(), initSleepSync: vi.fn(), syncHealth: vi.fn(async () => null),
  sleepStatus: vi.fn(async () => ({ status: 'unsupported' })), pullSleeps: vi.fn(),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const day = n => new Date(Date.UTC(2026, 9, 23 - n)).toISOString().slice(0, 10)
const nights = (over = {}) => useStore.setState(s => ({
  S: { ...s.S, readiness: { sleeps: [
    { id: 'x-0', date: day(0), minutes: 420 },
    ...[1, 2, 3, 4, 5, 6, 7].map(n => ({ id: 'x-' + n, date: day(n), minutes: 420 })),
  ] } },
  ...over,
}))
// A controlled input takes a value through the native setter, the way React's own tests do.
const setVal = (el, v) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

let host, root
beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: null, ready: false })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })
const mount = ui => act(async () => { root.render(ui) })

describe('ReadinessCard', () => {
  it('shows the score, the band and last night against the average', async () => {
    nights()
    await mount(<ReadinessCard />)
    expect(host.textContent).toContain('Readiness')
    expect(host.textContent).toContain('100')
    expect(host.textContent).toContain('Usual sleep')
    expect(host.textContent).toContain('7-night average')
    // no Health Connect on this build: no Refresh affordance anywhere
    expect([...host.querySelectorAll('button')].some(b => b.textContent.includes('Refresh'))).toBe(false)
  })

  it('says plainly when there is not enough to compare with yet', async () => {
    await mount(<ReadinessCard />)
    expect(host.textContent).toContain('No nights yet')
  })
})

describe('ReadinessSheet', () => {
  const inputByLabel = label => [...host.querySelectorAll('input')].find(i => i.getAttribute('aria-label') === label)
  const save = () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Save night'))

  it('enters a night by hand and lands it in the store, replacing that date', async () => {
    useStore.getState().importSleeps([{ id: 'hc-' + day(1), date: day(1), minutes: 442 }])
    await mount(<ReadinessSheet close={() => {}} />)
    act(() => setVal(host.querySelector('input[type="date"]'), day(1)))
    act(() => setVal(inputByLabel('Hours'), '6'))
    act(() => setVal(inputByLabel('Minutes'), '30'))
    await act(async () => { save().click() })
    const sleeps = useStore.getState().S.readiness.sleeps
    expect(sleeps.filter(x => x.date === day(1))).toEqual([{ id: 'm-' + day(1), date: day(1), minutes: 390, manual: true, _ts: expect.any(Number) }])
  })
})
