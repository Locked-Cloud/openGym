import { describe, it, expect } from 'vitest'
import {
  emptyConstraints, addConstraint, updateConstraint, resolveConstraint, activeConstraints,
  constraintSummary, conflictFor, validateRoutine, suggestSubstitutes
} from './constraints.js'
import { EXDB, EXIDX } from './exercises.js'

// A stub catalogue in the real metadata shape — bp/tg/mg/sm exactly as the dataset spells
// them — so these tests do not depend on the 5,632-entry DB. The block at the bottom
// re-checks the same rules against real EXIDX entries, which is what proves the taxonomy
// mapping.
const EX = {
  squat: { id: 'squat', n: 'Back Squat', bp: 'upper legs', eq: 'barbell', tg: 'quads', mg: 'glutes', sm: ['glutes', 'hamstrings', 'adductors', 'core', 'lower back'] },
  curl: { id: 'curl', n: 'Biceps Curl', bp: 'upper arms', eq: 'dumbbell', tg: 'biceps', mg: 'forearms', sm: ['forearms'] },
  plank: { id: 'plank', n: 'Plank', bp: 'waist', eq: 'body weight', tg: 'abs', mg: 'core', sm: ['core', 'shoulders', 'quadriceps'] },
}
const lookup = id => EX[id] || null

describe('item lifecycle', () => {
  it('starts empty', () => {
    expect(emptyConstraints()).toEqual({ items: [] })
  })

  it('appends without mutating, fills defaults, and generates an id when none was given', () => {
    const before = [addConstraint([], { id: 'c1', label: 'One' })]
    const snapshot = [...before]
    const after = addConstraint(before, { label: 'Lower back', muscles: ['lower back'] })
    expect(before).toEqual(snapshot)                       // the input array is untouched
    expect(after).toHaveLength(2)
    expect(after[0]).toBe(before[0])                       // existing items are kept by reference
    expect(after[1].id).toMatch(/^c_[a-z0-9]+$/)
    expect(after[1]).toMatchObject({ label: 'Lower back', muscles: ['lower back'], status: 'active', source: 'self', startedOn: null, resolvedOn: null, requiresReview: false, note: '' })
  })

  it('accepts scalar muscle fields the way older configs stored them', () => {
    const [c] = addConstraint([], { label: 'X', muscles: 'quads' })
    expect(c.muscles).toEqual(['quads'])
  })

  it('merges a patch and nothing else', () => {
    const items = addConstraint([], { id: 'c1', label: 'One', muscles: ['quads'] })
    const after = updateConstraint(items, 'c1', { label: 'Knee', requiresReview: true })
    expect(after[0]).toEqual({ ...items[0], label: 'Knee', requiresReview: true })
    expect(items[0].label).toBe('One')                     // the stored item is never mutated
  })

  it('resolves an item, and activeConstraints drops it', () => {
    const items = addConstraint(addConstraint([], { id: 'c1', label: 'One' }), { id: 'c2', label: 'Two' })
    const after = resolveConstraint(items, 'c1', '2026-10-01')
    expect(after[0]).toMatchObject({ id: 'c1', status: 'resolved', resolvedOn: '2026-10-01' })
    expect(after[1].status).toBe('active')
    expect(activeConstraints(after).map(c => c.id)).toEqual(['c2'])
  })

  it('summarises for UI badges', () => {
    let items = addConstraint([], { id: 'c1', label: 'One', source: 'professional' })
    items = addConstraint(items, { id: 'c2', label: 'Two' })
    items = resolveConstraint(items, 'c1', '2026-10-01')
    expect(constraintSummary(items)).toEqual({ total: 2, active: 1, resolved: 1, professional: 1 })
    expect(constraintSummary([])).toEqual({ total: 0, active: 0, resolved: 0, professional: 0 })
  })
})

describe('lookup shapes', () => {
  it('accepts an accessor function, an id→entry map, and a bare entry', () => {
    const items = addConstraint([], { id: 'c1', label: 'Legs', bodyParts: ['upper legs'] })
    expect(conflictFor('squat', items, lookup)?.level).toBe('flagged')          // accessor function
    expect(conflictFor('squat', items, EX)?.level).toBe('flagged')              // plain id→entry map (EXIDX works this way)
    expect(conflictFor('anything', items, EX.squat)?.level).toBe('flagged')     // the entry is the answer itself
    expect(conflictFor('nope', items, lookup)).toBeNull()
    expect(conflictFor('squat', items, null)).toBeNull()
  })
})

describe('conflictFor levels', () => {
  it('blocks an exercise listed by id outright', () => {
    const items = addConstraint([], { id: 'c1', label: 'Bar work', exerciseIds: ['squat'] })
    expect(conflictFor('squat', items, lookup)).toEqual({
      level: 'blocked', constraintId: 'c1', constraintLabel: 'Bar work',
      matchedOn: { exerciseId: true }, source: 'self'
    })
    expect(conflictFor('curl', items, lookup)).toBeNull()
  })

  it('still blocks when the exercise resolves to nothing — the id was named explicitly', () => {
    const items = addConstraint([], { id: 'c1', label: 'Gone', exerciseIds: ['deleted'] })
    expect(conflictFor('deleted', items, lookup)?.level).toBe('blocked')
  })

  it('flags through the body part, reported in the exercise\'s own spelling', () => {
    const items = addConstraint([], { id: 'c1', label: 'Legs', bodyParts: ['Upper Legs'] })
    const v = conflictFor('squat', items, lookup)
    expect(v).toMatchObject({ level: 'flagged', constraintId: 'c1', matchedOn: { bodyPart: ['upper legs'] } })
  })

  it('flags through the primary target (tg) and the muscle group (mg)', () => {
    const tg = addConstraint([], { id: 'c1', label: 'Quads', muscles: ['quads'] })
    expect(conflictFor('squat', tg, lookup)).toMatchObject({ level: 'flagged', matchedOn: { primaryMuscle: ['quads'] } })
    const mg = addConstraint([], { id: 'c2', label: 'Glutes', muscles: ['glutes'] })
    expect(conflictFor('squat', mg, lookup)).toMatchObject({ level: 'flagged', matchedOn: { primaryMuscle: ['glutes'] } })
    // Case and surrounding whitespace on the constraint side must not hide a real overlap.
    expect(conflictFor('squat', addConstraint([], { id: 'c3', muscles: [' Quads '] }), lookup)?.level).toBe('flagged')
  })

  it('marks uncertain when only a secondary muscle (sm) overlaps', () => {
    const items = addConstraint([], { id: 'c1', label: 'Lower back', muscles: ['lower back'] })
    expect(conflictFor('squat', items, lookup)).toEqual({
      level: 'uncertain', constraintId: 'c1', constraintLabel: 'Lower back',
      matchedOn: { secondaryMuscle: ['lower back'] }, source: 'self'
    })
    // The plank never mentions the lower back: no overlap, no verdict — never a guess.
    expect(conflictFor('plank', items, lookup)).toBeNull()
  })

  it('ignores resolved constraints entirely', () => {
    const items = resolveConstraint(addConstraint([], { id: 'c1', label: 'Legs', bodyParts: ['upper legs'] }), 'c1', '2026-09-01')
    expect(conflictFor('squat', items, lookup)).toBeNull()
  })

  it('keeps the most severe level, and the first constraint among equals', () => {
    let items = addConstraint([], { id: 'c1', label: 'Lower back', muscles: ['lower back'] })        // uncertain on squat
    items = addConstraint(items, { id: 'c2', label: 'Legs', bodyParts: ['upper legs'] })            // flagged on squat
    items = addConstraint(items, { id: 'c3', label: 'Also legs', bodyParts: ['upper legs'] })       // flagged, later
    expect(conflictFor('squat', items, lookup)).toMatchObject({ level: 'flagged', constraintId: 'c2' })
    items = addConstraint(items, { id: 'c4', label: 'No squats', exerciseIds: ['squat'] })          // blocked beats all
    expect(conflictFor('squat', items, lookup)).toMatchObject({ level: 'blocked', constraintId: 'c4' })
  })

  it('carries the professional source through to the verdict', () => {
    const items = addConstraint([], { id: 'c1', label: 'PT plan', bodyParts: ['upper legs'], source: 'professional' })
    expect(conflictFor('squat', items, lookup)?.source).toBe('professional')
  })

  it('reads items built without addConstraint\'s defaults', () => {
    const raw = [{ id: 'c1', label: 'Quads', muscles: ['quads'], exerciseIds: [], status: 'active' }]
    expect(conflictFor('squat', raw, lookup)).toMatchObject({ level: 'flagged', constraintId: 'c1' })
  })
})

describe('validateRoutine', () => {
  const routine = { id: 'legs', name: 'Legs', ex: [{ id: 'squat', sets: 3, reps: 5 }, { id: 'plank', sets: 2 }, { id: 'gone', sets: 2 }] }
  const items = addConstraint([], { id: 'c1', label: 'Lower back', muscles: ['lower back'] })

  it('returns one row per slot, verdicts included', () => {
    const rows = validateRoutine(routine, items, lookup)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ slotIndex: 0, exId: 'squat', exName: 'Back Squat' })
    expect(rows[0].verdict).toMatchObject({ level: 'uncertain', constraintId: 'c1' })
    expect(rows[1]).toMatchObject({ slotIndex: 1, exId: 'plank', exName: 'Plank', verdict: null })
  })

  it('is null-safe for an exercise that no longer resolves', () => {
    const rows = validateRoutine(routine, items, lookup)
    expect(rows[2]).toEqual({ slotIndex: 2, exId: 'gone', exName: null, verdict: null })
  })

  it('handles an empty or missing routine', () => {
    expect(validateRoutine({ id: 'x', ex: [] }, items, lookup)).toEqual([])
    expect(validateRoutine(null, items, lookup)).toEqual([])
  })
})

describe('suggestSubstitutes', () => {
  const orig = { id: 'curl', n: 'Biceps Curl', bp: 'upper arms', tg: 'biceps', mg: 'forearms', sm: ['forearms'] }
  const family = [
    orig,
    { id: 'ez', n: 'EZ Bar Curl', bp: 'upper arms', tg: 'biceps', mg: 'brachialis', sm: ['brachialis', 'forearms'] },
    { id: 'hammer', n: 'Hammer Curl', bp: 'upper arms', tg: 'biceps', mg: 'forearms', sm: ['forearms'] },
    { id: 'reverse', n: 'Reverse Curl', bp: 'upper arms', tg: 'biceps', mg: 'forearms', sm: ['forearms', 'wrists'] },
    { id: 'concentration', n: 'Concentration Curl', bp: 'upper arms', tg: 'biceps', mg: 'forearms', sm: ['forearms'] },
    { id: 'wrist', n: 'Wrist Curl', bp: 'lower arms', tg: 'forearms', mg: 'forearms', sm: ['forearms'] },
    { id: 'pushdown', n: 'Triceps Pushdown', bp: 'upper arms', tg: 'triceps', mg: 'triceps', sm: ['triceps'] },
    { id: 'band', n: 'Band Curl', bp: 'upper arms', tg: 'biceps', mg: 'brachialis', sm: ['brachialis', 'forearms'] },
  ]
  const byId = id => family.find(e => e.id === id) || null

  it('ranks same-tg first, then same-mg, and carries shared muscles', () => {
    const subs = suggestSubstitutes('curl', [], byId, family)
    expect(subs.map(s => s.exId)).toEqual(['ez', 'hammer', 'reverse', 'concentration', 'band', 'wrist'])
    // pushdown shares only the body part — not the target or the muscle group — so it is out.
    expect(subs.some(s => s.exId === 'pushdown')).toBe(false)
    expect(subs[0]).toMatchObject({ exId: 'ez', name: 'EZ Bar Curl', verdict: null, sharedMuscles: ['biceps', 'forearms'] })
    expect(subs[5]).toMatchObject({ exId: 'wrist', sharedMuscles: ['forearms'] })       // the mg tier
  })

  it('drops blocked and flagged candidates, keeps uncertain ones with their verdict', () => {
    let items = addConstraint([], { id: 'c1', label: 'No concentration', exerciseIds: ['concentration'] })  // blocked
    items = addConstraint(items, { id: 'c2', label: 'Brachialis', muscles: ['brachialis'] })                // flags ez + band (mg)
    items = addConstraint(items, { id: 'c3', label: 'Wrists', muscles: ['wrists'] })                        // uncertain on reverse
    const subs = suggestSubstitutes('curl', items, byId, family)
    expect(subs.map(s => s.exId)).toEqual(['hammer', 'reverse', 'wrist'])
    expect(subs[0].verdict).toBeNull()
    expect(subs[1].verdict).toMatchObject({ level: 'uncertain', constraintId: 'c3', matchedOn: { secondaryMuscle: ['wrists'] } })
  })

  it('a body part every candidate shares filters as hard as an explicit block', () => {
    const items = addConstraint([], { id: 'c1', label: 'Upper arms off', bodyParts: ['upper arms'] })
    const subs = suggestSubstitutes('curl', items, byId, family)
    expect(subs.map(s => s.exId)).toEqual(['wrist'])       // the only candidate not on that body part
  })

  it('caps the list at 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: 'c' + i, n: 'Curl ' + i, bp: 'upper arms', tg: 'biceps', mg: 'forearms', sm: ['forearms'] }))
    const withOrig = id => (id === 'curl' ? orig : many.find(e => e.id === id) || null)
    expect(suggestSubstitutes('curl', [], withOrig, many)).toHaveLength(8)
  })

  it('has nothing to say when the original exercise cannot be resolved', () => {
    expect(suggestSubstitutes('nope', [], byId, family)).toEqual([])
  })
})

// The same rules against the real catalogue, through the real index — this is what proves
// the taxonomy mapping (bp keys, the tg/mg raw vocabulary, and the muscle-map overlay's
// primaries/secondaries on the entries that carry one).
describe('against the real catalogue (EXIDX)', () => {
  const SQUAT = '3593'   // barbell squat: bp upper legs, tg quads, mg glutes, sm incl. lower back
  const PLANK = '4170'   // bear plank: bp waist, tg abs, mg core, sm core/shoulders/quadriceps
  const CURL = '0294'    // dumbbell biceps curl: bp upper arms, tg biceps, mg forearms, sm forearms
  const BENCH = '0025'   // barbell bench press: raw tg pectorals / mg triceps + overlay primaries/secondaries

  it('flags the squat through body part, tg and mg', () => {
    expect(conflictFor(SQUAT, addConstraint([], { id: 'c1', label: 'Legs', bodyParts: ['upper legs'] }), EXIDX))
      .toMatchObject({ level: 'flagged', matchedOn: { bodyPart: ['upper legs'] } })
    expect(conflictFor(SQUAT, addConstraint([], { id: 'c2', muscles: ['quads'] }), EXIDX))
      .toMatchObject({ level: 'flagged', matchedOn: { primaryMuscle: ['quads'] } })
    expect(conflictFor(SQUAT, addConstraint([], { id: 'c3', muscles: ['glutes'] }), EXIDX))
      .toMatchObject({ level: 'flagged', matchedOn: { primaryMuscle: ['glutes'] } })
  })

  it('marks the squat uncertain on a secondary-muscle-only overlap, and the plank clean', () => {
    const items = addConstraint([], { id: 'c1', label: 'Lower back', muscles: ['lower back'] })
    expect(conflictFor(SQUAT, items, EXIDX)).toMatchObject({ level: 'uncertain', matchedOn: { secondaryMuscle: ['lower back'] } })
    expect(conflictFor(PLANK, items, EXIDX)).toBeNull()
  })

  it('blocks an explicitly listed id, with EXIDX as a map or a bare entry as the lookup', () => {
    const items = addConstraint([], { id: 'c1', label: 'No squats', exerciseIds: [SQUAT] })
    expect(conflictFor(SQUAT, items, EXIDX)).toMatchObject({ level: 'blocked', matchedOn: { exerciseId: true } })
    expect(conflictFor(SQUAT, items, EXIDX[SQUAT])).toMatchObject({ level: 'blocked' })
  })

  it('matches the curl through both of its primary fields (tg biceps, mg forearms)', () => {
    expect(conflictFor(CURL, addConstraint([], { id: 'c1', muscles: ['biceps'] }), EXIDX)?.level).toBe('flagged')
    expect(conflictFor(CURL, addConstraint([], { id: 'c2', muscles: ['forearms'] }), EXIDX)?.level).toBe('flagged')
  })

  it('reads the muscle-map overlay: bench primaries flag, overlay secondaries stay uncertain', () => {
    const chest = addConstraint([], { id: 'c1', muscles: ['chest'] })
    expect(conflictFor(BENCH, chest, EXIDX)).toMatchObject({ level: 'flagged', matchedOn: { primaryMuscle: ['chest'] } })
    const delts = addConstraint([], { id: 'c2', muscles: ['deltoids'] })
    expect(conflictFor(BENCH, delts, EXIDX)).toMatchObject({ level: 'uncertain', matchedOn: { secondaryMuscle: ['deltoids'] } })
  })

  it('suggests real substitutes from the biceps family: same tg first, blocked one gone, capped at 8', () => {
    const family = EXDB.filter(e => e.tg === 'biceps').slice(0, 12)
    const items = addConstraint([], { id: 'c1', label: 'Nope', exerciseIds: [family[1].id] })
    const subs = suggestSubstitutes(CURL, items, EXIDX, family)
    expect(subs).toHaveLength(8)
    expect(subs.some(s => s.exId === family[1].id)).toBe(false)
    expect(subs[0].exId).toBe(family[0].id)                 // catalogue order holds the ties
    subs.forEach(s => {
      expect(s.verdict).toBeNull()
      expect(s.name).toBeTruthy()
      expect(s.sharedMuscles).toContain('biceps')
    })
  })
})
