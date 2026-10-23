// The sleep-consistency signal (lib/readiness.js): the bands come from the person's own
// trailing nights — never a universal norm — and fewer than three nights of data says null,
// not an invented baseline. These pin the formula, the personal-average behaviour, the HC
// session→night mapping, the store's merge rules and the tolerance for malformed rows.
import { describe, expect, it } from 'vitest'
import {
  AVG_NIGHTS, MIN_NIGHTS, SLEEPS_CAP,
  normalizeSleep, mergeSleeps, sleepsFromSessions, nightsOf, readinessFromSleeps,
} from './readiness.js'

// 2026-10-23 is a Friday. day(n): the ISO day n days before it.
const day = n => new Date(Date.UTC(2026, 9, 23 - n)).toISOString().slice(0, 10)
const TODAY = day(0)
const night = (n, minutes, over = {}) => ({ id: 'x-' + n, date: day(n), minutes, ...over })
// Six ordinary 420-minute nights before the last one: average exactly 420.
const sixAt420 = [1, 2, 3, 4, 5, 6].map(n => night(n, 420))

describe('normalizeSleep', () => {
  it('keeps a valid row whole-numbered, and gives an id-less one its date', () => {
    expect(normalizeSleep({ id: 'hc-2026-10-23', date: '2026-10-23', minutes: 442.4 })).toEqual({ id: 'hc-2026-10-23', date: '2026-10-23', minutes: 442 })
    expect(normalizeSleep({ date: '2026-10-22', minutes: 400 })).toEqual({ id: 's_2026-10-22', date: '2026-10-22', minutes: 400 })
  })

  it('marks a hand-entered row manual, and only that', () => {
    expect(normalizeSleep({ id: 'm-1', date: '2026-10-22', minutes: 400, manual: true }).manual).toBe(true)
    expect(normalizeSleep({ id: 'm-1', date: '2026-10-22', minutes: 400, manual: 'yes' }).manual).toBeUndefined()
  })

  it('reads null for anything malformed', () => {
    for (const bad of [null, undefined, 'x', 7, {}, { minutes: 400 }, { date: '2026-10-22' },
      { date: '2026-10-22', minutes: 0 }, { date: '2026-10-22', minutes: -30 },
      { date: '2026-10-22', minutes: 'x' }, { date: '2026-10-22', minutes: 1441 },
      { date: '2026-10-2', minutes: 400 }, { date: 'not-a-day', minutes: 400 }]) {
      expect(normalizeSleep(bad)).toBeNull()
    }
    expect(normalizeSleep({ date: '2026-10-22', minutes: 1440 })).not.toBeNull()   // a whole day is the ceiling
  })
})

describe('readinessFromSleeps — the signal', () => {
  it('null, note "no-sleeps", with not one night', () => {
    expect(readinessFromSleeps([], TODAY)).toEqual({ score: null, band: null, lastNightMinutes: null, sevenDayAvgMinutes: null, baselineNights: 0, note: 'no-sleeps' })
    expect(readinessFromSleeps(undefined, TODAY).note).toBe('no-sleeps')
    expect(readinessFromSleeps([{ date: 'nope', minutes: 'x' }], TODAY).note).toBe('no-sleeps')
  })

  it('null until three nights exist — a baseline is never invented', () => {
    const one = readinessFromSleeps([night(0, 400)], TODAY)
    expect(one).toMatchObject({ score: null, band: null, sevenDayAvgMinutes: null, note: 'need-more-nights', lastNightMinutes: 400 })
    expect(one.baselineNights).toBe(0)
    const two = readinessFromSleeps([night(0, 400), night(1, 400)], TODAY)
    expect(two.note).toBe('need-more-nights')
    expect(two.baselineNights).toBe(1)
    // exactly three: the minimum, and it scores
    expect(readinessFromSleeps([night(0, 400), night(1, 400), night(2, 400)], TODAY)).toMatchObject({ score: 100, band: 'normal', sevenDayAvgMinutes: 400, baselineNights: 2, note: 'ok' })
    expect(MIN_NIGHTS).toBe(3)
  })

  it('bands: 90–110% of the personal average is normal, above high, below low', () => {
    // score is last night as a percentage of the average, capped at 100: the band, not the
    // number, carries the direction, so every above-average night reads 100.
    expect(readinessFromSleeps([night(0, 420), ...sixAt420], TODAY)).toMatchObject({ score: 100, band: 'normal', sevenDayAvgMinutes: 420 })
    expect(readinessFromSleeps([night(0, 380), ...sixAt420], TODAY)).toMatchObject({ score: 90, band: 'normal' })   // exactly 90%
    expect(readinessFromSleeps([night(0, 462), ...sixAt420], TODAY)).toMatchObject({ score: 100, band: 'normal' })  // exactly 110%, capped
    expect(readinessFromSleeps([night(0, 463), ...sixAt420], TODAY)).toMatchObject({ band: 'high', score: 100 })    // a hair over
    expect(readinessFromSleeps([night(0, 500), ...sixAt420], TODAY)).toMatchObject({ band: 'high', score: 100 })    // 119% of usual, capped
    expect(readinessFromSleeps([night(0, 377), ...sixAt420], TODAY)).toMatchObject({ band: 'low', score: 90 })      // a hair under
    expect(readinessFromSleeps([night(0, 210), ...sixAt420], TODAY)).toMatchObject({ band: 'low', score: 50 })
    expect(readinessFromSleeps([night(0, 0 + 1), ...sixAt420], TODAY).score).toBe(0)                                 // ~nothing: floor
  })

  it('a 5-hour-average person sleeping 5h is normal — no universal 8h norm anywhere', () => {
    const fiveHourPerson = [night(0, 300), ...[1, 2, 3, 4, 5, 6].map(n => night(n, 300))]
    expect(readinessFromSleeps(fiveHourPerson, TODAY)).toMatchObject({ score: 100, band: 'normal', sevenDayAvgMinutes: 300 })
    // and their ordinary 5h night is not "low" against someone else's 8h ideal
    expect(readinessFromSleeps([night(0, 330), ...[1, 2, 3, 4, 5, 6].map(n => night(n, 300))], TODAY)).toMatchObject({ band: 'normal', score: 100 })
  })

  it('the baseline is the nights BEFORE the last one, up to AVG_NIGHTS of them', () => {
    // eight nights: the average must use the seven before the last, not the last itself
    const eight = [night(0, 840), night(1, 400), night(2, 400), night(3, 400), night(4, 400), night(5, 400), night(6, 400), night(7, 700)]
    const r = readinessFromSleeps(eight, TODAY)
    expect(r.sevenDayAvgMinutes).toBe(443)      // (400×6 + 700) / 7 — the 840-minute last night is not in it
    expect(r.baselineNights).toBe(AVG_NIGHTS)
    expect(r.band).toBe('high')                 // 840 / 443 well over 110%
    expect(r.score).toBe(100)
    expect(AVG_NIGHTS).toBe(7)
  })

  it('rounds the average to the minute and the score to the whole', () => {
    // 400 + 401 before a 385-minute night: average 400.5 → 401, ratio 0.960… → 96
    const r = readinessFromSleeps([night(0, 385), night(1, 400), night(2, 401)], TODAY)
    expect(r.sevenDayAvgMinutes).toBe(401)
    expect(r.score).toBe(96)
    expect(r.band).toBe('normal')
  })

  it('sums the rows of one date, ignores nights after today, and is deterministic', () => {
    const twice = [night(0, 240), { id: 'y-0', date: day(0), minutes: 180 }, ...[1, 2].map(n => night(n, 420))]
    expect(readinessFromSleeps(twice, TODAY).lastNightMinutes).toBe(420)   // 240 + 180
    const future = [...[0, 1, 2].map(n => night(n, 420)), { id: 'z', date: '2026-10-24', minutes: 900 }]
    const a = readinessFromSleeps(future, TODAY)
    const b = readinessFromSleeps([...future].reverse(), TODAY)
    expect(a).toEqual(b)
    expect(a.lastNightMinutes).toBe(420)       // the future-dated row is not "last night"
  })
})

describe('nightsOf', () => {
  it('totals per day, newest first, malformed rows dropped', () => {
    const nights = nightsOf([night(3, 400), night(0, 420), night(3, 30), null, { date: 'x' }, night(1, 410)], TODAY)
    expect(nights).toEqual([{ date: day(0), minutes: 420 }, { date: day(1), minutes: 410 }, { date: day(3), minutes: 430 }])
  })
})

describe('sleepsFromSessions — Health Connect sessions as nights', () => {
  // 23:30 on day(1) to 07:00 on day(0): one night, dated the morning it ended on.
  const nightSession = n => ({
    id: 'uuid-' + n,
    start: Date.UTC(2026, 9, 23 - n, 23, 30),
    end: Date.UTC(2026, 9, 24 - n, 7, 0),
  })

  it('dates a session by the local day it ends on (tests run UTC, so this is that calendar)', () => {
    const rows = sleepsFromSessions([nightSession(1)], TODAY)
    expect(rows).toEqual([{ id: 'hc-' + day(0), date: day(0), minutes: 450 }])
  })

  it('sums the sessions of one morning (a night a watch split in two)', () => {
    const split = [
      { id: 'a', start: Date.UTC(2026, 9, 22, 23, 0), end: Date.UTC(2026, 9, 23, 1, 0) },
      { id: 'b', start: Date.UTC(2026, 9, 23, 2, 0), end: Date.UTC(2026, 9, 23, 7, 0) },
    ]
    expect(sleepsFromSessions(split, TODAY)).toEqual([{ id: 'hc-' + day(0), date: day(0), minutes: 420 }])
  })

  it('drops a session without real times, or ending after today, and tolerates junk input', () => {
    expect(sleepsFromSessions(null, TODAY)).toEqual([])
    expect(sleepsFromSessions([{}, { start: 1, end: 2 }, { id: 'x', start: 100, end: 50 }].map(x => x), TODAY)).toEqual([])
    const future = [{ id: 'f', start: Date.UTC(2026, 9, 23, 23, 0), end: Date.UTC(2026, 9, 24, 6, 0) }]
    expect(sleepsFromSessions(future, TODAY)).toEqual([])
  })
})

describe('mergeSleeps — the store import', () => {
  it('upserts by id+date and sorts newest first', () => {
    const out = mergeSleeps([night(2, 400), night(0, 420)], [night(1, 410), { ...night(0), minutes: 430 }])
    expect(out.map(x => x.date)).toEqual([day(0), day(1), day(2)])
    expect(out[0].minutes).toBe(430)            // the re-imported row replaced it
  })

  it('keeps an unchanged row as it stands, sync stamps included', () => {
    const stamped = { ...night(1, 400), _ts: 123, _f: { minutes: 123 } }
    const out = mergeSleeps([stamped], [night(1, 400)])
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(stamped)                // the very object, not a stampless copy
  })

  it('a hand-entered date takes no pulled row — correcting a night must not double it', () => {
    const hand = { id: 'm-' + day(0), date: day(0), minutes: 390, manual: true }
    const out = mergeSleeps([hand, night(1, 400)], [{ id: 'hc-' + day(0), date: day(0), minutes: 442 }])
    expect(out.filter(x => x.date === day(0))).toEqual([hand])
  })

  it('drops malformed rows on either side, and re-caps at SLEEPS_CAP keeping the newest', () => {
    expect(SLEEPS_CAP).toBe(90)
    const many = Array.from({ length: 95 + 10 }, (_, i) => night(i, 400))
    const out = mergeSleeps(many.slice(0, 95), many.slice(90))
    expect(out).toHaveLength(SLEEPS_CAP)
    expect(out[0].date).toBe(day(0))
    expect(out.at(-1).date).toBe(day(SLEEPS_CAP - 1))   // the oldest fell off
    expect(mergeSleeps([null, 'x', {}], [null])).toEqual([])
  })
})
