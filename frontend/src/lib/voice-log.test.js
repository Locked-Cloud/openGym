import { describe, expect, it } from 'vitest'
import { parseVoiceCommand } from './voice-log.js'

// The grammar the workout mic understands (lib/voice-log.js). The core safety rule under test
// throughout: an ambiguous or half-understood utterance is { type: 'unknown' } with the raw
// text — never a guessed weight, reps or rest.

describe('parseVoiceCommand', () => {
  it('parses reps and weight said as words with a unit', () => {
    const r = parseVoiceCommand('five reps at one hundred kilos')
    expect(r.actions).toEqual([{ type: 'reps', value: 5 }, { type: 'weight', value: 100, unit: 'kg' }])
    expect(r.response).toBe('reps=5 · weight=100kg')
  })

  it('parses the terse digit form, where a bare weight after @ carries no unit', () => {
    const r = parseVoiceCommand('5 @ 100')
    expect(r.actions).toEqual([{ type: 'reps', value: 5 }, { type: 'weight', value: 100 }])
    expect(r.response).toBe('reps=5 · weight=100')
  })

  it('accepts x as the separator too ("8 x 30")', () => {
    expect(parseVoiceCommand('8 x 30').actions).toEqual([{ type: 'reps', value: 8 }, { type: 'weight', value: 30 }])
  })

  it('logs RIR alongside reps ("log 5 reps RIR 1")', () => {
    const r = parseVoiceCommand('log 5 reps RIR 1')
    expect(r.actions).toEqual([{ type: 'rir', value: 1 }, { type: 'reps', value: 5 }])
  })

  it('parses several actions in one utterance', () => {
    const r = parseVoiceCommand('5 reps at 100 RIR 1')
    expect(r.actions).toEqual([
      { type: 'rir', value: 1 }, { type: 'reps', value: 5 }, { type: 'weight', value: 100 },
    ])
  })

  it('takes rest in minutes before or after the word ("two minutes rest", "rest 90 seconds")', () => {
    expect(parseVoiceCommand('two minutes rest').actions).toEqual([{ type: 'rest', seconds: 120 }])
    expect(parseVoiceCommand('rest 90 seconds').actions).toEqual([{ type: 'rest', seconds: 90 }])
    expect(parseVoiceCommand('90 second rest').actions).toEqual([{ type: 'rest', seconds: 90 }])
    expect(parseVoiceCommand('rest 90').actions).toEqual([{ type: 'rest', seconds: 90 }])
    expect(parseVoiceCommand('rest for a minute').actions).toEqual([{ type: 'rest', seconds: 60 }])
    expect(parseVoiceCommand('a minute rest').actions).toEqual([{ type: 'rest', seconds: 60 }])
  })

  it('caps a spoken rest at the wheel ceiling (15:00)', () => {
    expect(parseVoiceCommand('twenty minutes rest').actions).toEqual([{ type: 'rest', seconds: 900 }])
  })

  it('understands the one-word commands', () => {
    expect(parseVoiceCommand('mark it done').actions).toEqual([{ type: 'done' }])
    expect(parseVoiceCommand('done').actions).toEqual([{ type: 'done' }])
    expect(parseVoiceCommand('complete the set').actions).toEqual([{ type: 'done' }])
    expect(parseVoiceCommand('failed').actions).toEqual([{ type: 'fail' }])
    expect(parseVoiceCommand('took it to failure').actions).toEqual([{ type: 'fail' }])
    expect(parseVoiceCommand('next exercise').actions).toEqual([{ type: 'next' }])
    expect(parseVoiceCommand('skip').actions).toEqual([{ type: 'next' }])
  })

  it('reads RIR and RPE with the number on either side', () => {
    expect(parseVoiceCommand('RIR 1').actions).toEqual([{ type: 'rir', value: 1 }])
    expect(parseVoiceCommand('2 rir').actions).toEqual([{ type: 'rir', value: 2 }])
    expect(parseVoiceCommand('two reps in reserve').actions).toEqual([{ type: 'rir', value: 2 }])
    expect(parseVoiceCommand('RPE 8').actions).toEqual([{ type: 'rpe', value: 8 }])
    expect(parseVoiceCommand('8 rpe').actions).toEqual([{ type: 'rpe', value: 8 }])
    expect(parseVoiceCommand('rir 0').actions).toEqual([{ type: 'rir', value: 0 }])
    expect(parseVoiceCommand('9.5 rpe').actions).toEqual([{ type: 'rpe', value: 9.5 }])
  })

  it('a weight with its unit needs no other word; pounds map to lb', () => {
    expect(parseVoiceCommand('one hundred kilos').actions).toEqual([{ type: 'weight', value: 100, unit: 'kg' }])
    expect(parseVoiceCommand('one hundred and five pounds').actions).toEqual([{ type: 'weight', value: 105, unit: 'lb' }])
    expect(parseVoiceCommand('60 kg').actions).toEqual([{ type: 'weight', value: 60, unit: 'kg' }])
  })

  it('a weight named by its word takes the profile unit ("weight eighty")', () => {
    expect(parseVoiceCommand('weight eighty').actions).toEqual([{ type: 'weight', value: 80 }])
    expect(parseVoiceCommand('weight is 62.5 kg').actions).toEqual([{ type: 'weight', value: 62.5, unit: 'kg' }])
  })

  it('compounds and decimals: twenty five, sixty two point five', () => {
    expect(parseVoiceCommand('twenty five reps').actions).toEqual([{ type: 'reps', value: 25 }])
    expect(parseVoiceCommand('sixty two point five kilos').actions).toEqual([{ type: 'weight', value: 62.5, unit: 'kg' }])
    expect(parseVoiceCommand('62 point 5 kilos').actions).toEqual([{ type: 'weight', value: 62.5, unit: 'kg' }])
  })

  it('reps can come after the word ("reps 10")', () => {
    expect(parseVoiceCommand('reps 10').actions).toEqual([{ type: 'reps', value: 10 }])
  })

  it('is case- and punctuation-tolerant', () => {
    const r = parseVoiceCommand('  Five reps at 100 kilos, please. ')
    expect(r.actions).toEqual([{ type: 'reps', value: 5 }, { type: 'weight', value: 100, unit: 'kg' }])
  })

  /* ---- safety: unknown, never a guess ---- */

  it('a bare number is unknown — it could be reps or weight', () => {
    const r = parseVoiceCommand('100')
    expect(r.actions).toEqual([{ type: 'unknown', text: '100' }])
    expect(r.response).toBe('unknown')
  })

  it('a number it cannot place makes the whole utterance unknown, even if part parsed', () => {
    // "100 for 5 reps": the 100 is said like a weight but with no unit and no at — refuse all of it
    expect(parseVoiceCommand('100 for 5 reps').actions).toEqual([{ type: 'unknown', text: '100 for 5 reps' }])
    // "3 sets of 12": two numbers, neither with a role
    expect(parseVoiceCommand('3 sets of 12').actions).toEqual([{ type: 'unknown', text: '3 sets of 12' }])
  })

  it('a word it does not know is unknown, not ignored', () => {
    expect(parseVoiceCommand('do ten squats').actions).toEqual([{ type: 'unknown', text: 'do ten squats' }])
    expect(parseVoiceCommand('rest').actions).toEqual([{ type: 'unknown', text: 'rest' }])
  })

  it('rejects values outside their sane range, whole utterance at once', () => {
    expect(parseVoiceCommand('rir 15').actions).toEqual([{ type: 'unknown', text: 'rir 15' }])
    expect(parseVoiceCommand('five point five reps').actions).toEqual([{ type: 'unknown', text: 'five point five reps' }])
    expect(parseVoiceCommand('rest 0').actions).toEqual([{ type: 'unknown', text: 'rest 0' }])
  })

  it('the weight is never read as an effort value ("5 reps at 100 RIR 1" keeps all three)', () => {
    const r = parseVoiceCommand('5 reps at 100 RIR 1')
    expect(r.actions.map(a => a.type)).toEqual(['rir', 'reps', 'weight'])
    expect(r.actions[0]).toEqual({ type: 'rir', value: 1 })
  })

  it('a stuttered one-word command applies once ("done done")', () => {
    expect(parseVoiceCommand('done done').actions).toEqual([{ type: 'done' }])
  })

  it('a repeated value keeps the last say (a correction)', () => {
    expect(parseVoiceCommand('10 reps 12 reps').actions).toEqual([{ type: 'reps', value: 12 }])
  })

  it('response segments are i18n-free key=value pairs built from the actions', () => {
    expect(parseVoiceCommand('rest 2 minutes').response).toBe('rest=120s')
    expect(parseVoiceCommand('rpe 9').response).toBe('rpe=9')
    expect(parseVoiceCommand('next').response).toBe('next')
    // grouped by kind in a fixed order, whatever order the words came in
    expect(parseVoiceCommand('5 reps at 100 lbs rir 2 rest 90 seconds done')
      .response).toBe('rest=90s · done · rir=2 · reps=5 · weight=100lb')
  })
})
