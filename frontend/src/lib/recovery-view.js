import { FATIGUE_STATES, LB_TO_KG } from './recovery.js'

/**
 * Select the consumer-facing fatigue state for one numeric recovery value.
 * Values below .25 are ready, .25 through .5 are recovering, and values above .5 are fatigued.
 * Keeping this boundary selector in production code prevents views and tests from drifting apart.
 *
 * @param {number} value Numeric fatigue value from fatigueOf().
 * @returns {'ready'|'recovering'|'fatigued'} The stable state label for the UI.
 */
export function fatigueStateOf(value) {
  return value < 0.25
    ? FATIGUE_STATES.READY
    : value <= 0.5
      ? FATIGUE_STATES.RECOVERING
      : FATIGUE_STATES.FATIGUED
}

/**
 * Shade rules that turn a fatigue value into the map's five steps — the fixed semantic
 * bands every fatigue-shaded map in the app keeps (red/orange/yellow via .hm-fatigue),
 * instead of renormalizing to the strongest muscle on screen. Lived inline in
 * views/Stats.jsx until the Muscles explorer needed the same bands.
 */
export const FATIGUE_LEVELS = [
  { at: 0, level: 0 },
  { at: 0.15, level: 1 },
  { at: 0.25, level: 2 },
  { at: 0.4, level: 3 },
  { at: 0.55, level: 4, exclusive: true },
]

/**
 * The user's own last registered bodyweight, in kg: the body-mass part of a bodyweight
 * exercise's load for fatigue and estimated effort, so both read the same set the same
 * way. Extracted from views/Stats.jsx so every fatigue consumer anchors identically.
 *
 * @param {object} S Profile state (unit + bodyweight log).
 * @returns {number|null} Last weigh-in in kg, or null when there is none.
 */
export function profileBodyweightKg(S) {
  const entries = S?.bodyweight || []
  if (!entries.length) return null
  const last = entries.slice().sort((a, b) => String(a.d).localeCompare(String(b.d))).at(-1)
  if (!last || !(last.w > 0)) return null
  return S.unit === 'lb' ? last.w * LB_TO_KG : last.w
}
