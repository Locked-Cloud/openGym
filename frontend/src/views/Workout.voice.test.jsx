// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

// Voice logging on the workout screen: the mic in the header, the pref that shows it, and the
// utterance → parsed actions → open-set seam (applyVoice). The parser itself and the speech
// wrapper have their own suites in lib/; this is the wiring.

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const row = (w, done = false, extra = {}) => ({ w, r: 8, done, ...extra })
const entry = (id, sets, extra = {}) => ({ id, target: { sets: sets.length, reps: 8 }, sets, ...extra })

// A stand-in for the browser's SpeechRecognition: startSpeech() configures it, the test drives
// the callbacks the real API would fire for one utterance.
function FakeRecognition() { FakeRecognition.last = this }
FakeRecognition.prototype.start = function () {}
FakeRecognition.prototype.stop = function () {}
FakeRecognition.prototype.abort = function () {}

const say = text => {
  const rec = FakeRecognition.last
  act(() => {
    rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] })
    rec.onend()
  })
}

let root
let container

function setActive(entries, { cur = 0, wc } = {}) {
  const S = clone(DEF)
  if (wc) S.wc = { ...S.wc, ...wc }
  S.hints = { swipeSets: true }
  S.active = {
    id: 'voice-test', d: '2026-10-06', start: Date.now(), routineId: null,
    name: 'Voice test', bw: null, cur, entries,
  }
  useStore.setState({ S, user: null })
}

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const micButton = () => document.querySelector('button[aria-label="Log by voice"]')
const chip = () => document.querySelector('.voicelog-chip')
const sets = () => useStore.getState().S.active.entries[0].sets

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null, timer: null, work: null, swipeHint: null, setFlash: null })
  useStore.setState({ S: clone(DEF), user: null })
  window.SpeechRecognition = FakeRecognition
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
})

describe('the voice mic on the workout header', () => {
  it('is off by default, and hidden entirely without speech recognition', () => {
    setActive([entry('1001', [row(80), row(80)])])
    render()
    expect(micButton()).toBe(null)
    delete window.SpeechRecognition
    setActive([entry('1001', [row(80), row(80)])], { wc: { voiceLog: true } })
    render()
    expect(micButton()).toBe(null)
  })

  it('appears when the pref is on, and one utterance writes the open set', () => {
    setActive([entry('1001', [row(80), row(80)])], { wc: { voiceLog: true } })
    render()
    const mic = micButton()
    expect(mic).toBeTruthy()
    act(() => mic.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    say('five reps at one hundred kilos')
    expect(sets()[0]).toMatchObject({ r: 5, w: 100 })
    expect(chip()?.textContent).toContain('5')
    // one utterance per tap: the mic idles again until tapped
    expect(micButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('"done" ticks the open set and starts its rest', () => {
    setActive([entry('1001', [row(80), row(80)])], { wc: { voiceLog: true } })
    render()
    act(() => micButton().dispatchEvent(new MouseEvent('click', { bubbles: true })))
    say('done')
    expect(sets()[0].done).toBe(true)
    expect(useUI.getState().timer?.left).toBe(90)
  })

  it('an utterance it cannot parse changes nothing', () => {
    setActive([entry('1001', [row(80), row(80)])], { wc: { voiceLog: true } })
    render()
    act(() => micButton().dispatchEvent(new MouseEvent('click', { bubbles: true })))
    say('one hundred')
    expect(sets()[0]).toMatchObject({ r: 8, w: 80, done: false })
    expect(chip()?.textContent).toContain('Didn’t catch that')
  })

  it('a weight said in the other unit is converted to the profile’s', () => {
    setActive([entry('1001', [row(80)])], { wc: { voiceLog: true } })
    useStore.setState(s => ({ S: { ...s.S, unit: 'lb' } }))
    render()
    act(() => micButton().dispatchEvent(new MouseEvent('click', { bubbles: true })))
    say('one hundred kilos')
    // 100 kg said into a lb profile lands as ~220.5 lb, the way the unit switch converts
    expect(sets()[0].w).toBeCloseTo(220.5, 1)
  })
})
