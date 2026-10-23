# openGym Intelligence

A community enhancement suite for [openGym](https://github.com/DuarteSantos8/openGym) — the self-hosted, privacy-first gym & body-weight tracker — adding the training intelligence upstream doesn't have yet: **injury-aware constraints, program version history, competition powerlifting, hands-free voice logging, sleep-based readiness, a richer muscle explorer, and an AI coach that cannot propose what your constraints rule out.**

Built on top of upstream `main` (v1.4.1+). Upstream's own roadmap (programs & phases, progression-engine upgrades, trainer role) is deliberately **not** duplicated here — this suite only fills the white space, so it can ride the maintainer's release train instead of racing it.

---

## The features

### 1. Injury-aware training constraints
Record what you are training around — a label ("lower back"), body parts, muscles, and exercises named outright, marked as your own call or a professional's. Every plan is then validated against your active constraints:

- **Blocked** — the constraint names the exercise outright.
- **Flagged** — the exercise hits a constrained body part or primary muscle.
- **Uncertain** — only a secondary muscle overlaps: allowed, but marked "needs professional review".

The verdicts appear as a warning card in the routine editor (with one-tap **substitution swaps** ranked by shared muscles), a confirmation when starting a session that meets a constraint, and a manager sheet in Settings → Workout. The engine is deterministic and makes **no medical claims** — everything is name-overlap, never judgment, and uncertain cases always point to a qualified professional.

### 2. The AI coach respects your constraints
The optional AI coach's pipeline now carries a **constraints validation gate** on both sides:

- **Server** (`api/coach/core/`): any proposal that adds or swaps in a blocked/flagged exercise is rejected with a named reason, fed to the existing repair round, and the job fails as `unusable` if the model insists. A server-side twin of the conflict engine is pinned to the frontend module by a parity test (the repo's `queue.js` hand-copy precedent).
- **Payload & consent**: active constraints (label, body parts, muscles, exercise ids, source — nothing else; **notes never leave your device**) are sent as a new bounded data category, disclosed on the consent screen, with a consent re-confirm flow.
- **Client**: accepted proposals are re-checked at apply time; blocked changes are skipped with a chat notice.

### 3. Routine version history
Every material edit automatically snapshots the previous state (last 20 versions per routine). Restore any version — the current state is snapshotted first, so restores are themselves reversible. Deleting a routine keeps its history through the undo window and dies with it. Syncs field-level across devices.

### 4. Powerlifting module
The first sport module on a stable contract. Plan openers/seconds/thirds from your training maxes with configurable rules (plate-grid rounding, federation-style attempt bands — conservative coaching defaults, not predictions), then log a meet day: good/fail/skip per attempt with live bests, total, and bomb-out detection. Session analysis reuses the app's e1RM engine. **Scoring (DOTS/Wilks) is intentionally omitted** until coefficients are verified against a primary source.

### 5. Voice logging
Tap the mic in the workout header and speak a set — *"5 reps at 100 kilos, RIR 1"* — or a rest, "done", "failed", "next". The parser (pure, 22 tests) handles word-numbers, units, and multi-action utterances, and treats anything ambiguous as **unknown rather than a guessed weight**. Runs through the browser's speech service, one utterance per tap, off by default; nothing is stored beyond the parsed values.

### 6. Readiness from sleep
Android Health Connect sleep sessions are read (separate permission, quiet foreground pull) into a simple, honest signal: last night **against your own 7-night average** — no universal 8-hour norm; a 5-hour-average person sleeping 5 hours reads "usual". Under three nights it says "not enough nights yet" instead of inventing a baseline. Non-Android users can add nights by hand. The card and 7-night chart live on Home. It is a sleep-consistency signal, explicitly not a recovery or health measurement.

### 7. Enhanced Muscles Explorer
The muscle screen, upgraded around the app's existing anatomical body map (the structure kept, per design review): tap any muscle for a detail panel — fatigue state, this week's hard sets done vs planned, windowed estimated 1RM with your best exercise, top exercises by history — plus a global fatigue heat overlay, front/back/both stage (both figures side-by-side on the ≥1000px desktop shell), and muscle search with on-map match outlines. Reuses the Stats/recovery helpers verbatim.

---

## Engineering approach

- **Upstream conventions throughout**: pure helpers in `src/lib` with colocated vitest suites, zero new dependencies, no linter — style matched by hand, training logic always tested.
- **Sync-first**: every new state key (`constraints`, `routineHistory`, `powerlifting`, `readiness`) has field-stamped, union-by-id merge rules in `sync-merge.js` with its own tests, following the existing patterns.
- **i18n complete**: 91 new strings translated across all 18 locale packs (including Russian/Ukrainian/Polish plural forms and genuine pt-BR overrides), `check-locales` in sync, `check-source-strings` at zero misses.
- **Safety language audited**: no medical claims anywhere; professional-referral wording preserved in every language.

## Verification

| Surface | Result |
|---|---|
| Frontend | **414 files / 5,257 tests passing**, production build clean |
| Locales | 18 packs in sync (2,398 keys each); zero untranslated source strings |
| API | 584/612 on a Windows checkout — the 28 failures are a pre-existing Windows-only baseline (POSIX/CRLF/date-dependent tests), byte-identical on upstream HEAD; they pass on the Linux CI that gates PRs |
| Android | Health Connect plugin sleep-read compiles (`compileDebugJavaWithJavac`); **not yet device-tested** |

## The PR stack

Nine branches, each independently verified, stacked in this order (all pushed to this fork):

1. `pr/windows-fix` — path-separator fix for the mobile-bundle check's test on Windows checkouts
2. `pr/constraints` — the constraint engine + UI + translations
3. `pr/routine-history` — version history
4. `pr/powerlifting` — the sport module + planner/meet UI
5. `pr/voice` — voice logging
6. `pr/coach-constraints` — constraint-aware coach validation (depends on #2)
7. `pr/readiness` — sleep-based readiness
8. `pr/muscles-explorer` — the enhanced muscle explorer

`opengym-intelligence` is the umbrella branch containing everything (this document lives there).

## Known limitations & roadmap

- Powerlifting **scoring coefficients** need a verified source (IPF handbook / OpenPowerlifting) before enabling.
- Health Connect sleep-read and voice logging need **on-device verification** (Android phone / iOS WebView).
- `api/sync-stamps.js`'s server-side copy doesn't yet cover the new state keys for *unstamped* writers (documented fallback covers them).
- Unit conversion doesn't reach weights frozen inside restored routine-history snapshots.
- "Reset everything" intentionally does not wipe constraints/history/readiness (injury history survives resets) — a deliberate, if unreviewed, choice.
- Coach proposals have no "uncertainty" field, so `uncertain` verdicts pass silently (documented; would need an upstream schema addition to annotate).

## Credits & license

Everything here is **AGPL-3.0-or-later**, like the project it builds on. All credit for openGym itself goes to [Duarte Santos](https://github.com/DuarteSantos8) and the openGym contributors; this suite is a community contribution intended to be upstreamed piece by piece. Development was AI-assisted (ZCode, with subagent orchestration) and held to the repo's own bar: every training-logic change ships with unit tests, and every claim in this file is backed by the commit history.
