import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { BODYPARTS, CATALOGUE, EXIDX, exOr, allExercises } from '../lib/exercises.js'
import { suggestSubstitutes } from '../lib/constraints.js'
import { fmtDate, todayISO, exerciseNameText } from '../lib/format.js'
import { useSheetKeyboard, tappable } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'
import { Button, Row, Segmented, Switch } from './ui.jsx'

// The training-constraints management sheet (lib/constraints.js, opened from Settings → Workout
// and from the routine editor's warning card). Everything here is bookkeeping around what the
// engine reports: a constraint names body parts, muscles and exercise ids in the catalogue's own
// vocabulary, and the app points at the places the two agree. The wording never goes further —
// nothing in this file says an exercise is safe, and an "uncertain" verdict is always handed to
// a qualified professional rather than resolved by the UI.

// The muscles a constraint can name: the target (tg) and muscle-group (mg) vocabularies the
// catalogue itself uses — the exact spellings lib/constraints.js matches against — derived once
// and sorted. Both are in the locale packs already (they are the words every exercise row shows).
const MUSCLE_OPTIONS = [...new Set(CATALOGUE.flatMap(e => [e.tg, e.mg].filter(Boolean)))].sort()

const itemsOf = S => (Array.isArray(S.constraints?.items) ? S.constraints.items : [])

// Severity names as t() calls written out, so the source-string check finds them (the PLAN_COPY
// rule in sheets.jsx: copy parked in a map and passed in as a variable is invisible to it).
export const CONSTRAINT_LEVEL_LABEL = {
  blocked: () => t('Blocked'),
  flagged: () => t('Flagged'),
  uncertain: () => t('Uncertain'),
}
/** One verdict in words (lib/constraints.js matchOf): which dimension of the exercise the
 *  constraint met — overlap only, never a judgement about the exercise. */
export function constraintReason(verdict) {
  const m = verdict?.matchedOn || {}
  const parts = []
  if (m.exerciseId) parts.push(t('The constraint names this exercise'))
  if (m.bodyPart?.length) parts.push(t('Body part: {0}', m.bodyPart.map(t).join(', ')))
  if (m.primaryMuscle?.length) parts.push(t('Primary muscle: {0}', m.primaryMuscle.map(t).join(', ')))
  if (m.secondaryMuscle?.length) parts.push(t('Only a secondary muscle: {0}', m.secondaryMuscle.map(t).join(', ')))
  return parts.join(' · ')
}

// The one-line summary under a constraint's label: what it names, in the catalogue's words. The
// exercise count reuses the plain '{0} exercises' plural every pack already carries, rather than
// a key of this feature's own — the ru/uk/pl plural packs are filled by the translations pass.
const scopeOf = c => [
  (c.bodyParts || []).map(t).join(', '),
  (c.muscles || []).map(t).join(', '),
  (c.exerciseIds || []).length ? t('{0} exercises', c.exerciseIds.length) : null,
].filter(Boolean).join(' · ')

/* ---------- the list ---------- */
export function ConstraintsSheet({ close }) {
  const S = useStore(s => s.S)
  const active = itemsOf(S).filter(c => c && c.status === 'active')
  const resolved = itemsOf(S).filter(c => c && c.status !== 'active')
  const openForm = c => useUI.getState().openSheet(cl => <ConstraintForm existing={c} close={cl} />)
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <h3 style={{ margin: 0 }}>{t('Training constraints')}</h3>
      <Button size="sm" variant="ghost" onClick={close}>{t('Done')}</Button>
    </div>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('What you are training around. openGym compares it with the exercises in your plan and points at the overlap — it never says an exercise is safe, and it is no substitute for a qualified professional.')}</div>
    {active.length ? <div className="list">
      {active.map(c => <div key={c.id} className="item" {...tappable(() => openForm(c))}>
        <span className="lrow-i"><Icon name={c.source === 'professional' ? 'shield' : 'heart'} /></span>
        <div className="grow">
          <div className="tt">{c.label || t('Untitled')}</div>
          <div className="ss">{[
            c.source === 'professional' ? t('From a professional') : t('Your own'),
            c.startedOn ? fmtDate(c.startedOn, true) : null,
            scopeOf(c) || null,
          ].filter(Boolean).join(' · ')}</div>
        </div>
        {c.requiresReview && <span className="tag" style={{ color: 'var(--orange)', borderColor: 'var(--orange)' }}>{t('Review')}</span>}
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div> : <div className="empty"><div className="ico"><Icon name="heart" /></div>{t('Nothing you are training around right now.')}</div>}
    <div style={{ height: 10 }} />
    <Button variant="primary" icon="plus" onClick={() => openForm(null)}>{t('Add constraint')}</Button>
    {resolved.length > 0 && <>
      <h4 className="sec" style={{ marginTop: 18 }}>{t('Resolved')}</h4>
      <div className="list">
        {resolved.map(c => <div key={c.id} className="item" {...tappable(() => openForm(c))}>
          <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="check" /></span>
          <div className="grow">
            <div className="tt dim">{c.label || t('Untitled')}</div>
            <div className="ss">{[c.resolvedOn ? fmtDate(c.resolvedOn, true) : null, scopeOf(c) || null].filter(Boolean).join(' · ')}</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>)}
      </div>
    </>}
  </>
}
/** Opens the management sheet. */
export function constraintsSheet() {
  return useUI.getState().openSheet(close => <ConstraintsSheet close={close} />)
}

/* ---------- the add/edit form ---------- */
function ConstraintForm({ existing, close }) {
  const labelRef = useRef(null)
  const onLabelFocus = useSheetKeyboard(labelRef)
  const [label, setLabel] = useState(existing ? existing.label || '' : '')
  const [bodyParts, setBodyParts] = useState(existing ? [...(existing.bodyParts || [])] : [])
  const [muscles, setMuscles] = useState(existing ? [...(existing.muscles || [])] : [])
  const [note, setNote] = useState(existing ? existing.note || '' : '')
  const [source, setSource] = useState(existing?.source === 'professional' ? 'professional' : 'self')
  const [requiresReview, setRequiresReview] = useState(existing ? existing.requiresReview === true : false)
  const [startedOn, setStartedOn] = useState(existing ? existing.startedOn || '' : todayISO())
  const { addConstraint, updateConstraint, resolveConstraintAction } = useStore.getState()
  const toast = m => useUI.getState().toast(m)
  const toggle = (list, set, v) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v])
  const save = () => {
    const name = label.trim()
    if (!name) { toast(t('Give it a label')); return }
    const fields = { label: name, bodyParts, muscles, note: note.trim(), source, requiresReview, startedOn: startedOn || null }
    if (existing) updateConstraint(existing.id, fields)
    else addConstraint(fields)
    close()
    toast(existing ? t('Saved') : t('Constraint added'))
  }
  const listed = (existing?.exerciseIds || []).map(id => EXIDX[id]).filter(Boolean)
  return <>
    <h3>{existing ? t('Edit constraint') : t('Add constraint')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Name what you are training around, then pick the body parts or muscles it involves. Every plan that touches them is flagged for a look.')}</div>
    <input ref={labelRef} className="input" placeholder={t('Label')} maxLength={80} value={label} onFocus={onLabelFocus} onChange={e => setLabel(e.target.value)} />
    <Row icon="calendar" title={t('Started on')}>
      <input type="date" className="timef" value={startedOn} onChange={e => setStartedOn(e.target.value)} />
    </Row>
    <div className="small dim" style={{ margin: '12px 0 6px' }}>{t('Body parts')}</div>
    <div className="chips">
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bodyParts.includes(b) ? ' on' : '')} onClick={() => toggle(bodyParts, setBodyParts, b)}>{t(b)}</button>)}
    </div>
    <div className="small dim" style={{ margin: '12px 0 6px' }}>{t('Muscles')}</div>
    <div className="chips">
      {MUSCLE_OPTIONS.map(m => <button key={m} className={'chip' + (muscles.includes(m) ? ' on' : '')} onClick={() => toggle(muscles, setMuscles, m)}>{t(m)}</button>)}
    </div>
    <div style={{ height: 12 }} />
    <Row icon="personCircle" title={t('Who set it')}>
      <Segmented className="seg-inline"
        options={[{ value: 'self', label: t('Your own') }, { value: 'professional', label: t('From a professional') }]}
        value={source} onChange={setSource} />
    </Row>
    <Row icon="info" title={t('Needs professional review')}
      subtitle={t('Marks the constraint as one a qualified professional has not weighed in on.')}>
      <Switch aria-label={t('Needs professional review')} checked={requiresReview} onChange={setRequiresReview} />
    </Row>
    <textarea className="input" rows={3} maxLength={500} placeholder={t('Note (optional)')} value={note} onChange={e => setNote(e.target.value)} />
    {listed.length > 0 && <div className="muted small" style={{ margin: '10px 2px' }}>
      {t('Exercises named outright: {0}', listed.map(exerciseNameText).join(', '))}
    </div>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Add constraint')}</Button>
    {existing && existing.status === 'active' && <>
      <div style={{ height: 8 }} />
      <Button icon="check" onClick={() => { resolveConstraintAction(existing.id); close(); toast(t('Constraint resolved. It stays on the list, out of the way.')) }}>{t('Mark as resolved')}</Button>
    </>}
  </>
}

/* ---------- substitutions for one exercise ---------- */
// Same-muscle stand-ins for a flagged or blocked exercise (lib/constraints.js suggestSubstitutes).
// A candidate the constraints block or flag is not offered; one that only scores "uncertain" is,
// with the review wording attached. `onReplace(exId)` is the caller's existing replace path.
export function constraintSubstitutesSheet({ exId, exName, onReplace }) {
  return useUI.getState().openSheet(close => <ConstraintSubstitutes exId={exId} exName={exName} onReplace={onReplace} close={close} />)
}
function ConstraintSubstitutes({ exId, exName, onReplace, close }) {
  const S = useStore(s => s.S)
  const subs = suggestSubstitutes(exId, itemsOf(S), EXIDX, allExercises(S))
  return <>
    <h3 className="capitalize" style={{ marginBottom: 2 }}>{exName ?? exerciseNameText(exOr(exId))}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Exercises that share its muscles and pass your constraints. Sharing muscles is not a promise of an equivalent swap, and nothing here says a substitute is right for you — check with a qualified professional when unsure.')}</div>
    {subs.length ? <div className="list">
      {subs.map(s => <div key={s.exId} className="item">
        <div className="grow">
          <div className="tt capitalize">{s.name ?? s.exId}</div>
          {s.sharedMuscles.length > 0 && <div className="ss capitalize">{t('Works: {0}', s.sharedMuscles.map(t).join(', '))}</div>}
        </div>
        {s.verdict && <span className="tag" style={{ color: 'var(--orange)', borderColor: 'var(--orange)' }}>{t('Uncertain — needs professional review')}</span>}
        <Button size="sm" variant="tinted" onClick={() => { onReplace(s.exId); close() }}>{t('Replace')}</Button>
      </div>)}
    </div> : <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No same-muscle exercise passes your constraints.')}</div>}
  </>
}
