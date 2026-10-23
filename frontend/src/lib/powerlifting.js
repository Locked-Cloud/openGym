// Powerlifting — the first sport module, and the contract every sport after it follows.
//
// The contract a sport module keeps:
//   · a SPORT_* constant       — what the sport is and which lifts it is played on
//   · getSupportedFeatures()   — what the module can and cannot do, stated honestly
//   · defaultRules()           — the coaching/federation defaults, every field overridable
//   · pure functions over the app's REAL routine/workout shapes, never idealized ones
//
// Pure domain logic only: no store, no UI, no network. Kg is the working unit throughout
// because the competition lifts are loaded in metric plates; lb exists for display alone.
//
// Two honesty rules shape this file. Attempt-selection percentages are configurable coaching
// defaults, not guarantees — they say where a plan starts, not what a lifter can do, and they
// make no medical or peak-performance claim. And bodyweight scoring (Wilks / DOTS / Sinclair)
// is deliberately absent: coefficient tables must be transcribed from a verified primary
// source, never from memory. None was verified for this change, so `scoring` is false.
// TODO(scoring): transcribe the coefficients from a cited primary source (an IPF handbook or
// openpowerlifting.org's formula pages) before flipping `scoring` to true — until then the
// module refuses to guess a number a ranking could rest on.

import { estimate1RM, DEFAULT_FORMULA } from './onerm.js'
import { EXIDX } from './exercises.js'
import { metricRowsForEntry } from './history.js'
import { isSideSet } from './workout-model.js'

export const SPORT_POWERLIFTING = { id: 'powerlifting', name: 'Powerlifting', lifts: ['squat', 'bench', 'deadlift'] }
const LIFTS = SPORT_POWERLIFTING.lifts

/** What this module supports. `scoring` stays false until verified coefficients exist (see header). */
export function getSupportedFeatures() {
  return { attemptPlanning: true, meetLogging: true, sessionAnalysis: true, workoutValidation: true, scoring: false }
}

/**
 * The default rule set. These are conservative coaching defaults, not guarantees: bands say
 * where each attempt is usually planned, not what any lifter can or should lift. Every field
 * is overridable — a federation's quirks or a coach's own percentages belong in the caller's
 * rules object, never hardcoded here.
 */
export function defaultRules() {
  return {
    incrementKg: 2.5,                                  // the smallest competition plate step
    openerPct: { min: 0.90, max: 0.93 },               // a weight you can do for reps, always
    secondPct: { min: 0.95, max: 1.00 },               // around the training max
    thirdPct: { min: 1.00, max: 1.05 },                // the attempt that chases a PR
    maxAttemptsPerLift: 3,                             // every federation's attempt cap
  }
}

// Rules as this module can trust them: a caller's overrides win field by field, and any field
// that is not a usable number falls back to its default rather than poisoning a plan.
const pctBandOf = (own, def) => {
  const min = Number(own?.min)
  const max = Number(own?.max)
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min ? { min, max } : def
}
const rulesOf = rules => {
  const d = defaultRules()
  const r = rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : {}
  const inc = Number(r.incrementKg)
  const max = Math.round(Number(r.maxAttemptsPerLift))
  return {
    incrementKg: Number.isFinite(inc) && inc > 0 ? inc : d.incrementKg,
    openerPct: pctBandOf(r.openerPct, d.openerPct),
    secondPct: pctBandOf(r.secondPct, d.secondPct),
    thirdPct: pctBandOf(r.thirdPct, d.thirdPct),
    // The three bands name the three purposes, so the ladder stops at three attempts however
    // the rules are written (a fourth-attempt record slot is a federation rule not modeled yet).
    maxAttemptsPerLift: Number.isInteger(max) && max >= 1 && max <= 3 ? max : d.maxAttemptsPerLift,
  }
}

const round1 = v => Math.round(v * 10) / 10

// Exact by the international yard and pound agreement (1 lb = 0.45359237 kg exactly). Display
// only: competition plates are metric, so nothing in a plan is ever expressed in pounds.
const LB_PER_KG = 1 / 0.45359237
export function kgToLb(kg) {
  const v = Number(kg)
  return Number.isFinite(v) ? round1(v * LB_PER_KG) : null
}
export function lbToKg(lb) {
  const v = Number(lb)
  return Number.isFinite(v) ? round1(v * 0.45359237) : null
}

/**
 * Attempt plan for one meet, from training maxes in kg: per lift, `maxAttemptsPerLift` rows
 *   { attempt, weightKg, pct, purpose: 'opener' | 'second' | 'third' }
 *
 * Each attempt aims at the middle of its band — the conservative center of the coaching
 * default, not its edge — and is then loaded DOWN onto the increment grid, because a weight
 * you cannot plate is not a plan. `pct` is what the planned weight actually is of the training
 * max, so it can sit a rounding step below the aim. Two guards keep the ladder honest:
 *   · the band floor: if rounding down lands below the band's own minimum (a band narrower
 *     than the plate step on a small max), the weight comes back up to the lightest loadable
 *     weight inside the band
 *   · monotonicity: a second attempt below the opener is not a plan either, so each weight is
 *     kept at least one increment above the previous one — after which `pct` may exceed the
 *     band on very small maxes, which is the honest reading of what was computed.
 */
export function planAttempts(trainingMaxes, rules) {
  if (!trainingMaxes || typeof trainingMaxes !== 'object' || Array.isArray(trainingMaxes)) {
    throw new Error('planAttempts: training maxes must be an object with squat, bench and deadlift in kg')
  }
  LIFTS.forEach(lift => {
    const tm = trainingMaxes[lift]
    if (!Number.isFinite(tm) || tm <= 0) {
      throw new Error(`planAttempts: training max for "${lift}" must be a positive finite number in kg (got ${String(tm)})`)
    }
  })
  const r = rulesOf(rules)
  const bands = [r.openerPct, r.secondPct, r.thirdPct]
  const purposes = ['opener', 'second', 'third']
  const plan = {}
  LIFTS.forEach(lift => {
    const tm = trainingMaxes[lift]
    const attempts = []
    let prev = 0
    for (let i = 0; i < r.maxAttemptsPerLift; i++) {
      const band = bands[i]
      const aim = (band.min + band.max) / 2
      let w = Math.floor((tm * aim) / r.incrementKg + 1e-9) * r.incrementKg
      const floorW = Math.ceil((tm * band.min) / r.incrementKg - 1e-9) * r.incrementKg
      if (w < floorW) w = floorW
      if (w <= prev) w = prev + r.incrementKg
      attempts.push({
        attempt: i + 1,
        weightKg: round1(w),
        pct: Math.round((w / tm) * 1000) / 1000,
        purpose: purposes[i],
      })
      prev = w
    }
    plan[lift] = attempts
  })
  return plan
}

/**
 * Read a meet day back. `attemptLog` is per lift a list of { weightKg, result: 'good' |
 * 'fail' | 'skip' } — fewer than three rows is an injured lifter, an empty list a lift never
 * started. Per lift out: { bestKg, attemptsUsed, succeeded }; across the day:
 *   · totalKg — the sum of bests, but only a COMPLETE meet has a total: any lift with no good
 *     attempt (failed out, or never attempted) and the total is null, not a partial number
 *   · bombout — true when a lift was ATTEMPTED and produced no good attempt; a lift skipped
 *     entirely makes the meet incomplete without being a bombout
 *
 * A result outside the vocabulary ('no-lift', a typo) still counts as an attempt taken — the
 * log is what happened — but only 'good' scores; a row with no readable result, or no weight,
 * never happened and is dropped rather than guessed at. `rules` (e.g. the attempt cap a
 * federation allows) is accepted for contract completeness; every logged attempt is read
 * regardless, because a meet log is a record, not a prescription.
 */
export function logMeetDay(attemptLog, rules) {
  rulesOf(rules) // resolved for the contract; nothing here second-guesses the log itself
  const out = {}
  LIFTS.forEach(lift => {
    const rows = Array.isArray(attemptLog?.[lift]) ? attemptLog[lift] : []
    let best = null
    let used = 0
    rows.forEach(row => {
      if (!row || typeof row !== 'object') return
      const w = Number(row.weightKg)
      if (!Number.isFinite(w)) return
      if (typeof row.result !== 'string' || !row.result) return
      if (row.result !== 'skip') used++
      if (row.result === 'good' && (best == null || w > best)) best = w
    })
    out[lift] = { bestKg: best, attemptsUsed: used, succeeded: best != null }
  })
  const bombout = LIFTS.some(l => !out[l].succeeded && out[l].attemptsUsed > 0)
  const totalKg = LIFTS.every(l => out[l].succeeded) ? round1(LIFTS.reduce((s, l) => s + out[l].bestKg, 0)) : null
  return { ...out, totalKg, bombout }
}

// Which powerlift family an exercise belongs to, by name: the slot/entry id resolves through
// the exercise index (which user-defined exercises are registered into too), an explicit
// `name` wins when one is carried, and the id itself is searched as a last resort. Substring
// matching means every variation stays in its family — a front squat, a box squat, a close-grip
// bench press are all still that lift. Squat is tested first on purpose: "barbell bench squat"
// is a squat that touches a bench, not a bench press.
const nameOf = cfg => {
  const own = typeof cfg?.name === 'string' ? cfg.name : ''
  const id = typeof cfg?.id === 'string' ? cfg.id : ''
  return `${own || EXIDX[id]?.n || id || ''} ${id}`.toLowerCase()
}
const familyOf = cfg => {
  const text = nameOf(cfg)
  if (!text.trim()) return null
  if (text.includes('squat')) return 'squat'
  if (text.includes('bench press')) return 'bench'
  if (text.includes('deadlift')) return 'deadlift'
  return null
}

// A powerlifting session is not four squat variations; past this many family slots the volume
// is a programming question, not something this lens should wave through silently.
const FAMILY_SLOT_LIMIT = 3

/**
 * Powerlifting-lens checks on a routine ({ id, name, ex: [slots] }) — the shape RoutineEdit
 * and the plan files write. Malformed input is read as empty, never thrown on: a junk routine
 * has nothing to check. Returns { ok, warnings } flagging
 *   · no squat/bench/deadlift-pattern exercise at all (name-matched, case-insensitive, so
 *     'Front Squat' counts)
 *   · more than FAMILY_SLOT_LIMIT family exercises in one session (volume sanity)
 *   · impossible values on a slot — sets below 1, negative reps, or a present-but-unreadable
 *     number — mirroring the app's anti-invalid-values rules
 */
export function validateWorkout(routine) {
  const warnings = []
  const slots = Array.isArray(routine?.ex) ? routine.ex.filter(s => s && typeof s === 'object') : []
  // A routine with no readable slots has nothing to check — null, junk or an empty ex are not
  // "a session missing its squats", they are no session at all.
  if (!slots.length) return { ok: true, warnings }
  let familySlots = 0
  slots.forEach(slot => {
    const label = nameOf(slot).trim() || 'exercise'
    if (familyOf(slot)) familySlots++
    const sets = slot.sets
    if (sets != null && !(Number.isFinite(Number(sets)) && Number(sets) >= 1)) {
      warnings.push(`Impossible values on "${label}": sets must be 1 or more (got ${String(sets)})`)
    }
    const reps = slot.reps
    if (reps != null && !(Number.isFinite(Number(reps)) && Number(reps) >= 0)) {
      warnings.push(`Impossible values on "${label}": reps cannot be negative (got ${String(reps)})`)
    }
  })
  if (!slots.some(familyOf)) {
    warnings.push('No squat-, bench-press- or deadlift-pattern exercise found — a powerlifting session usually trains at least one of the three lifts')
  }
  if (familySlots > FAMILY_SLOT_LIMIT) {
    warnings.push(`${familySlots} competition-lift exercises in one session — more than ${FAMILY_SLOT_LIMIT} squat/bench/deadlift slots is a lot of heavy work for one day`)
  }
  return { ok: warnings.length === 0, warnings }
}

/**
 * Read a finished workout through the powerlifting lens. Entries are the shape finish-workout
 * saves ({ d, entries: [{ id, sets: [{ w, r, done }] }] }); rows are read the way the rest of
 * the app reads them (history.js metricRowsForEntry: completed work rows only, warm-ups out,
 * each side of a per-side row counted on its own), and every entry whose exercise names a
 * squat/bench/deadlift rolls into that family. Per family out:
 *   { sets, volume, bestSet: { w, r } | null, e1rm: number | null }
 * `e1rm` comes from onerm.js's estimate1RM with the caller's formula (default Epley); volume
 * is load × reps summed over done sets, in whatever unit the workout was logged in. Exercises
 * outside the three families are ignored; an empty workout reads as an empty session.
 */
export function analyzeSession(workout, formula = DEFAULT_FORMULA) {
  const out = {}
  LIFTS.forEach(l => { out[l] = { sets: 0, volume: 0, bestSet: null, e1rm: null } })
  const entries = Array.isArray(workout?.entries) ? workout.entries.filter(e => e && typeof e === 'object') : []
  entries.forEach(entry => {
    const family = familyOf(entry)
    if (!family) return
    const acc = out[family]
    metricRowsForEntry(entry, 'reps').forEach(row => {
      const sets = isSideSet(row) ? [row.sides.L, row.sides.R].filter(side => side?.done === true) : [row]
      sets.forEach(set => {
        const w = Number(set.w) || 0
        const r = Number(set.r) || 0
        acc.sets++
        acc.volume += w * r
        const est = estimate1RM(w, r, formula, set.rir ?? null)
        if (est != null && (acc.e1rm == null || est > acc.e1rm || (est === acc.e1rm && w > acc.bestSet.w))) {
          acc.e1rm = est
          acc.bestSet = { w, r: Math.round(r) }
        }
      })
    })
    acc.volume = round1(acc.volume)
  })
  return out
}

/**
 * What to do next session: { increase: boolean, reason: string }, deterministic and explained.
 *
 * This is a PLACEHOLDER for real periodization, and deliberately trivial: with completed work
 * in the session, the summed estimated 1RMs of the three families are compared against the
 * previous analysis (an optional third argument) — a gain suggests +incrementKg on the main
 * lift, everything else repeats the weights, and no completed work always repeats. No RPE/RIR
 * nuance, no fatigue model: when real periodization lands it replaces the comparison, not the
 * contract.
 */
export function nextSessionSuggestion(analysis, rules, previous = null) {
  const r = rulesOf(rules)
  const worked = LIFTS.some(l => (analysis?.[l]?.sets || 0) > 0)
  if (!worked) {
    return { increase: false, reason: 'No completed squat, bench or deadlift work this session — repeat the same weights next time.' }
  }
  const total = a => LIFTS.reduce((s, l) => s + (a?.[l]?.e1rm || 0), 0)
  const now = round1(total(analysis))
  if (!previous) {
    return { increase: false, reason: `Work logged (estimated 1RM ${now} kg summed), but no previous session to compare against — hold the weights and log one more session first.` }
  }
  const before = round1(total(previous))
  if (now > before) {
    return { increase: true, reason: `Estimated 1RM up over the last session (${now} kg vs ${before} kg summed) — add ${r.incrementKg} kg on the main lift.` }
  }
  return { increase: false, reason: `No estimated-1RM gain over the last session (${now} kg vs ${before} kg summed) — repeat the same weights.` }
}
