// The microphone half of voice logging: a thin wrapper around the browser's Web Speech API
// (SpeechRecognition / webkitSpeechRecognition — built into browsers and WebViews, so this
// adds no dependency). The grammar lives in voice-log.js; the mic button in
// components/VoiceLog.jsx.
//
// One utterance per call: continuous=false, tap-to-talk only — never always-listening, for
// privacy and battery. Interim results stream out for a live transcript chip, and a hard
// 10 s timeout ends a session that heard nothing, so a stray tap can never leave a
// microphone open. Everything degrades to a no-op where the API is missing: speechSupported()
// gates the UI, and startSpeech() returns null there.

// Hard cap on one utterance: long enough to say "five reps at one hundred kilos, RIR one",
// short enough that a pocket tap is over before you notice.
export const SPEECH_TIMEOUT_MS = 10000

const recognitionCtor = () =>
  typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : undefined

/** Whether this browser can recognise speech at all. The mic stays hidden when it cannot. */
export const speechSupported = () => typeof recognitionCtor() === 'function'

/**
 * Listen for one utterance.
 *
 * { lang, onResult, onEnd, onError } — lang defaults to the browser's own; onResult(final,
 * interim) fires with the transcripts so far (interim while you speak, final once settled);
 * onError({ error }) carries the API's error code, 'timeout' for the hard timeout; onEnd
 * fires exactly once, after a result, an error, a stop/abort or the timeout.
 *
 * Returns { stop, abort } — stop() lets a final result land, abort() ends silently — or null
 * when speech recognition is unavailable or cannot start (nothing is listening then).
 */
export function startSpeech({ lang, onResult, onEnd, onError } = {}) {
  const Rec = recognitionCtor()
  if (typeof Rec !== 'function') return null
  let rec
  try { rec = new Rec() } catch (e) { return null }
  rec.continuous = false
  rec.interimResults = true
  rec.lang = lang || (typeof navigator !== 'undefined' && navigator.language) || 'en'
  let finalText = ''
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    clearTimeout(tm)
    onEnd?.()
  }
  const tm = setTimeout(() => {
    try { rec.abort() } catch (e) { /* already gone */ }
    onError?.({ error: 'timeout' })
    end()
  }, SPEECH_TIMEOUT_MS)
  rec.onresult = e => {
    let interim = ''
    for (let i = e.resultIndex || 0; i < e.results.length; i++) {
      const r = e.results[i]
      const txt = r[0]?.transcript || ''
      if (r.isFinal) finalText += txt
      else interim += txt
    }
    onResult?.(finalText.trim(), interim.trim())
  }
  // Chrome fires onend after onerror; other engines may not — either way onEnd runs once.
  rec.onerror = e => onError?.({ error: e?.error || 'unknown' })
  rec.onend = end
  try {
    rec.start()
  } catch (e) {
    // start() throws when a session is already running (double tap) or the page lost the mic
    clearTimeout(tm)
    ended = true
    onError?.({ error: 'start-failed' })
    onEnd?.()
    return { stop: () => {}, abort: () => {} }
  }
  return {
    stop: () => { try { rec.stop() } catch (e) { /* already ended */ } },
    abort: () => { try { rec.abort() } catch (e) { /* already ended */ } },
  }
}
