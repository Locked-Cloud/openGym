import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { BODYPARTS, allExercises, equipmentOf, searchExercises } from '../lib/exercises.js'
import { activeProfile, exAvailable } from '../lib/equipment.js'
import { bestWeightFor, workoutDay } from '../lib/history.js'
import { fmtNum, exCount, fmtDate, todayISO, weekKey, weekStartOf } from '../lib/format.js'
import { MUSCLES, MUSCLE_NAME, musclesOf, loadOfWeeklyPlan, loadOfWorkouts, muscleBalanceWindow } from '../lib/muscles.js'
import { fatigueOf } from '../lib/recovery.js'
import { fatigueStateOf, FATIGUE_LEVELS, profileBodyweightKg } from '../lib/recovery-view.js'
import { strengthExerciseRowsForMuscle } from '../lib/strength-exercises.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import BodyMap from './BodyMap.jsx'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'
import ExerciseViewToggle from './ExerciseViewToggle.jsx'
import { Button, Segmented } from './ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { useAutoMore } from '../lib/use-auto-more.js'
import { isFav, sortFavouritesFirst } from '../lib/favourites.js'

// The detail panel's windows — the same four, with the same values, the Stats muscle-balance
// card offers, so "Week" means the profile's week there and here alike.
const winOptions = () => [
  { value: 7, label: t('Week') }, { value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 0, label: t('All') },
]

// Stats' fatigue-map label mapping, kept identical so the panel's chip and the shaded map
// never disagree about the same value.
const fatigueLabel = value => {
  const state = fatigueStateOf(value)
  return t(state === 'ready' ? 'Ready' : state === 'recovering' ? 'Recovering' : 'Fatigued')
}

// One explorer for the Library and every catalogue picker. Supplying `onPick` turns
// a result into a selection; without it the explorer behaves like the normal Library.
export default function MuscleExplorer({ onPick, onDetail, onPlan }) {
  const S = useStore(s => s.S)
  const [selected, setSelected] = useState(null)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [eq, setEq] = useState('')
  const [shown, setShown] = useState(40)
  const [showAll, setShowAll] = useState(false)   // ignore the active equipment profile for this session
  const [view, setView] = useState('front')       // which figure the phone stage shows
  const [fatigueOn, setFatigueOn] = useState(true)// shade the stage by recovery state
  const [win, setWin] = useState(7)               // the detail panel's stats window
  const [mq, setMq] = useState('')                // muscle search, over the chips and the map
  const moreRef = useAutoMore(() => setShown(s => s + 40))
  // Same rule as the Library and the picker: the active equipment profile narrows the catalogue
  // (and the per-muscle counts) unless the user asks for everything.
  const profile = activeProfile(S)
  const catalog = useMemo(() => {
    const all = allExercises(S)
    return (profile && !showAll) ? all.filter(e => exAvailable(S, e)) : all
  }, [S.customEx, S.equipFilterOn, S.activeEquipId, S.equipProfiles, showAll])
  const counts = useMemo(() => Object.fromEntries(MUSCLES.map(m => [m,
    catalog.filter(e => musclesOf(e)[m]).length
  ])), [catalog])
  const exById = useMemo(() => Object.fromEntries(catalog.map(e => [e.id, e])), [catalog])
  // Recovery shading: the same data, options and bands as the Stats fatigue map (fatigueOf +
  // FATIGUE_LEVELS + the profile's own bodyweight), so the two maps never disagree about a
  // muscle. `now` is fixed per mount — the scan keys on it, and re-renders alone (typing in a
  // search) must not re-run it against a marginally different clock.
  const now = useMemo(() => Date.now(), [])
  const fatigueOpts = useMemo(() => ({ unit: S.unit, bodyweightKg: profileBodyweightKg(S) }), [S.unit, S.bodyweight])
  const fatigue = useMemo(() => fatigueOf(S.workouts, now, fatigueOpts), [S.workouts, now, fatigueOpts])
  // Which muscles the search leaves: it filters the chips below the stage and outlines the
  // matching regions on the map itself. A plain case-insensitive name filter — the localized
  // name first, the English key alongside so a query still finds an untranslated pack entry.
  const matched = useMemo(() => {
    const needle = mq.trim().toLowerCase()
    if (!needle) return null
    return new Set(MUSCLES.filter(m =>
      t(MUSCLE_NAME[m]).toLowerCase().includes(needle) || MUSCLE_NAME[m].toLowerCase().includes(needle)))
  }, [mq])
  const chipMuscles = matched ? MUSCLES.filter(m => matched.has(m)) : MUSCLES
  const pick = muscle => { setSelected(muscle === selected ? null : muscle); setEq(''); setShown(40) }
  // The panel's window — Stats' muscle-balance shape exactly: the week branch follows the
  // profile's first weekday, the day counts are rolling, 0 is everything.
  const ws = weekStartOf(S)
  const weekly = win === 7
  const inWin = useMemo(() => weekly
    ? S.workouts.filter(workout => workoutDay(workout) && weekKey(workoutDay(workout), ws) === weekKey(todayISO(), ws))
    : muscleBalanceWindow(S.workouts, win, now, todayISO(), ws),
  [S.workouts, S.weekStart, weekly, win, now, ws])
  // Completed vs planned reuses the weekly-volume card's own pair (loadOfWorkouts over the
  // window against loadOfWeeklyPlan); the e1RM rows reuse the Strength view's per-muscle
  // helper, pointed at the same window's workouts so the selector moves these numbers too.
  const doneLoad = useMemo(() => loadOfWorkouts(inWin), [inWin])
  const plannedLoad = useMemo(() => (weekly ? loadOfWeeklyPlan(S) : {}), [S, weekly])
  const e1Rows = useMemo(() => (selected
    ? strengthExerciseRowsForMuscle({ ...S, workouts: inWin }, now, selected) : []),
  [S, inWin, now, selected])
  const bestRow = e1Rows[0] || null
  const bestEx = bestRow ? exById[bestRow.id] : null
  const doneSets = selected ? Math.round((doneLoad[selected] || 0) * 10) / 10 : 0
  const plannedSets = selected ? Math.round((plannedLoad[selected] || 0) * 10) / 10 : 0
  const targeted = selected ? catalog.filter(e => musclesOf(e)[selected]) : []
  const base = searchExercises(targeted.filter(e => !bp || e.bp === bp), q)
  const eqOpts = equipmentOf(base)
  const eqOn = eqOpts.includes(eq) ? eq : ''
  // Favourites float to the top of whatever the filters left (issue #6), the rest keeps its order.
  const exercises = sortFavouritesFirst(eqOn ? base.filter(e => e.eq === eqOn) : base, S)
  const choose = ex => onPick ? onPick(ex) : onDetail(ex)
  // The live count and the × of the Library's search (#338): the count while a search or a
  // filter narrows the muscle's list, the × while there is text.
  const narrowed = !!(q.trim() || bp || eqOn)
  const stage = {
    load: fatigueOn ? fatigue : {},
    thresholds: fatigueOn ? FATIGUE_LEVELS : undefined,
    selected, matched, onMuscle: pick, body: S.body,
  }

  return <>
    {profile && <div className="small dim row" style={{ margin: '-4px 2px 10px', gap: 6, alignItems: 'center' }}>
      <Icon name="kettlebell" style={{ fontSize: 13 }} />
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <button className="chip nocap" style={{ marginInlineStart: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={() => { setShowAll(v => !v); setEq(''); setShown(40) }}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </button>
    </div>}

    <div className="row" style={{ gap: 8, marginBottom: 10 }}>
      <Segmented className="mx-view-seg" value={view} onChange={setView}
        options={[{ value: 'front', label: t('Front view') }, { value: 'back', label: t('Back view') }]} />
      <button className={'chip' + (fatigueOn ? ' on' : '')} style={{ marginInlineStart: 'auto' }}
        aria-pressed={fatigueOn} aria-label={t('Fatigue')} onClick={() => setFatigueOn(v => !v)}>
        <Icon name="flame" style={{ fontSize: 13, marginInlineEnd: 4 }} />{t('Fatigue')}
      </button>
    </div>

    <div className="search-row" style={{ marginBottom: 10 }}><div className={'search' + (mq ? ' has-clear' : '')}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search muscles…')} value={mq} aria-label={t('Search muscles…')}
        onChange={e => setMq(e.target.value)} />
      {mq && <button className="clear" onClick={() => setMq('')} aria-label={t('Clear')}><Icon name="xmark" /></button>}
    </div></div>

    <div className="card">
      {/* One figure on phones (the segmented control above), both figures side by side in the
          desktop shell — CSS picks which map is on screen (index.css, ≥1000px). */}
      <BodyMap className={'tappable mx-onemap' + (fatigueOn ? ' hm-fatigue' : '')} view={view} {...stage} />
      <BodyMap className={'tappable mx-bothmap' + (fatigueOn ? ' hm-fatigue' : '')} {...stage} />
      {fatigueOn && <div className="hm-legend hm-fatigue" aria-label={t('Fatigue')}>
        <span>{t('Fatigued')}</span><div className="hm-c l4" />
        <span>{t('Recovering')}</span><div className="hm-c l2" />
        <span>{t('Ready')}</span><div className="hm-c l0" />
      </div>}
      <div className="chips" style={{ marginTop: 10 }}>
        {chipMuscles.map(m => <button key={m} className={'chip' + (selected === m ? ' on' : '')}
          aria-pressed={selected === m} onClick={() => pick(m)}>
          {t(MUSCLE_NAME[m])} <span className="dim">{counts[m]}</span>
        </button>)}
        {matched && !chipMuscles.length && <span className="muted small">{t('No match')}</span>}
      </div>
    </div>

    {/* The detail panel: the stage's selection turned into numbers, announced as it appears. */}
    {selected && <div className="card" role="status" data-muscle-panel data-muscle={selected}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t(MUSCLE_NAME[selected])}</h2>
        <span className={'mx-state ' + fatigueStateOf(fatigue[selected] || 0)}>{fatigueLabel(fatigue[selected] || 0)}</span>
      </div>
      <Segmented className="seg-range" value={win} onChange={setWin} options={winOptions()} />
      <div className="row" style={{ gap: 10, marginTop: 10 }}>
        <div className="mx-stat">
          <div className="l">{t('Hard sets')}</div>
          <div className="v" aria-label={weekly
            ? `${t('Completed')} ${t('{0} sets', fmtNum(doneSets))} · ${t('Planned')} ${t('{0} sets', fmtNum(plannedSets))}`
            : t('{0} sets', fmtNum(doneSets))}>
            {fmtNum(doneSets)}{weekly && <> <span className="dim" style={{ fontSize: 14, fontWeight: 400 }}>/ {fmtNum(plannedSets)}</span></>}
          </div>
        </div>
        <div className="mx-stat">
          <div className="l">{t('Est. 1RM')}</div>
          <div className="v">{bestRow ? <>{fmtNum(bestRow.current)} <span className="dim" style={{ fontSize: 14, fontWeight: 400 }}>{S.unit}</span></> : '–'}</div>
        </div>
      </div>
      {bestRow ? <>
        {/* The best-e1RM exercise for the muscle, hero row first — a tap opens it wherever this
            explorer's rows already open exercises (the detail sheet here, a pick in a picker). */}
        <h4 className="sec" style={{ margin: '12px 0 4px' }}>{t('Best exercise')}</h4>
        <div className="item" {...tappable(bestEx ? () => choose(bestEx) : undefined)}>
          {bestEx && <Thumb ex={bestEx} />}
          <div className="grow">
            <div className={bestEx ? exerciseNameClass(bestEx) : undefined}>{bestRow.name}</div>
            <div className="ss">{t('Est. 1RM')}: {fmtNum(bestRow.est)} {S.unit} · {fmtDate(bestRow.estDate, true)}</div>
          </div>
          {bestEx && <Icon name="chevronRight" className="chev" />}
        </div>
        {e1Rows.length > 1 && <>
          <h4 className="sec" style={{ margin: '12px 0 4px' }}>{t('Top exercises')}</h4>
          <div className="list">
            {e1Rows.slice(1, 4).map(row => {
              const ex = exById[row.id]
              const best = bestWeightFor(S, row.id)
              return <div key={row.id} className="item" {...tappable(ex ? () => choose(ex) : undefined)}>
                {ex && <Thumb ex={ex} />}
                <div className="grow"><div className={ex ? exerciseNameClass(ex) : undefined}>{row.name}</div></div>
                {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
              </div>
            })}
          </div>
        </>}
      </> : <div className="muted small" style={{ marginTop: 10 }}>{t('No exercises with an estimated 1RM yet.')}</div>}
    </div>}

    {!selected && onPick && <div className="empty"><div className="ico"><Icon name="figureStrength" /></div>{t('Choose a muscle to see exercises that train it.')}</div>}

    {selected && <>
      <div className="row between" style={{ margin: '2px 0 10px' }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Exercises for {0}', t(MUSCLE_NAME[selected]))}</h4>
        <Button size="sm" variant="ghost" onClick={() => pick(selected)}>{t('Clear selection')}</Button>
      </div>
      <div className="search-row" style={{ marginBottom: 10 }}><div className={'search' + (narrowed ? ' has-count' : '') + (q ? ' has-clear' : '')}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input className="input" placeholder={t('Search…')} value={q} onChange={e => { setQ(e.target.value); setShown(40) }} />
        {narrowed && <span className="search-count" role="status" aria-label={exCount(exercises.length)}>{fmtNum(exercises.length)}</span>}
        {q && <button className="clear" onClick={() => { setQ(''); setShown(40) }} aria-label={t('Clear')}><Icon name="xmark" /></button>}
      </div><ExerciseViewToggle /></div>
      {/* Changing body part keeps the equipment filter (issue #71, same rule as Library): the
          eqOn fallback above drops it only for this view if the new body part has nothing under
          it, without forgetting the choice. "All" clears it, since it spans every body part. */}
      <div className="chips" style={{ marginBottom: eqOpts.length > 1 ? 8 : 12 }}>
        <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setEq(''); setShown(40) }}>{t('All')}</button>
        {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(40) }}>{t(b)}</button>)}
      </div>
      {eqOpts.length > 1 && <div className="chips" style={{ marginBottom: 12 }}>
        <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(40) }}>{t('Any equipment')}</button>
        {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(40) }}>{t(x)}</button>)}
      </div>}
      <div className={'list' + (S.exerciseView === 'cards' ? ' ex-grid' : '')}>
        {exercises.slice(0, shown).map(e => {
          const best = bestWeightFor(S, e.id)
          const primary = musclesOf(e)[selected] === 1
          return <div key={e.id} className="item" {...tappable(() => choose(e))}>
            <Thumb ex={e} />
            <div className="grow"><div className={`tt ${exerciseNameClass(e)}`}>{isFav(S, e.id) && <Icon name="starFill" className="fav-star" />}{exerciseNameFor(e)}</div><div className="ss">{t(primary ? 'Primary target' : 'Also trains')} · <span className="capitalize">{t(MUSCLE_NAME[e.tg] || e.tg || e.bp)} · {t(e.eq)}</span></div></div>
            {onPick ? <Icon name="plus" className="chev" /> : <>
              {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
              <Button size="sm" variant="tinted" icon="plus" onClick={ev => { ev.stopPropagation(); onPlan(e) }}>{t('Plan')}</Button>
            </>}
          </div>
        })}
        {exercises.length === 0 && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match')}</div>}
      </div>
      {exercises.length > shown && <><div style={{ height: 10 }} /><Button ref={moreRef} onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
    </>}
  </>
}
