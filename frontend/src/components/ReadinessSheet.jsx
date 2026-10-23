import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtDur, todayISO } from '../lib/format.js'
import { readinessFromSleeps, sleepsOf, nightsOf, MIN_NIGHTS } from '../lib/readiness.js'
import { sleepStatus, pullSleeps } from '../lib/health-sync.js'
import { useSheetKeyboard, tappable } from '../lib/use-sheet-keyboard.js'
import LineChart from './LineChart.jsx'
import Icon from './Icon.jsx'
import { Button, NumberField, Row } from './ui.jsx'

// The sleep-based readiness card and its sheet (lib/readiness.js). Everything here displays the
// pure module's answer: how last night compares with the user's own recent nights — a
// sleep-consistency signal, shown next to the training data, never mixed into the fatigue model
// (lib/recovery.js) and never worded as recovery, readiness-to-train or anything medical.
//
// Nights come from two places: Health Connect on Android (the card's Refresh — the only place
// the sleep-read permission is ever asked for; with it standing, lib/health-sync.js pulls
// quietly on foreground), and hand entry in the sheet, which is the same feature for everyone
// else.

// Band names as t() calls written out, so the source-string check finds them (the PLAN_COPY
// rule in sheets.jsx: copy parked in a map and passed in as a variable is invisible to it).
export const READINESS_BAND_LABEL = {
  low: () => t('Below usual'),
  normal: () => t('Usual sleep'),
  high: () => t('Above usual'),
}
const BAND_STYLE = {
  low: { color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' },
  normal: { color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' },
  high: { color: 'var(--blue)', background: 'color-mix(in srgb,var(--blue) 16%,transparent)' },
}

// What a failed Refresh says, by pullSleeps' reason (lib/health-sync.js).
export const REFRESH_REASONS = {
  denied: () => t('Sleep permission was not granted'),
  permission: () => t('Could not read sleep from Health Connect'),
  unavailable: () => t('Could not read sleep from Health Connect'),
}

/* ---------- the Home card ---------- */
export function ReadinessCard() {
  const S = useStore(s => s.S)
  // Health Connect is there to read from (Android, with it installed): only then does the
  // Refresh affordance exist at all — elsewhere the sheet's hand entry is the whole feature.
  const [hc, setHc] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let gone = false
    sleepStatus().then(st => { if (!gone && st.status === 'available') setHc(true) }).catch(() => {})
    return () => { gone = true }
  }, [])
  const r = readinessFromSleeps(sleepsOf(S), todayISO())
  const refresh = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await pullSleeps()
      if (!res.ok) {
        // The button only exists where Health Connect answered 'available' at mount, so an
        // 'unsupported' here is that changing underneath (uninstalled, updated away) — the same
        // words as any failed read say it.
        const why = REFRESH_REASONS[res.reason] || REFRESH_REASONS.unavailable
        useUI.getState().toast(why())
        return
      }
      useStore.getState().importSleeps(res.rows)
      // No plural count here on purpose: a new tn() key would need forms in ru/uk/pl now
      // (i18n-plural.test.js), and the translations pass owns the locale files.
      useUI.getState().toast(res.rows.length ? t('Sleep refreshed from Health Connect') : t('No sleep in Health Connect yet'))
    } finally {
      setBusy(false)
    }
  }
  return <div className="card tappable" style={{ cursor: 'pointer' }} {...tappable(() => readinessSheet())}>
    <div className="row between bw-head" style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0 }}>{t('Readiness')}</h2>
      {hc && <Button size="sm" icon="reset" disabled={busy}
        onClick={e => { e.stopPropagation(); refresh() }}>{busy ? t('Refreshing…') : t('Refresh sleep')}</Button>}
    </div>
    {r.band ? <>
      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        <Icon name="moon" style={{ color: 'var(--blue)', fontSize: 20, alignSelf: 'center' }} />
        <span className="big">{r.score}</span>
        <span className="tag" style={BAND_STYLE[r.band]}>{READINESS_BAND_LABEL[r.band]()}</span>
      </div>
      <div className="muted small" style={{ marginTop: 2 }}>
        {t('Last night {0} · {1}-night average {2}', fmtDur(r.lastNightMinutes * 60000), r.baselineNights, fmtDur(r.sevenDayAvgMinutes * 60000))}
      </div>
    </> : <div className="muted small">{r.note === 'no-sleeps'
      ? t('No nights yet. Tap to add one, or Refresh sleep from Health Connect.')
      : t('Not enough nights yet — {0} or more and it compares last night with your own average.', String(MIN_NIGHTS))}</div>}
  </div>
}

/* ---------- the sheet: 7 nights, and hand entry ---------- */
export function ReadinessSheet({ close }) {
  const S = useStore(s => s.S)
  const nights = nightsOf(sleepsOf(S), todayISO()).slice(0, 7)   // newest first
  const r = readinessFromSleeps(sleepsOf(S), todayISO())
  // The chart reads oldest → newest (LineChart sorts by t); hours with one decimal.
  const points = [...nights].reverse().map(x => ({ t: new Date(x.date + 'T12:00:00').getTime(), y: Math.round(x.minutes / 6) / 10, d: x.date }))
  const { saveNight } = useStore.getState()

  const hoursRef = useRef(null)
  const onHoursFocus = useSheetKeyboard(hoursRef)
  const [date, setDate] = useState(todayISO())
  const [hours, setHours] = useState(8)
  const [mins, setMins] = useState(0)
  const save = () => {
    const total = Math.round((Number(hours) || 0) * 60 + (Number(mins) || 0))
    if (!date || !(total > 0)) { useUI.getState().toast(t('Enter how long you slept')); return }
    if (total > 24 * 60) { useUI.getState().toast(t('A night cannot be longer than a day.')); return }
    if (!saveNight({ date, minutes: total })) { useUI.getState().toast(t('Enter how long you slept')); return }
    useUI.getState().toast(t('Night saved'))
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <h3 style={{ margin: 0 }}>{t('Sleep')}</h3>
      <Button size="sm" variant="ghost" onClick={close}>{t('Done')}</Button>
    </div>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {t('How steady your sleep is, next to your training: last night against your own recent nights. It is not a recovery measurement and says nothing about your health.')}
    </div>
    {nights.length ? <>
      <div className="chart"><LineChart points={points} h={140} unit="h" /></div>
      <div className="small dim" style={{ margin: '6px 0 4px' }}>{t('Last {0} nights', String(nights.length))}</div>
      <div className="list" style={{ gap: 0 }}>
        {nights.map(x => <div key={x.date} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small muted">{fmtDate(x.date, true)}</span>
          <b>{fmtDur(x.minutes * 60000)}</b>
        </div>)}
      </div>
    </> : <div className="empty"><div className="ico"><Icon name="moon" /></div>{t('No nights yet. Add one below.')}</div>}
    <h4 className="sec" style={{ marginTop: 18 }}>{t('Add a night\u2019s sleep')}</h4>
    <Row icon="sunrise" title={t('Woke up on')}>
      <input type="date" className="timef" value={date} max={todayISO()} onChange={e => setDate(e.target.value)} />
    </Row>
    <Row icon="moon" title={t('How long')}>
      <span className="row" style={{ gap: 6, alignItems: 'baseline' }}>
        <NumberField ref={hoursRef} value={hours} onChange={setHours} decimal={false} aria-label={t('Hours')}
          style={{ width: '4ch', textAlign: 'right' }} enterKeyHint="done" onFocus={onHoursFocus} />
        <span className="small muted">h</span>
        <NumberField value={mins} onChange={setMins} decimal={false} aria-label={t('Minutes')}
          style={{ width: '4ch', textAlign: 'right' }} enterKeyHint="done" />
        <span className="small muted">m</span>
      </span>
    </Row>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save night')}</Button>
  </>
}

/** Opens the readiness sheet. */
export function readinessSheet() {
  return useUI.getState().openSheet(close => <ReadinessSheet close={close} />)
}
