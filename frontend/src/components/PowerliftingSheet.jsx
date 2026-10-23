import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { SPORT_POWERLIFTING, defaultRules, planAttempts, logMeetDay, kgToLb, lbToKg } from '../lib/powerlifting.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'
import { Button, NumberField, Segmented } from './ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'

// The powerlifting sheet (lib/powerlifting.js, opened from Stats). Two halves over the same
// pure engine: a planner that turns three training maxes into a per-lift attempt ladder, and a
// meet log that reads a day back — bests, total, bomb-out. Kg is what the app stores (the
// competition lifts are loaded in metric plates); lb is display only, converted in and out of
// the inputs. The wording stays with the engine's honesty rules: percentages are where a plan
// starts, not a prediction of what a lifter can do, and nothing here says what anyone should
// lift.

const LIFTS = SPORT_POWERLIFTING.lifts

// Lift and attempt names as t() calls written out, so the source-string check finds them (the
// PLAN_COPY rule in sheets.jsx: copy parked in a map and passed in as a variable is invisible).
export const PL_LIFT_LABEL = { squat: () => t('Squat'), bench: () => t('Bench'), deadlift: () => t('Deadlift') }
const liftName = l => (PL_LIFT_LABEL[l] ? PL_LIFT_LABEL[l]() : l)
const PURPOSE_LABEL = { opener: () => t('Opener'), second: () => t('Second'), third: () => t('Third') }

// A weight between the store (kg) and the screen (the profile's unit). null passes through: an
// empty max or an unattempted weight is "nothing", not zero.
const showW = (kg, unit) => (kg == null ? null : unit === 'lb' ? kgToLb(kg) : kg)
const storeW = (shown, unit) => (shown == null ? null : unit === 'lb' ? lbToKg(shown) : shown)
const bothW = kg => `${fmtNum(kg)} kg · ${fmtNum(kgToLb(kg))} lb`
const pctTxt = p => `${fmtNum(Math.round(p * 1000) / 10)}%`

// The rules the engine actually reads (S.powerlifting.rules is null until the user overrides
// anything), and whether a rules object still says exactly what the defaults say — storing null
// again then keeps "not overridden" honest across a sync.
const RULE_FIELDS = ['incrementKg', 'openerPct', 'secondPct', 'thirdPct', 'maxAttemptsPerLift']
const sameAsDefaultRules = r => {
  const d = defaultRules()
  return RULE_FIELDS.every(k => JSON.stringify(r?.[k]) === JSON.stringify(d[k]))
}

/* ---------- the planner ---------- */
function Planner() {
  const S = useStore(s => s.S)
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const maxes = S.powerlifting?.trainingMaxes || {}
  const rules = S.powerlifting?.rules || defaultRules()
  // The max fields hold what was typed in the display unit, not the converted round-trip: a
  // pound profile typing "315" keeps seeing 315, and 142.9 kg is what the store quietly holds.
  const [drafts, setDrafts] = useState(() => ({
    squat: showW(maxes.squat, unit), bench: showW(maxes.bench, unit), deadlift: showW(maxes.deadlift, unit),
  }))
  const setMax = (lift, shown) => {
    setDrafts(d => ({ ...d, [lift]: shown }))
    useStore.getState().setPowerliftingMaxes({
      squat: storeW(drafts.squat, unit), bench: storeW(drafts.bench, unit), deadlift: storeW(drafts.deadlift, unit), [lift]: storeW(shown, unit),
    })
  }
  // Editing a rule writes the whole rules object through; back at the defaults it stores null
  // again (sameAsDefaultRules), so "not overridden" survives as the honest reading.
  const setRule = (patch) => {
    const next = { ...rules, ...patch }
    useStore.getState().setPowerliftingRules(sameAsDefaultRules(next) ? null : next)
  }
  const setBand = (k, edge, v) => setRule({ [k]: { ...rules[k], [edge]: Math.max(0, v) / 100 } })
  const bandRow = (k, label) => <div key={k} className="row between" style={{ padding: '4px 0', gap: 10 }}>
    <span className="muted">{label}</span>
    <span className="row" style={{ gap: 6, alignItems: 'center' }}>
      <NumberField decimal aria-label={`${label} · ${t('Minimum')}`} value={Math.round(rules[k].min * 1000) / 10}
        onChange={v => setBand(k, 'min', v)} style={{ width: '4.5ch', textAlign: 'end' }} />
      <span className="dim">–</span>
      <NumberField decimal aria-label={`${label} · ${t('Maximum')}`} value={Math.round(rules[k].max * 1000) / 10}
        onChange={v => setBand(k, 'max', v)} style={{ width: '4.5ch', textAlign: 'end' }} />
      <span className="dim small">%</span>
    </span>
  </div>

  const missing = LIFTS.filter(l => !(Number(maxes[l]) > 0))
  let plan = null
  let planError = null
  if (!missing.length) {
    try { plan = planAttempts(maxes, rules) } catch (e) { planError = e }
  }

  return <>
    <h4 className="sec" style={{ marginTop: 0 }}>{t('Training maxes')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {unit}</span></h4>
    {LIFTS.map(l => <div key={l} className="row between" style={{ padding: '4px 0' }}>
      <span>{liftName(l)}</span>
      <span className="row" style={{ gap: 6, alignItems: 'center' }}>
        <NumberField decimal nullable fit aria-label={`${liftName(l)} · ${t('Training max')}`} value={drafts[l] ?? ''}
          onChange={n => setMax(l, n)} />
        <span className="dim small">{unit}</span>
      </span>
    </div>)}
    <h4 className="sec">{t('Attempt rules')}</h4>
    <div className="row between" style={{ padding: '4px 0' }}>
      <span className="muted">{t('Plate increment')} <span className="dim">· kg</span></span>
      <NumberField decimal aria-label={t('Plate increment')} value={rules.incrementKg}
        onChange={v => setRule({ incrementKg: v })} style={{ width: '6ch', textAlign: 'end' }} />
    </div>
    {bandRow('openerPct', t('Opener'))}
    {bandRow('secondPct', t('Second'))}
    {bandRow('thirdPct', t('Third'))}
    <h4 className="sec">{t('Planned attempts')}</h4>
    {plan ? <>
      {LIFTS.map(l => <div key={l} style={{ marginBottom: 10 }}>
        <div className="small" style={{ fontWeight: 600, margin: '4px 0' }}>{liftName(l)}</div>
        {plan[l].map(a => <div key={a.attempt} className="row between small" style={{ padding: '3px 0' }}>
          <span className="muted">{PURPOSE_LABEL[a.purpose]()}</span>
          <span>{bothW(a.weightKg)} <span className="dim">· {pctTxt(a.pct)}</span></span>
        </div>)}
      </div>)}
      <div className="muted small">{t('Planned attempts are starting points, not predictions. Weights load onto the plate grid and stay inside your bands — what you take on the day is your call.')}</div>
    </> : <div className="muted small">{planError
      ? planError.message
      : t('Enter a training max above zero for {0} to plan attempts.', missing.map(liftName).join(', '))}</div>}
  </>
}

/* ---------- one attempt row of the meet editor ---------- */
// Holds its own display-unit draft: the store keeps kg, and feeding a converted value back
// through the input would rewrite "315" into "315.1" under the user's fingers. The draft only
// re-derives from the prop when the weight moved for a reason other than this row's own typing
// (a row above it removed, a meet reloaded) — `emitted` tells those apart.
function AttemptRow({ wKg, result, unit, onWeight, onResult, onRemove }) {
  const [shown, setShown] = useState(showW(wKg, unit))
  const emitted = useRef(null)
  if (wKg !== emitted.current) { emitted.current = wKg; setShown(showW(wKg, unit)) }
  const RESULTS = [
    { value: '', label: '–' },
    { value: 'good', label: t('Good') },
    { value: 'fail', label: t('Fail') },
    { value: 'skip', label: t('Skip') },
  ]
  return <div className="row" style={{ gap: 8, alignItems: 'center', padding: '3px 0' }}>
    <NumberField decimal nullable fit aria-label={t('Weight')} value={shown ?? ''}
      onChange={n => { setShown(n); emitted.current = storeW(n, unit); onWeight(emitted.current) }} />
    <span className="dim small">{unit}</span>
    <Segmented className="seg-inline" options={RESULTS} value={result || ''} onChange={onResult} />
    <button className="iconbtn sm" aria-label={t('Remove attempt')} onClick={onRemove}><Icon name="xmark" /></button>
  </div>
}

/* ---------- the meet editor ---------- */
function MeetForm({ existing, prefill, close }) {
  const S = useStore(s => s.S)
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const [date, setDate] = useState(existing?.date || todayISO())
  const [lifts, setLifts] = useState(() => {
    const init = prefill || existing?.lifts
    const out = {}
    LIFTS.forEach(l => { out[l] = Array.isArray(init?.[l]) ? init[l].slice() : [] })
    return out
  })
  const setLift = (l, rows) => setLifts(cur => ({ ...cur, [l]: rows }))
  const day = logMeetDay(lifts, S.powerlifting?.rules)   // live: every keystroke re-reads the day
  const save = () => {
    useStore.getState().saveMeet({ id: existing?.id, date: date || todayISO(), lifts })
    close()
    useUI.getState().toast(existing ? t('Saved') : t('Meet saved'))
  }
  const remove = () => confirmSheet({
    title: t('Delete this meet?'),
    message: t('The meet and its attempts are removed from this device and your sync.'),
    confirmText: t('Delete'),
    onConfirm: () => { useStore.getState().deleteMeet(existing.id); close(); useUI.getState().toast(t('Meet deleted')) },
  })
  return <>
    <h3>{existing ? t('Edit meet') : t('Log a meet')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Up to three attempts per lift. A total needs a good attempt on every lift; three misses on one lift is a bomb-out.')}</div>
    <div className="row between" style={{ marginBottom: 8 }}>
      <span className="muted">{t('Date')}</span>
      <input type="date" className="timef" value={date} onChange={e => setDate(e.target.value)} />
    </div>
    {LIFTS.map(l => <div key={l} style={{ margin: '10px 0' }}>
      <div className="row between small" style={{ fontWeight: 600, margin: '4px 0' }}>
        <span>{liftName(l)}</span>
        <span className="muted" style={{ fontWeight: 400 }}>
          {day[l].bestKg != null ? `${t('Best')} ${bothW(day[l].bestKg)}` : t('No good attempt')}
        </span>
      </div>
      {lifts[l].map((a, i) => <AttemptRow key={i} wKg={a.weightKg} result={a.result} unit={unit}
        onWeight={w => setLift(l, lifts[l].map((x, j) => (j === i ? { ...x, weightKg: w } : x)))}
        onResult={r => setLift(l, lifts[l].map((x, j) => (j === i ? { ...x, result: r } : x)))}
        onRemove={() => setLift(l, lifts[l].filter((_, j) => j !== i))} />)}
      {lifts[l].length < 3 && <Button size="sm" variant="ghost" icon="plus" onClick={() => setLift(l, [...lifts[l], { weightKg: null, result: '' }])}>{t('Add attempt')}</Button>}
    </div>)}
    <div className="row between" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 8, paddingTop: 10 }}>
      <span style={{ fontWeight: 600 }}>{t('Total')}</span>
      <span className="row" style={{ gap: 8, alignItems: 'center' }}>
        {day.bombout && <span className="tag" style={{ color: 'var(--orange)', borderColor: 'var(--orange)' }}>{t('Bomb-out')}</span>}
        <span>{day.totalKg != null ? bothW(day.totalKg) : <span className="muted">{t('Incomplete')}</span>}</span>
      </span>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {existing && <>
      <div style={{ height: 8 }} />
      <Button icon="trash" onClick={remove}>{t('Delete meet')}</Button>
    </>}
  </>
}

/* ---------- the sheet ---------- */
export function PowerliftingSheet({ close }) {
  const S = useStore(s => s.S)
  const rules = S.powerlifting?.rules || defaultRules()
  const meets = Array.isArray(S.powerlifting?.meets) ? S.powerlifting.meets : []
  // A fresh meet starts from the plan when there is one (the ladder as first guesses at the
  // weights); without usable maxes it opens empty and the weights are typed in by hand.
  const newMeet = () => {
    let prefill = null
    try {
      const plan = planAttempts(S.powerlifting?.trainingMaxes, rules)
      prefill = Object.fromEntries(LIFTS.map(l => [l, plan[l].map(a => ({ weightKg: a.weightKg, result: '' }))]))
    } catch { /* no usable maxes — an empty meet is the honest start */ }
    useUI.getState().openSheet(cl => <MeetForm prefill={prefill} close={cl} />)
  }
  const openMeet = m => useUI.getState().openSheet(cl => <MeetForm existing={m} close={cl} />)
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <h3 style={{ margin: 0 }}>{t('Powerlifting')}</h3>
      <Button size="sm" variant="ghost" onClick={close}>{t('Done')}</Button>
    </div>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Squat, bench and deadlift: plan attempt weights from your training maxes, then read a meet day back — bests, total, bomb-out. Weights are stored in kilograms; pounds are for looking at.')}</div>
    <Planner />
    <h4 className="sec" style={{ marginTop: 18 }}>{t('Meets')}</h4>
    {meets.length ? <div className="list">
      {meets.map(m => {
        const day = logMeetDay(m.lifts, rules)
        return <div key={m.id} className="item" {...tappable(() => openMeet(m))}>
          <span className="lrow-i"><Icon name="trophy" /></span>
          <div className="grow">
            <div className="tt">{fmtDate(m.date, true)}</div>
            <div className="ss">{day.totalKg != null
              ? t('Total: {0} kg', fmtNum(day.totalKg))
              : [t('Incomplete'), ...LIFTS.filter(l => day[l].attemptsUsed > 0).map(liftName)].join(' · ')}</div>
          </div>
          {day.bombout && <span className="tag" style={{ color: 'var(--orange)', borderColor: 'var(--orange)' }}>{t('Bomb-out')}</span>}
          <Icon name="chevronRight" className="chev" />
        </div>
      })}
    </div> : <div className="empty"><div className="ico"><Icon name="trophy" /></div>{t('No meets logged yet.')}</div>}
    <div style={{ height: 10 }} />
    <Button variant="primary" icon="plus" onClick={newMeet}>{t('Log a meet')}</Button>
  </>
}

/** Opens the powerlifting sheet. */
export function powerliftingSheet() {
  return useUI.getState().openSheet(close => <PowerliftingSheet close={close} />)
}
