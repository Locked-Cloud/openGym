import { useEffect, useRef, useState } from 'react'
import { t, getLang } from '../lib/i18n.js'
import { parseVoiceCommand } from '../lib/voice-log.js'
import { speechSupported, startSpeech } from '../lib/voice-speech.js'
import Icon from './Icon.jsx'

// How long the confirmation (or the shrug) stays on screen before the chip folds away and
// the mic is ready for the next utterance. A toast's 2.2 s, plus a beat to read numbers.
const DISMISS_MS = 2800

// Floating chip under the workout header while a session runs: it must clear the sticky
// header itself, not push the sets around mid-set.
const CHIP = {
  position: 'fixed',
  top: 'calc(var(--sat, 0px) + var(--conn, 0px) + 58px)',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 40,
  maxWidth: '88vw',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
}

// The tap-to-talk mic on the workout header (Settings → Workout settings → Log by voice, off
// by default). One tap listens for ONE utterance — never always-listening — shows the live
// transcript, then the confirmation of what was understood, and hands the parsed actions to
// the parent: onActions(actions) applies them to the session and returns the confirmation to
// show (already localized, in the profile's unit and effort scale — the parser itself is
// i18n-free by contract, see lib/voice-log.js). Hidden entirely where the browser has no
// speech recognition, like the Vibrate row hides without a vibrator.
export default function VoiceLog({ onActions }) {
  const [listening, setListening] = useState(false)
  const [chip, setChip] = useState(null)   // null | { kind: 'hear' | 'ok' | 'no', text }
  const session = useRef(null)             // { stop, abort } from startSpeech
  const heard = useRef('')                 // the final transcript so far
  const denied = useRef(false)
  const dismiss = useRef(null)
  useEffect(() => () => {
    // leaving the screen never leaves a microphone open
    session.current?.abort()
    clearTimeout(dismiss.current)
  }, [])
  if (!speechSupported()) return null

  const clearDismiss = () => { clearTimeout(dismiss.current); dismiss.current = null }
  const showChip = next => {
    clearDismiss()
    setChip(next)
    if (next && next.kind !== 'hear') {
      dismiss.current = setTimeout(() => setChip(null), DISMISS_MS)
    }
  }

  const start = () => {
    clearDismiss()
    heard.current = ''
    denied.current = false
    setListening(true)
    setChip({ kind: 'hear', text: '' })
    session.current = startSpeech({
      lang: getLang(),
      onResult: (final, interim) => {
        if (final) heard.current = final
        setChip({ kind: 'hear', text: interim || final })
      },
      onError: e => {
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') denied.current = true
      },
      onEnd: () => {
        setListening(false)
        session.current = null
        if (denied.current) { showChip({ kind: 'no', text: t('Microphone access was denied.') }); return }
        if (!heard.current.trim()) { showChip({ kind: 'no', text: t('Didn’t hear anything') }); return }
        const { actions } = parseVoiceCommand(heard.current)
        const unknown = actions[0]?.type === 'unknown'
        showChip({ kind: unknown ? 'no' : 'ok', text: unknown || !onActions ? t('Didn’t catch that') : onActions(actions) || t('Didn’t catch that') })
      },
    })
    // onResult above never ran? startSpeech already failed to start (it ends itself).
    if (session.current) return
    setListening(false)
    showChip({ kind: 'no', text: t('Voice recognition is unavailable right now.') })
  }

  const stop = () => session.current?.stop()

  return <>
    <button type="button" className="iconbtn" aria-label={listening ? t('Stop listening') : t('Log by voice')}
      aria-pressed={listening} title={t('Log by voice')}
      style={listening ? { color: 'var(--acc)' } : undefined}
      onClick={listening ? stop : start}><Icon name="mic" /></button>
    {chip && <div role="status" aria-live="polite" className={'tag voicelog-chip' + (chip.kind === 'no' ? '' : ' acc')}
      style={CHIP}>
      {listening
        ? <><Icon name="mic" /><span>{chip.text || t('Listening…')}</span></>
        : <span>{chip.text}</span>}
    </div>}
  </>
}
