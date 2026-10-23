import { describe, it, expect } from 'vitest'
import {
  SPORT_POWERLIFTING, getSupportedFeatures, defaultRules, planAttempts, kgToLb, lbToKg,
  logMeetDay, validateWorkout, analyzeSession, nextSessionSuggestion
} from './powerlifting.js'

// Real catalogue ids, so the family matching is exercised against the exercise database the
// app actually resolves names through: 3593 barbell squat, 0029 barbell clean-grip front
// squat, 0025 barbell bench press, 0032 barbell deadlift, 0031 barbell curl (a control that
// belongs to no powerlift family).
const SQUAT = '3593'
const FRONT_SQUAT = '0029'
const BENCH = '0025'
const DEADLIFT = '0032'
const CURL = '0031'

// A routine slot as RoutineEdit and the plan files write it (routines.js / history.js
// defaultConfig): { id, sets, reps, weight } and only what else was configured.
const slot = (id, over = {}) => ({ id, sets: 3, reps: 5, weight: 0, mode: 'reps', ...over })

const gridOk = (w, inc) => Math.abs(w / inc - Math.round(w / inc)) < 1e-9

describe('sport contract', () => {
  it('names the sport and its three lifts', () => {
    expect(SPORT_POWERLIFTING).toEqual({ id: 'powerlifting', name: 'Powerlifting', lifts: ['squat', 'bench', 'deadlift'] })
  })
  it('states honestly that scoring is not implemented', () => {
    const f = getSupportedFeatures()
    expect(f).toEqual({ attemptPlanning: true, meetLogging: true, sessionAnalysis: true, workoutValidation: true, scoring: false })
  })
  it('ships conservative coaching defaults, every field overridable', () => {
    expect(defaultRules()).toEqual({
      incrementKg: 2.5,
      openerPct: { min: 0.90, max: 0.93 },
      secondPct: { min: 0.95, max: 1.00 },
      thirdPct: { min: 1.00, max: 1.05 },
      maxAttemptsPerLift: 3,
    })
  })
})

describe('planAttempts', () => {
  const TMS = { squat: 180, bench: 120, deadlift: 200 }

  it('plans three attempts per lift on the plate grid, strictly increasing, inside their bands', () => {
    const plan = planAttempts(TMS)
    const bands = [defaultRules().openerPct, defaultRules().secondPct, defaultRules().thirdPct]
    const purposes = ['opener', 'second', 'third']
    SPORT_POWERLIFTING.lifts.forEach(lift => {
      expect(plan[lift].length).toBe(3)
      plan[lift].forEach((a, i) => {
        expect(a.attempt).toBe(i + 1)
        expect(a.purpose).toBe(purposes[i])
        expect(gridOk(a.weightKg, 2.5)).toBe(true)
        // pct is the planned weight's real share of the training max: inside the band.
        expect(a.pct).toBeGreaterThanOrEqual(bands[i].min - 1e-9)
        expect(a.pct).toBeLessThanOrEqual(bands[i].max + 1e-9)
      })
      expect(plan[lift][0].weightKg).toBeLessThan(plan[lift][1].weightKg)
      expect(plan[lift][1].weightKg).toBeLessThan(plan[lift][2].weightKg)
    })
  })

  it('aims mid-band and rounds DOWN onto the grid', () => {
    const plan = planAttempts(TMS)
    // 180 × 0.915 = 164.7 → 162.5 (165 is 0.917, but 164.7 floors to 162.5, a loadable jump down)
    expect(plan.squat.map(a => a.weightKg)).toEqual([162.5, 175, 182.5])
    // 120 × 0.915 = 109.8 floors to 107.5, below the band floor (108) — so back up to 110
    expect(plan.bench.map(a => a.weightKg)).toEqual([110, 115, 122.5])
    expect(plan.deadlift.map(a => a.weightKg)).toEqual([182.5, 195, 205])
  })

  it('honours custom rules: a 5 kg grid and custom bands', () => {
    const plan = planAttempts({ squat: 100, bench: 100, deadlift: 100 }, { incrementKg: 5 })
    SPORT_POWERLIFTING.lifts.forEach(lift => {
      expect(plan[lift].map(a => a.weightKg)).toEqual([90, 95, 100])
      plan[lift].forEach(a => expect(gridOk(a.weightKg, 5)).toBe(true))
    })
    const custom = planAttempts({ squat: 200, bench: 200, deadlift: 200 }, { openerPct: { min: 0.80, max: 0.85 } })
    expect(custom.squat[0].weightKg).toBe(165)   // 200 × 0.825, already on the grid
    expect(custom.squat[0].pct).toBeGreaterThanOrEqual(0.80)
    expect(custom.squat[0].pct).toBeLessThanOrEqual(0.85)
  })

  it('keeps the ladder strictly increasing even on tiny training maxes', () => {
    const plan = planAttempts({ squat: 20, bench: 10, deadlift: 20 })
    SPORT_POWERLIFTING.lifts.forEach(lift => {
      const ws = plan[lift].map(a => a.weightKg)
      expect(ws[0]).toBeLessThan(ws[1])
      expect(ws[1]).toBeLessThan(ws[2])
      ws.forEach(w => expect(gridOk(w, 2.5)).toBe(true))
    })
    expect(plan.bench.map(a => a.weightKg)).toEqual([10, 12.5, 15])
  })

  it('throws a descriptive error for anything but positive finite training maxes', () => {
    const bad = [
      null,
      { squat: 180, bench: 0, deadlift: 200 },
      { squat: 180, bench: -5, deadlift: 200 },
      { squat: 180, bench: NaN, deadlift: 200 },
      { squat: 180, bench: Infinity, deadlift: 200 },
      { squat: 180, bench: '120', deadlift: 200 },   // numbers, not numeric strings
      { squat: 180 },                                 // a lift missing entirely
    ]
    bad.forEach(tms => expect(() => planAttempts(tms)).toThrow(/positive finite number|squat, bench and deadlift/))
    expect(() => planAttempts({ squat: 180, bench: 0, deadlift: 200 })).toThrow(/bench/)
  })
})

describe('unit helpers', () => {
  it('converts kg to lb for display, rounded to one decimal', () => {
    expect(kgToLb(100)).toBe(220.5)
    expect(kgToLb(2.5)).toBe(5.5)
    expect(kgToLb(0)).toBe(0)
  })
  it('converts lb to kg the same way', () => {
    expect(lbToKg(100)).toBe(45.4)
    expect(lbToKg(kgToLb(180))).toBe(180)            // a display round trip keeps 180 honest
  })
  it('refuses non-finite input rather than printing a fantasy', () => {
    expect(kgToLb(NaN)).toBeNull()
    expect(kgToLb('abc')).toBeNull()
    expect(lbToKg(Infinity)).toBeNull()
    expect(lbToKg('abc')).toBeNull()
    // null coerces to 0 the way Number() does everywhere in the app — a caller's bug reads as 0, not a crash
    expect(lbToKg(null)).toBe(0)
  })
})

describe('logMeetDay', () => {
  it('reads a meet with good, fail and skip attempts mixed through it', () => {
    const day = logMeetDay({
      squat: [{ weightKg: 100, result: 'good' }, { weightKg: 105, result: 'fail' }, { weightKg: 107.5, result: 'good' }],
      bench: [{ weightKg: 70, result: 'skip' }, { weightKg: 75, result: 'good' }],
      deadlift: [{ weightKg: 140, result: 'good' }, { weightKg: 145, result: 'fail' }, { weightKg: 150, result: 'good' }],
    })
    expect(day.squat).toEqual({ bestKg: 107.5, attemptsUsed: 3, succeeded: true })
    expect(day.bench).toEqual({ bestKg: 75, attemptsUsed: 1, succeeded: true })   // a skip is not an attempt
    expect(day.deadlift).toEqual({ bestKg: 150, attemptsUsed: 3, succeeded: true })
    expect(day.totalKg).toBe(332.5)
    expect(day.bombout).toBe(false)
  })

  it('flags a bombout when a lift was attempted and produced no good attempt', () => {
    const day = logMeetDay({
      squat: [{ weightKg: 150, result: 'good' }],
      bench: [{ weightKg: 80, result: 'fail' }, { weightKg: 82.5, result: 'fail' }],
      deadlift: [{ weightKg: 200, result: 'good' }],
    })
    expect(day.bench.succeeded).toBe(false)
    expect(day.bombout).toBe(true)
    expect(day.totalKg).toBeNull()                    // no total without a complete meet
  })

  it('counts an out-of-vocabulary result as an attempt taken, but not as a good one', () => {
    const day = logMeetDay({ squat: [{ weightKg: 100, result: 'no-lift' }], bench: [], deadlift: [] })
    expect(day.squat).toEqual({ bestKg: null, attemptsUsed: 1, succeeded: false })
    expect(day.bombout).toBe(true)
  })

  it('reads a lift skipped entirely as an incomplete meet, not a bombout', () => {
    const injured = logMeetDay({
      squat: [{ weightKg: 150, result: 'good' }],
      bench: [{ weightKg: 100, result: 'good' }],
      deadlift: [],                                   // injured: never approached the bar
    })
    expect(injured.deadlift).toEqual({ bestKg: null, attemptsUsed: 0, succeeded: false })
    expect(injured.bombout).toBe(false)
    expect(injured.totalKg).toBeNull()
    const wavedOff = logMeetDay({
      squat: [{ weightKg: 150, result: 'good' }],
      bench: [{ weightKg: 100, result: 'good' }],
      deadlift: [{ weightKg: 200, result: 'skip' }], // called it a day at the platform
    })
    expect(wavedOff.bombout).toBe(false)
    expect(wavedOff.totalKg).toBeNull()
  })

  it('is null-safe on junk input', () => {
    expect(logMeetDay(null)).toEqual({
      squat: { bestKg: null, attemptsUsed: 0, succeeded: false },
      bench: { bestKg: null, attemptsUsed: 0, succeeded: false },
      deadlift: { bestKg: null, attemptsUsed: 0, succeeded: false },
      totalKg: null,
      bombout: false,
    })
    const junk = logMeetDay({ squat: [null, {}, { weightKg: 'x', result: 'good' }, { weightKg: 100 }], bench: 'nope', deadlift: [{ result: 'good' }] })
    expect(junk.squat.attemptsUsed).toBe(0)
    expect(junk.squat.bestKg).toBeNull()
    expect(junk.bombout).toBe(false)
  })
})

describe('validateWorkout', () => {
  const routine = (...ex) => ({ id: 'r1', name: 'Meet prep', ex })

  it('passes a routine that trains the three lifts with sane numbers', () => {
    expect(validateWorkout(routine(slot(SQUAT), slot(BENCH), slot(DEADLIFT)))).toEqual({ ok: true, warnings: [] })
  })

  it('counts a front squat as the squat family', () => {
    expect(validateWorkout(routine(slot(FRONT_SQUAT), slot(BENCH), slot(DEADLIFT)))).toEqual({ ok: true, warnings: [] })
    // and an exercise that only exists by name, the way a freestyle slot may carry it
    expect(validateWorkout(routine(slot('x', { name: 'Front Squat' }), slot(BENCH), slot(DEADLIFT)))).toEqual({ ok: true, warnings: [] })
  })

  it('warns when no powerlift-family exercise is found at all', () => {
    const v = validateWorkout(routine(slot(CURL), slot('0031', { name: 'Incline curl' })))
    expect(v.ok).toBe(false)
    expect(v.warnings).toHaveLength(1)
    expect(v.warnings[0]).toMatch(/deadlift-pattern exercise found/)
  })

  it('warns when more than three competition-lift slots share one session', () => {
    const v = validateWorkout(routine(slot(SQUAT), slot(FRONT_SQUAT), slot(BENCH), slot(DEADLIFT)))
    expect(v.ok).toBe(false)
    expect(v.warnings[0]).toMatch(/4 competition-lift exercises/)
  })

  it('flags impossible values the way the app itself refuses them', () => {
    const v = validateWorkout(routine(slot(SQUAT, { sets: 0 }), slot(BENCH, { reps: -1 }), slot(DEADLIFT)))
    expect(v.ok).toBe(false)
    expect(v.warnings.some(w => /sets must be 1 or more/.test(w))).toBe(true)
    expect(v.warnings.some(w => /reps cannot be negative/.test(w))).toBe(true)
    // junk numbers are impossible too, not silently ignored
    const junk = validateWorkout(routine(slot(SQUAT, { sets: 'many' })))
    expect(junk.warnings.some(w => /sets must be 1 or more/.test(w))).toBe(true)
  })

  it('is null-safe on malformed input', () => {
    expect(validateWorkout(null)).toEqual({ ok: true, warnings: [] })
    expect(validateWorkout({})).toEqual({ ok: true, warnings: [] })
    expect(validateWorkout({ id: 'x', ex: 'nope' })).toEqual({ ok: true, warnings: [] })
    expect(validateWorkout({ id: 'x', ex: [] })).toEqual({ ok: true, warnings: [] })
    // junk slots inside a real list are skipped, the real ones still checked
    const mixed = validateWorkout(routine(null, 'squat?', slot(SQUAT, { sets: 0 }), slot(BENCH), slot(DEADLIFT)))
    expect(mixed.warnings).toHaveLength(1)
    expect(mixed.warnings[0]).toMatch(/sets must be 1 or more/)
  })
})

describe('analyzeSession', () => {
  // A finished workout in the shape finish-workout.js saves: entries with sets of
  // { w, r, done }, warm-up rows marked as such, an entry no powerlift family claims.
  const MEET_DAY = {
    d: '2026-03-01',
    entries: [
      {
        id: SQUAT, target: { sets: 3, reps: 5, weight: 140 },
        sets: [
          { w: 100, r: 5, done: true, warmup: true },   // prep, not the session
          { w: 140, r: 5, done: true },
          { w: 140, r: 4, done: true },
          { w: 145, r: 3, done: true },
          { w: 150, r: 5, done: false },                // never performed
        ],
      },
      {
        id: BENCH, target: { sets: 3, reps: 5, weight: 100 },
        sets: [{ w: 100, r: 5, done: true }, { w: 100, r: 5, done: true }, { w: 100, r: 5, done: true }],
      },
      { id: CURL, sets: [{ w: 40, r: 12, done: true }] },   // ignored: no family
      { id: DEADLIFT, sets: [{ w: 180, r: 3, done: true }, { w: 190, r: 1, done: true }] },
    ],
  }

  it("reads each family's done work: set counts, volume and the best estimated set", () => {
    const a = analyzeSession(MEET_DAY)
    expect(a.squat).toEqual({ sets: 3, volume: 1695, bestSet: { w: 140, r: 5 }, e1rm: 163.3 })   // Epley 140×5
    expect(a.bench).toEqual({ sets: 3, volume: 1500, bestSet: { w: 100, r: 5 }, e1rm: 116.7 })
    expect(a.deadlift).toEqual({ sets: 2, volume: 730, bestSet: { w: 180, r: 3 }, e1rm: 198 })  // 180×3 beats a 190 single
  })

  it("uses the caller's formula from onerm.js", () => {
    const benchOnly = { d: '2026-03-02', entries: [{ id: BENCH, sets: [{ w: 100, r: 5, done: true }] }] }
    expect(analyzeSession(benchOnly, 'brzycki').bench.e1rm).toBe(112.5)
    expect(analyzeSession(benchOnly).bench.e1rm).toBe(116.7)                                    // default Epley
  })

  it('reads an empty or malformed workout as an empty session', () => {
    const empty = { squat: { sets: 0, volume: 0, bestSet: null, e1rm: null },
                    bench: { sets: 0, volume: 0, bestSet: null, e1rm: null },
                    deadlift: { sets: 0, volume: 0, bestSet: null, e1rm: null } }
    expect(analyzeSession(null)).toEqual(empty)
    expect(analyzeSession({ d: '2026-03-03', entries: [] })).toEqual(empty)
    expect(analyzeSession({ entries: [null, {}, { id: CURL, sets: [{ w: 40, r: 8, done: true }] }] })).toEqual(empty)
  })
})

describe('nextSessionSuggestion', () => {
  // Two sessions of the same shape: the later one genuinely stronger in every family.
  const session = (s, b, d) => ({ d: '2026-03-01', entries: [
    { id: SQUAT, sets: [{ w: s, r: 5, done: true }] },
    { id: BENCH, sets: [{ w: b, r: 5, done: true }] },
    { id: DEADLIFT, sets: [{ w: d, r: 3, done: true }] },
  ] })
  const now = analyzeSession(session(140, 100, 180))
  const before = analyzeSession(session(135, 95, 170))

  it('suggests the increment when the estimated 1RM moved up on the last session', () => {
    const s = nextSessionSuggestion(now, defaultRules(), before)
    expect(s.increase).toBe(true)
    expect(s.reason).toMatch(/add 2\.5 kg/)
  })

  it('suggests repeating when there is no gain to point at', () => {
    const s = nextSessionSuggestion(before, defaultRules(), now)
    expect(s.increase).toBe(false)
    expect(s.reason).toMatch(/repeat/)
  })

  it('suggests repeating when no family has completed work, and holding without a comparison', () => {
    expect(nextSessionSuggestion(analyzeSession(null)).increase).toBe(false)
    expect(nextSessionSuggestion(now, defaultRules()).increase).toBe(false)   // work, but nothing to compare against
  })

  it('is deterministic: the same inputs always say the same thing', () => {
    const a = nextSessionSuggestion(now, defaultRules(), before)
    const b = nextSessionSuggestion(now, defaultRules(), before)
    expect(a).toEqual(b)
    expect(a.reason).toBe(b.reason)
  })
})
