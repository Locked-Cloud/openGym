// Voice logging on the workout screen (Settings → Workout settings → Log by voice): the pure
// half. parseVoiceCommand() turns ONE tap-to-talk utterance into the actions it meant; the
// microphone itself is wrapped in voice-speech.js, so this grammar stays testable without a
// browser. Like every lib/ helper it is framework-free and adds no dependency.
//
// The contract with the UI:
//   parseVoiceCommand(text) → { actions: Action[], response: string }
//   Action — { type: 'reps', value } | { type: 'weight', value, unit?: 'kg' | 'lb' } |
//            { type: 'rir' | 'rpe', value } | { type: 'rest', seconds } | { type: 'done' } |
//            { type: 'fail' } | { type: 'next' } | { type: 'unknown', text }
//   response — a stable, i18n-free summary assembled from the ACTIONS, never from the raw
//     speech: `key=value` segments joined by ' · ' ("reps=5 · weight=100kg · rir=1"), or
//     "unknown". The parser never embeds English prose; the UI owns the words and renders its
//     confirmation from `actions` through t(), in the profile's unit and effort scale.
//
// Safety over recall: a wrong weight is worse than a shrug. Every recognised span of the
// utterance is consumed, and if digits or any word outside a small filler list are left over —
// or a value lands outside its sane range — the WHOLE utterance comes back as { type: 'unknown' }.
import { REST_MAX } from './duration.js'

/* ---------- spoken numbers → digits ---------- */

const NUM_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
}
const isNumWord = w => Object.prototype.hasOwnProperty.call(NUM_WORDS, w)
const isDigits = w => /^\d+(?:\.\d+)?$/.test(w)
const isNumish = w => isNumWord(w) || isDigits(w)

// Collapse a run of number words into one digit token: "twenty five" → 25, "one hundred and
// five" → 105, "sixty two point five" → 62.5. Digit tokens pass through ("62 point 5" is how
// speech writes decimals too). "and" only glues inside a number it already saw a hundred in,
// so "5 reps and rest 90" keeps its two numbers apart.
function normalizeNumbers(text) {
  const tokens = text.split(/\s+/).filter(Boolean)
  const out = []
  let i = 0
  while (i < tokens.length) {
    const w = tokens[i]
    if (!isNumish(w)) { out.push(w); i++; continue }
    if (isDigits(w) && (tokens[i + 1] === 'point' || tokens[i + 1] === 'dot') && isNumish(tokens[i + 2])) {
      out.push(w + '.' + Number(tokens[i + 2]))
      i += 3
      continue
    }
    if (isDigits(w)) { out.push(w); i++; continue }
    let j = i, total = 0, cur = 0, sawHundred = false, decimals = null
    const add = v => {
      if (v === 100) { cur = (cur || 1) * 100; sawHundred = true }
      else if (cur >= 100) { total += cur; cur = v }
      else cur += v
    }
    while (j < tokens.length) {
      const tk = tokens[j]
      if (isNumWord(tk)) {
        if (decimals != null) decimals += String(NUM_WORDS[tk])
        else add(NUM_WORDS[tk])
        j++
      } else if (isDigits(tk)) {
        // a digit inside a word run ("twenty 5") reads as its value
        if (decimals != null) decimals += tk.replace('.', '')
        else add(Number(tk))
        j++
      } else if ((tk === 'point' || tk === 'dot') && decimals == null && j > i && isNumish(tokens[j + 1])) {
        decimals = ''
        j++
      } else if (tk === 'and' && decimals == null && sawHundred && isNumish(tokens[j + 1])) {
        j++
      } else break
    }
    const int = total + cur
    out.push(String(decimals != null ? Number(int + '.' + decimals) : int))
    i = j
  }
  return out.join(' ')
}

// Lowercase, strip punctuation that carries no meaning, space out shorthand, and spell
// "r i r" / "r p e" the way the recogniser usually writes them anyway ("rir"/"rpe").
function normalize(text) {
  let s = String(text || '').toLowerCase().trim()
  s = s.replace(/[-–—]/g, ' ')
  s = s.replace(/[!?;,:]+/g, ' ')
  // a spoken full stop, never the one inside "62.5"
  s = s.replace(/\.(\D)/g, ' $1').replace(/\.$/, ' ')
  s = s.replace(/@/g, ' @ ').replace(/×/g, ' x ')
  s = s.replace(/\br\s+i\s+r\b/g, ' rir ').replace(/\br\s+p\s+e\b/g, ' rpe ')
  return s.replace(/\s+/g, ' ').trim()
}

/* ---------- the grammar ---------- */

// Weights: everything the recogniser might return for the two units, mapped to what S.unit holds.
const KG = /^(kgs?|kilos?|kilograms?)$/
const LB = /^(lbs?|pounds?)$/
const unitOfWord = w => !w ? undefined : KG.test(w) ? 'kg' : LB.test(w) ? 'lb' : null

const NUM = String.raw`\d+(?:\.\d+)?`
// An effort value is a whole 0–10 with optional halves — bounded IN the pattern, not just in
// validation, so "…at 100 rir 1" cannot read its weight as "100 rir" and poison the utterance.
const EFF = String.raw`(?:10|\d(?:\.5)?)`
const WUNIT = String.raw`(?:kgs?|kilos?|kilograms?|lbs?|pounds?)`
const TUNIT = String.raw`(?:seconds?|secs?|s|minutes?|mins?|min)`
const mins = u => /^min/.test(u || '')

// Words that may sit around a recognised command without turning it unknown. Anything else
// left over after the patterns consumed their spans means the utterance said more than we
// understood — safer to shrug (unknown) than to log half of it.
const FILLER = new Set(['log', 'please', 'and', 'the', 'a', 'an', 'my', 'i', 'we', 'me', 'want', 'just',
  'did', 'do', 'it', 'that', 'this', 'of', 'ok', 'okay', 'uh', 'um', 'set', 'sets', 'for', 'to', 'as',
  'is', 'are', 'was', 'at', 'now', 'mark', 'take', 'took', 'taken'])

const valid = a => {
  if (a.type === 'reps') return Number.isInteger(a.value) && a.value > 0 && a.value <= 999
  if (a.type === 'weight') return Number.isFinite(a.value) && a.value >= 0 && a.value <= 9999
  if (a.type === 'rir') return a.value >= 0 && a.value <= 10
  if (a.type === 'rpe') return a.value >= 1 && a.value <= 10
  if (a.type === 'rest') return Number.isInteger(a.seconds) && a.seconds > 0 && a.seconds <= REST_MAX
  return true
}

/**
 * Parse one utterance. Numbers may be words ("five reps at one hundred kilos") or digits
 * ("5 @ 100"); a bare number after 'at'/'@' carries no unit (the profile's own); explicit
 * kg/lb/pounds/kilos do. Several actions may share one utterance ("5 reps at 100 RIR 1"),
 * and anything ambiguous or half-understood is returned whole as { type: 'unknown', text }.
 */
export function parseVoiceCommand(text) {
  const raw = String(text || '').trim()
  const s = normalizeNumbers(normalize(raw))
  const actions = []
  const spans = []
  const covered = (a, b) => spans.some(([x, y]) => a < y && x < b)
  const take = (re, fn) => {
    let m
    re.lastIndex = 0
    while ((m = re.exec(s)) !== null) {
      const from = m.index, to = m.index + m[0].length
      if (!covered(from, to)) { spans.push([from, to]); fn(m) }
    }
  }
  const restAction = (value, unit) => {
    const sec = Math.round(Number(value) * (mins(unit) ? 60 : 1))
    // clamped at the wheel's ceiling (15:00); anything under a second is rejected by validation
    actions.push({ type: 'rest', seconds: Math.min(sec, REST_MAX) })
  }
  const num = m => Number(m[1] ?? m[2])

  // rest — number before ("two minutes rest", "a minute rest") …
  take(new RegExp(`(${NUM})\\s*(${TUNIT})\\s+(?:rest|break)\\b`, 'g'), m => restAction(m[1], m[2]))
  take(new RegExp(`\\b(?:a|an)\\s+(${TUNIT})\\s+(?:rest|break)\\b`, 'g'), m => restAction(1, m[1]))
  // … and after ("rest 90 seconds", "rest for a minute"); no unit means seconds
  take(new RegExp(`\\brest(?:\\s+for)?\\s+(?:a|an)\\s+(${TUNIT})\\b`, 'g'), m => restAction(1, m[1]))
  take(new RegExp(`\\brest(?:\\s+for)?\\s+(${NUM})\\s*(${TUNIT})?\\b`, 'g'), m => restAction(m[1], m[2]))

  // the one-word commands
  take(/\b(?:mark\s+(?:it|that)\s+(?:as\s+)?done|set\s+done|done|complete(?:d)?(?:\s+the\s+set)?|check(?:ed)?)\b/g,
    () => actions.push({ type: 'done' }))
  take(/\b(?:fail(?:ed)?|failure|to\s+failure)\b/g, () => actions.push({ type: 'fail' }))
  take(/\b(?:next(?:\s+(?:exercise|set|one))?|move\s+on|skip(?:\s+(?:set|it))?)\b/g, () => actions.push({ type: 'next' }))

  // effort — RIR or RPE, the number on either side ("RIR 1", "1 RIR", "2 reps in reserve").
  // The value is \b-bounded on both sides so it can never begin inside a larger number:
  // the 100 in "5 reps at 100 RIR 1" is a weight, not "0 rir".
  take(new RegExp(`\\b(?:rir|reps\\s+in\\s+reserve)\\s+(${EFF})\\b|\\b(${EFF})\\b\\s*(?:rir|reps\\s+in\\s+reserve)\\b`, 'g'),
    m => actions.push({ type: 'rir', value: num(m) }))
  take(new RegExp(`\\brpe\\s+(${EFF})\\b|\\b(${EFF})\\b\\s*rpe\\b`, 'g'),
    m => actions.push({ type: 'rpe', value: num(m) }))

  // reps and weight said together — "5 reps at 100", "five @ one hundred kilos", "8 x 30".
  // Runs before the singles so the weight (and its unit) is consumed with its reps.
  take(new RegExp(`(${NUM})\\s*(?:reps?|repetitions?)?\\s*(?:@|at|x)\\s*(${NUM})(?:\\s*(${WUNIT}))?`, 'g'),
    m => {
      actions.push({ type: 'reps', value: Number(m[1]) })
      actions.push({ type: 'weight', value: Number(m[2]), ...(unitOfWord(m[3]) ? { unit: unitOfWord(m[3]) } : {}) })
    })
  // reps alone — "10 reps" / "reps 10"
  take(new RegExp(`(${NUM})\\s*(?:reps?|repetitions?)\\b|(?:\\breps?|repetitions?)\\s+(${NUM})`, 'g'),
    m => actions.push({ type: 'reps', value: num(m) }))
  // weight said with its word — "weight 80", "weight is 100 kilos"
  take(new RegExp(`\\bweights?\\s*(?:is|of)?\\s*(${NUM})(?:\\s*(${WUNIT}))?`, 'g'),
    m => actions.push({ type: 'weight', value: Number(m[1]), ...(unitOfWord(m[2]) ? { unit: unitOfWord(m[2]) } : {}) }))
  // a weight the 'at' points at, when no reps came first — "at 100"
  take(new RegExp(`(?:@|at)\\s*(${NUM})(?:\\s*(${WUNIT}))?`, 'g'),
    m => actions.push({ type: 'weight', value: Number(m[1]), ...(unitOfWord(m[2]) ? { unit: unitOfWord(m[2]) } : {}) }))
  // a weight told by its unit alone — "one hundred kilos"
  take(new RegExp(`(${NUM})\\s*(${WUNIT})\\b`, 'g'),
    m => actions.push({ type: 'weight', value: Number(m[1]), unit: unitOfWord(m[2]) }))

  // Anything said that no pattern consumed — a number we could not place, or a word we do not
  // know — makes the whole utterance unknown: half-applying it risks logging the wrong thing.
  let residue = ''
  let prev = 0
  for (const [a, b] of spans.sort((p, q) => p[0] - q[0])) { residue += ' ' + s.slice(prev, a); prev = b }
  residue += ' ' + s.slice(prev)
  const leftovers = residue.trim().split(/\s+/).filter(Boolean).filter(w => !FILLER.has(w))
  if (!actions.length || leftovers.length || !actions.every(valid)) {
    const unknown = [{ type: 'unknown', text: raw }]
    return { actions: unknown, response: 'unknown' }
  }
  // A stutter must not double-apply ("done done" would tick a set and untick it again): the
  // one-shot words keep their first say, while a repeated value keeps the last (a correction).
  const order = []
  const byType = new Map()
  for (const a of actions) {
    const oneShot = a.type === 'done' || a.type === 'fail' || a.type === 'next'
    if (!byType.has(a.type)) order.push(a.type)
    if (!byType.has(a.type) || !oneShot) byType.set(a.type, a)
  }
  const final = order.map(k => byType.get(k))
  return { actions: final, response: final.map(responseSegment).join(' · ') }
}

// One action as a stable, i18n-free response segment — the documented format the UI may show
// as-is (a log line, a debug chip) while its spoken confirmation is built from the actions.
const responseSegment = a =>
  a.type === 'reps' ? 'reps=' + a.value
    : a.type === 'weight' ? 'weight=' + a.value + (a.unit || '')
      : a.type === 'rir' ? 'rir=' + a.value
        : a.type === 'rpe' ? 'rpe=' + a.value
          : a.type === 'rest' ? 'rest=' + a.seconds + 's'
            : a.type
