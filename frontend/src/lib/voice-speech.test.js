// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPEECH_TIMEOUT_MS, speechSupported, startSpeech } from './voice-speech.js'

// A stand-in for the browser's SpeechRecognition: records the configuration startSpeech()
// sets and lets a test drive the callbacks the real API would fire.
function FakeRecognition() {
  FakeRecognition.last = this
  this.continuous = undefined
  this.interimResults = undefined
  this.lang = undefined
}
FakeRecognition.prototype.start = function () {}
FakeRecognition.prototype.stop = function () { this.onend?.() }
FakeRecognition.prototype.abort = function () { this.onend?.() }

const speak = (rec, chunks) => {
  chunks.forEach(([final, text], i) => rec.onresult({
    resultIndex: i,   // the API points at the first result this event changed
    results: chunks.slice(0, i + 1).map(([f, t]) => ({ isFinal: f, 0: { transcript: t } })),
  }))
}

beforeEach(() => {
  vi.useFakeTimers()
  window.SpeechRecognition = FakeRecognition
})
afterEach(() => {
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
  vi.useRealTimers()
})

describe('startSpeech', () => {
  it('feature-detects: hidden where no recognition API exists', () => {
    delete window.SpeechRecognition
    expect(speechSupported()).toBe(false)
    expect(startSpeech({})).toBe(null)
    window.webkitSpeechRecognition = FakeRecognition
    expect(speechSupported()).toBe(true)
  })

  it('listens for one utterance only, with interim results, in the given language', () => {
    startSpeech({ lang: 'pt' })
    const rec = FakeRecognition.last
    expect(rec.continuous).toBe(false)
    expect(rec.interimResults).toBe(true)
    expect(rec.lang).toBe('pt')
  })

  it('streams interim then final text, and ends exactly once', () => {
    const onResult = vi.fn(), onEnd = vi.fn()
    const s = startSpeech({ onResult, onEnd })
    const rec = FakeRecognition.last
    speak(rec, [[false, 'five reps'], [true, 'five reps at one hundred kilos']])
    expect(onResult).toHaveBeenLastCalledWith('five reps at one hundred kilos', '')
    expect(onResult).toHaveBeenCalledWith('', 'five reps')
    s.stop()
    rec.onend()
    rec.onend()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('cuts a session that heard nothing at the hard timeout', () => {
    const onError = vi.fn(), onEnd = vi.fn()
    const s = startSpeech({ onError, onEnd })
    expect(s).toBeTruthy()
    vi.advanceTimersByTime(SPEECH_TIMEOUT_MS - 1)
    expect(onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onError).toHaveBeenCalledWith({ error: 'timeout' })
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('passes the API error through, and still ends once', () => {
    const onError = vi.fn(), onEnd = vi.fn()
    startSpeech({ onError, onEnd })
    FakeRecognition.last.onerror({ error: 'not-allowed' })
    FakeRecognition.last.onend()
    expect(onError).toHaveBeenCalledWith({ error: 'not-allowed' })
    expect(onEnd).toHaveBeenCalledTimes(1)
  })
})
