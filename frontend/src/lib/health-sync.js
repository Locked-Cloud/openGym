// Health Connect on the Android app (#200): turning it on, and keeping it in step with the log.
// What gets written is worked out in lib/health-connect.js; this file owns the native plugin
// (HealthConnectPlugin.java) and the phone's own record of what it wrote. The sleep READ side
// (readiness, lib/readiness.js) lives here too, at the bottom — separate permissions, separate
// opt-in, one plugin either way.
//
// It is a fact about this phone, not about the training log: kept in its own file in the app's
// data directory, never in S, so it does not sync to a server, ride in a backup, or switch on a
// second phone. Off until the user turns it on; nothing is asked of Health Connect before that.
//
// The web build never gets here (MOBILE is a build-time flag), and iOS answers 'unsupported'.
import { MOBILE, isAndroid, readJsonFile, writeJsonFile } from './mobile.js'
import { healthRecords, planSync, writtenIds } from './health-connect.js'
import { sleepsFromSessions } from './readiness.js'
import { exerciseNameFor } from './i18n-core.js'
import { EXIDX } from './exercises.js'
import { speedUnitOf } from './speed.js'

export const HEALTH_FILE = 'opengym-health.json'
const OFF = { on: false, written: {}, at: 0, error: null }

// Wrapped in an object, as in rest-alert.js: a Capacitor plugin proxy answers `then`, so a
// promise resolved with the bare proxy never settles.
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  if (!(await isAndroid())) return null
  const { registerPlugin } = await import('@capacitor/core')
  return { HC: registerPlugin('HealthConnect') }
})().catch(() => null))

// The file's content, read once and then kept here: a save while it is off (the usual case) must
// not cost a file read, and every change to it goes through saveHealth anyway.
let cached = null
export async function loadHealth() {
  if (cached) return cached
  const f = await readJsonFile(HEALTH_FILE)
  cached = f && typeof f === 'object' ? { ...OFF, ...f, written: f.written && typeof f.written === 'object' ? f.written : {} } : { ...OFF }
  return cached
}
const saveHealth = h => { cached = h; return writeJsonFile(HEALTH_FILE, h) }

/** { status: 'available' | 'update' | 'missing' | 'unsupported', granted } */
export async function healthStatus() {
  if (!MOBILE) return { status: 'unsupported', granted: false }
  try {
    const p = await plugin()
    if (!p) return { status: 'unsupported', granted: false }
    return await p.HC.status()
  } catch { return { status: 'unsupported', granted: false } }
}

/** Health Connect's own screen for what apps wrote, or its store page where it is missing. */
export async function openHealthConnect() {
  const p = await plugin()
  if (p) await p.HC.openSettings()
}

const nameOf = e => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.n || e.id))

// One sync at a time. A change that comes in while one runs is not lost: the running one is
// followed by a single further pass with the newest state.
let running = null
let again = null
const listeners = new Set()
/** Called with the file's new content after every sync, for the Settings row. */
export function onHealthChange(cb) { listeners.add(cb); return () => listeners.delete(cb) }
const told = h => { listeners.forEach(cb => { try { cb(h) } catch { /* a closed screen */ } }) }

/**
 * Writes what changed since the last sync and removes what was deleted from openGym. A no-op
 * while it is off. Resolves with the file's content afterwards; `error` is 'permission' when
 * Health Connect refused (the user took the permission back), 'unavailable' when it is gone.
 */
export function syncHealth(S) {
  if (!MOBILE) return Promise.resolve(null)
  // Not read yet: initHealthSync reads it at launch and syncs then, which covers a save made
  // before that; the save path itself never waits on the file.
  if (!cached || !cached.on) return Promise.resolve(cached)
  if (running) { again = S; return running }
  again = null
  running = (async () => {
    let h = await loadHealth()
    let next = S
    while (next) {
      if (h.on) h = await syncOnce(next, h)
      // A state that came in meanwhile, taken only now: cleared before a pass, it would lose a
      // change made while the pass was starting.
      next = again
      again = null
    }
    return h
  })().finally(() => { running = null })
  return running
}

async function syncOnce(S, h) {
  const p = await plugin()
  if (!p) return h
  const plan = planSync(healthRecords(S, { nameOf, speedUnit: speedUnitOf(S) }), h.written)
  const nothing = !plan.sessions.length && !plan.weights.length && !plan.remove.sessions.length && !plan.remove.weights.length
  if (nothing) {
    if (!h.error) return h
    // Nothing to write, but the last attempt failed: clear it once Health Connect says yes again.
    const st = await p.HC.status().catch(() => null)
    if (!(st?.status === 'available' && st.granted)) return h
    const out = { ...h, error: null }
    await saveHealth(out)
    told(out)
    return out
  }
  let out = { ...h }
  try {
    if (plan.sessions.length || plan.weights.length) {
      await p.HC.write({ sessions: plan.sessions, weights: plan.weights })
      // Written but not yet removed: kept as written, so a failed remove is tried again.
      const kept = Object.fromEntries(Object.entries(h.written).filter(([id]) => !plan.written[id]))
      out.written = { ...kept, ...plan.written }
    }
    if (plan.remove.sessions.length || plan.remove.weights.length) await p.HC.remove(plan.remove)
    out = { ...out, written: plan.written, at: Date.now(), error: null }
  } catch (e) {
    out.error = e?.code === 'permission' ? 'permission' : e?.code === 'unavailable' ? 'unavailable' : 'failed'
  }
  await saveHealth(out)
  told(out)
  return out
}

/**
 * Turning it on: asks for the two write permissions, then writes the whole log once. Resolves
 * with { ok, reason } — reason 'denied' when the user did not grant both, or the status when
 * Health Connect is not there to ask.
 */
export async function enableHealth(S) {
  const p = await plugin()
  if (!p) return { ok: false, reason: 'unsupported' }
  const st = await p.HC.status().catch(() => ({ status: 'unsupported' }))
  if (st.status !== 'available') return { ok: false, reason: st.status }
  const granted = st.granted || (await p.HC.requestPermissions().catch(() => ({ granted: false }))).granted
  if (!granted) return { ok: false, reason: 'denied' }
  const h = await loadHealth()
  await saveHealth({ ...h, on: true, error: null })
  const after = await syncHealth(S)
  return { ok: !after?.error, reason: after?.error || null, health: after }
}

/**
 * Turning it off stops the writing. With `removeWritten`, what openGym wrote is taken out of
 * Health Connect too; without it, it stays there as the user's own data. Rejects when the
 * removal fails, and then stays on, so nothing is left behind that the phone forgot it wrote.
 */
export async function disableHealth({ removeWritten = false } = {}) {
  if (running) await running.catch(() => {})
  const h = await loadHealth()
  if (removeWritten) {
    const ids = writtenIds(h.written)
    if (ids.sessions.length || ids.weights.length) {
      const p = await plugin()
      if (!p) throw new Error('unavailable')
      await p.HC.remove(ids)
    }
  }
  const out = { ...h, on: false, error: null, written: removeWritten ? {} : h.written }
  await saveHealth(out)
  told(out)
  return out
}

// Back in the foreground: a change synced from another device while the phone was away, or a
// permission the user granted again in Health Connect's own settings, is picked up then.
let started = false
export function initHealthSync(getState) {
  if (!MOBILE || started) return
  started = true
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) syncHealth(getState()).catch(() => {}) })
  }).catch(() => {})
  // Once at launch, for a workout finished just before the app was closed. Reading the file here
  // also settles whether it is on, which the saves wait for (syncHealth).
  setTimeout(() => loadHealth().then(() => syncHealth(getState())).catch(() => {}), 3000)
}

/* ---- Sleep sessions, read (readiness) -------------------------------------------------------- */

// The other direction of the Health Connect integration: sleep sessions READ from the store
// other apps (a watch, a sleep app) write to, for the sleep-consistency signal on Home
// (lib/readiness.js). Independent of the write sync above: it asks for the sleep-read
// permission only from the readiness card's Refresh — never on its own — and once the
// permission stands, the recent nights are pulled quietly when the app comes back to the
// foreground and once at launch. Nothing here writes to Health Connect, and the write sync
// never asks for a read permission: a user of only one of the two is never asked for the other.

// Enough nights for a 7-night average without re-reading months of history on every pull.
export const SLEEP_DAYS = 14

/** { status: 'available' | …, granted } for the sleep-read permission alone. */
export async function sleepStatus() {
  if (!MOBILE) return { status: 'unsupported', granted: false }
  try {
    const p = await plugin()
    if (!p) return { status: 'unsupported', granted: false }
    return await p.HC.sleepStatus()
  } catch { return { status: 'unsupported', granted: false } }
}

/** Health Connect's own screen for the sleep-read permission; { granted } afterwards. */
export async function requestSleepAccess() {
  const p = await plugin()
  if (!p) return { granted: false }
  try { return await p.HC.requestSleepPermission() } catch { return { granted: false } }
}

/**
 * The last `days` nights' sleep sessions: [{ id, start, end }] in ms, Health Connect's own
 * record ids. null where sleep cannot be read at all (nothing there, or the permission taken
 * back) — an empty list means Health Connect answered with no sessions.
 */
export async function readSleepSessions(days = SLEEP_DAYS) {
  if (!MOBILE) return null
  const p = await plugin()
  if (!p) return null
  try { return (await p.HC.readSleep({ days }))?.sessions || [] } catch { return null }
}

/**
 * The readiness card's Refresh: with `ask` (the default), Health Connect's own screen asks for
 * the sleep-read permission the first time; then the recent nights are read. { ok: true, rows }
 * — rows already in the store's shape (lib/readiness.js sleepsFromSessions) — or
 * { ok: false, reason }: 'unsupported' (web, iOS, no Health Connect), 'denied' (the user said
 * no), 'permission' (taken back since; only on the quiet path), 'unavailable' (the read failed).
 */
export async function pullSleeps({ ask = true } = {}) {
  const st = await sleepStatus()
  if (st.status !== 'available') return { ok: false, reason: 'unsupported' }
  if (!st.granted) {
    if (!ask) return { ok: false, reason: 'permission' }
    const r = await requestSleepAccess()
    if (!r.granted) return { ok: false, reason: 'denied' }
  }
  const sessions = await readSleepSessions()
  if (!sessions) return { ok: false, reason: 'unavailable' }
  return { ok: true, rows: sleepsFromSessions(sessions) }
}

// The quiet path: nights pulled only with the permission already standing — back in the
// foreground (another app wrote last night's sleep meanwhile) and once at launch. Never asks,
// never toasts; a pull that finds nothing changes nothing.
let sleepStarted = false
export function initSleepSync(onRows) {
  if (!MOBILE || sleepStarted) return
  sleepStarted = true
  const pull = () => pullSleeps({ ask: false })
    .then(r => { if (r.ok && r.rows.length) onRows(r.rows) })
    .catch(() => {})
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) pull() })
  }).catch(() => {})
  setTimeout(pull, 4000)
}
