import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, isoOf, todayISO, exCount } from '../lib/format.js'
import { listVersions, getVersion } from '../lib/routine-history.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// The version history of one routine's own definition (lib/routine-history.js, opened from the
// routine editor's action stack). The store keeps a version of what every material edit replaced
// and one of what a restore is about to leave; this sheet only reads that list back and hands a
// chosen version to the store's restore action — the same edit path, stamps and sync included,
// that typing in the editor goes through.

// When a version was taken: the app's short date, with the year whenever it is not this one —
// a list of versions spans months, and last year's "4 Mar" must say so.
const dayOf = ts => {
  const iso = isoOf(new Date(ts))
  return fmtDate(iso, false, iso.slice(0, 4) !== todayISO().slice(0, 4))
}
// How big the plan a version froze was, said with the exercise-count plural every pack already
// carries (lib/format.js exCount) rather than the English-only summary the lib module builds.
const sizeOf = (S, routineId, v) => {
  const ex = getVersion(S.routineHistory, routineId, v.id)?.routine?.ex
  return Array.isArray(ex) ? exCount(ex.length) : null
}

export function RoutineHistorySheet({ close, routineId }) {
  const S = useStore(s => s.S)
  const versions = listVersions(S.routineHistory, routineId)
  const restore = v => confirmSheet({
    title: t('Restore this version?'),
    message: t('The plan goes back to how it was on {0}. What it says now is saved as a version first, so this can be undone the same way.', dayOf(v.ts)),
    confirmText: t('Restore'),
    onConfirm: () => {
      const ok = useStore.getState().restoreRoutineVersion(routineId, v.id)
      if (ok) { close(); useUI.getState().toast(t('Version restored')) }
      else useUI.getState().toast(t('That version is no longer available'))
    },
  })
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <h3 style={{ margin: 0 }}>{t('Version history')}</h3>
      <Button size="sm" variant="ghost" onClick={close}>{t('Done')}</Button>
    </div>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Every change to this plan keeps the version it replaced, newest first. Restore any of them — what is on screen now is saved as a version first.')}</div>
    {versions.length ? <div className="list">
      {versions.map(v => <div key={v.id} className="item">
        <div className="grow">
          <div className="tt">{v.label || t('Version')}</div>
          <div className="ss">{[dayOf(v.ts), sizeOf(S, routineId, v)].filter(Boolean).join(' · ')}</div>
        </div>
        <Button size="sm" variant="tinted" onClick={() => restore(v)}>{t('Restore')}</Button>
      </div>)}
    </div> : <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No versions yet. One is kept every time the plan changes.')}</div>}
  </>
}

/** Opens the version-history sheet for one routine. */
export function routineHistorySheet(routineId) {
  return useUI.getState().openSheet(close => <RoutineHistorySheet close={close} routineId={routineId} />)
}
