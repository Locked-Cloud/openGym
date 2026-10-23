// Sleep-based readiness: how last night compares with the user's own recent nights.
//
// This is a sleep-consistency signal and nothing more. It is not a recovery measurement, not a
// fatigue score (lib/recovery.js models training fatigue and stays its own thing — the two are
// displayed side by side, never mixed), and it makes no medical, overtraining or "ready to lift"
// claim. There is no universal 8-hour norm in here on purpose: a 5-hour-average person who slept
// 5 hours reads as an ordinary night, because for them it is one. The only baseline is the
// person's own trailing nights, and with fewer than three nights of data there is no baseline at
// all — the answer is null, never an invented one.
//
// A night is one row, { id, date, minutes }, where `date` is the ISO day the sleeper WOKE UP on
// (a night from 23:30 to 07:00 belongs to the morning it ended on — that is also how sleep apps
// label "last night", and it keeps manual entry and Health Connect pulls on one convention).
// Rows with the same date are summed: a night some wearable records as two sessions, and a nap
// that landed on the same day, both count toward that day's total. Everything here is pure,
// null-safe and deterministic, with `today` injectable for tests.

import { isoOf, todayISO } from './format.js'

// How many recent nights the personal average is taken over, and how many nights must exist
// (the last one included) before anything is said at all.
export const AVG_NIGHTS = 7
export const MIN_NIGHTS = 3
// Last night within 90–110% of the personal average is an ordinary night; above is 'high',
// below is 'low'. The band talks about sleep consistency only — a 'low' band says "you slept
// less than you usually do", not "you are not recovered".
const LOW_AT = 0.9
const HIGH_AT = 1.1
// A night longer than a day is a mistake, not a night.
const NIGHT_MAX_MIN = 24 * 60

/** How many sleep rows the store keeps. Oldest fall off first (lib/sync-merge.js re-caps too). */
export const SLEEPS_CAP = 90

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// A real calendar day, not just the shape of one: "2026-10-99" matches the pattern and is not
// a date anyone woke up on.
const dayOf = v => {
  const s = String(v)
  if (!DAY_RE.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? s : null
}

/**
 * One sleep row as the store keeps it: { id, date, minutes } — minutes a whole number in
 * (0, 1440], date a real ISO day. A hand-entered row carries `manual: true` (it stands over a
 * Health Connect row for the same date; see mergeSleeps). Anything else — null, a missing or
 * malformed date, a zero or absurd duration — reads as null, never as a crash or a 0-minute
 * night. An id is kept as given; a row without one takes 's-' + its date.
 */
export function normalizeSleep(row) {
  if (!row || typeof row !== 'object') return null
  const date = dayOf(row.date)
  const minutes = Math.round(Number(row.minutes))
  if (!date || !(minutes > 0) || minutes > NIGHT_MAX_MIN) return null
  return {
    id: row.id != null && String(row.id) !== '' ? String(row.id) : 's_' + date,
    date,
    minutes,
    ...(row.manual === true ? { manual: true } : {}),
  }
}

/** The sleep rows of a state, oldest-written shapes and all: S.readiness.sleeps, or []. */
export function sleepsOf(S) {
  return Array.isArray(S?.readiness?.sleeps) ? S.readiness.sleeps : []
}

const sameNight = (a, b) => a.id === b.id && a.date === b.date && a.minutes === b.minutes && a.manual === b.manual

/**
 * The store's import: `incoming` merged into `current`, upserting by id+date, then newest-first
 * and capped again. An unchanged row is kept as it stands, sync stamps included — a Health
 * Connect re-pull that says what the store already holds must not age the night backwards. A
 * date the current list holds a hand-entered night for takes no pulled row: the hand entry
 * stands over the machine's for that day, so correcting one night does not double it the next
 * time the phone syncs.
 */
export function mergeSleeps(current, incoming, cap = SLEEPS_CAP) {
  const by = new Map()
  const key = n => n.id + '|' + n.date
  for (const row of Array.isArray(current) ? current : []) {
    const n = normalizeSleep(row)
    if (!n) continue
    by.set(key(n), row)   // as it stands, stamps and all
  }
  const handDates = new Set([...by.values()].filter(x => x && x.manual === true).map(x => x.date))
  for (const row of Array.isArray(incoming) ? incoming : []) {
    const n = normalizeSleep(row)
    if (!n || handDates.has(n.date)) continue
    const old = by.get(key(n))
    const oldN = old ? normalizeSleep(old) : null
    if (oldN && sameNight(oldN, n)) continue
    by.set(key(n), n)
  }
  return [...by.values()]
    .sort((a, b) => {
      const da = String(a?.date || ''), db = String(b?.date || '')
      return da > db ? -1 : da < db ? 1 : String(a?.id || '') < String(b?.id || '') ? -1 : 1
    })
    .slice(0, cap)
}

/**
 * Health Connect's sleep sessions (lib/health-sync.js readSleepSessions: [{ id, start, end }]
 * in ms) as nights: one row per day anything ended on, that day's sessions summed, dated the
 * morning the sleeper woke up. A session without real times, or ending after `today`, is left
 * out rather than guessed at — a session from the future is not a night yet.
 */
export function sleepsFromSessions(sessions, today = todayISO()) {
  const limit = dayOf(today) || todayISO()
  const mins = new Map()
  for (const s of Array.isArray(sessions) ? sessions : []) {
    const start = Number(s?.start), end = Number(s?.end)
    if (!(start > 0) || !(end > start)) continue
    const date = isoOf(new Date(end))
    if (!DAY_RE.test(date) || date > limit) continue
    mins.set(date, (mins.get(date) || 0) + Math.round((end - start) / 60000))
  }
  return [...mins.entries()]
    .filter(([, minutes]) => minutes > 0)
    .map(([date, minutes]) => ({ id: 'hc-' + date, date, minutes: Math.min(minutes, NIGHT_MAX_MIN) }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/**
 * The nights of a sleep list as one total per day, newest first: [{ date, minutes }]. Rows are
 * summed per date, and a date after `today` (a clock set back, a malformed sync) is ignored.
 */
export function nightsOf(sleeps, today = todayISO()) {
  const limit = dayOf(today) || todayISO()
  const per = new Map()
  for (const row of Array.isArray(sleeps) ? sleeps : []) {
    const n = normalizeSleep(row)
    if (!n || n.date > limit) continue
    per.set(n.date, (per.get(n.date) || 0) + n.minutes)
  }
  return [...per.entries()].map(([date, minutes]) => ({ date, minutes })).sort((a, b) => (a.date < b.date ? 1 : -1))
}

/**
 * The readiness signal of a sleep list, as Home shows it:
 *   { score, band, lastNightMinutes, sevenDayAvgMinutes, baselineNights, note }
 *
 * - score: last night as a whole-number percentage of the personal average, clamped to 0–100
 *   (a night at your average reads 100; the band, not the number, carries the direction).
 * - band: 'normal' within 90–110% of the personal average, 'high' above, 'low' below.
 * - sevenDayAvgMinutes: the average of the (up to) 7 nights BEFORE the last one, to the minute —
 *   the baseline is never stretched to include the night it judges. baselineNights says how
 *   many nights that average actually rests on (fewer than 7 in a young profile).
 * - score/band/sevenDayAvgMinutes null, note 'need-more-nights', until MIN_NIGHTS nights exist;
 *   note 'no-sleeps' when there is not one night. Nothing is invented from thin air.
 */
export function readinessFromSleeps(sleeps, today = todayISO()) {
  const nights = nightsOf(sleeps, today)
  if (!nights.length) return { score: null, band: null, lastNightMinutes: null, sevenDayAvgMinutes: null, baselineNights: 0, note: 'no-sleeps' }
  const [last, ...rest] = nights        // nightsOf is newest first; `rest` is the nights before it
  const prior = rest.slice(0, AVG_NIGHTS)
  if (prior.length < MIN_NIGHTS - 1 || !prior.length) {
    return { score: null, band: null, lastNightMinutes: last.minutes, sevenDayAvgMinutes: null, baselineNights: prior.length, note: 'need-more-nights' }
  }
  const avg = Math.round(prior.reduce((sum, x) => sum + x.minutes, 0) / prior.length)
  const ratio = last.minutes / avg
  const band = ratio > HIGH_AT ? 'high' : ratio < LOW_AT ? 'low' : 'normal'
  const score = Math.round(Math.max(0, Math.min(100, ratio * 100)))
  return { score, band, lastNightMinutes: last.minutes, sevenDayAvgMinutes: avg, baselineNights: prior.length, note: 'ok' }
}
