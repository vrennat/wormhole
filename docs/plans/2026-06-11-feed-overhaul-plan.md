# Wormhole Feed Overhaul — Implementation Plan

Date: 2026-06-11
Spec: docs/specs/2026-06-11-feed-overhaul-design.md
Built via plan-hunter tournament (lenses: MVP / Risk / Dependency / User).
Winner: User-first — 8.63/10. Scoreboard: A 7.00 | B 8.38 | C 8.31 | D 8.63.

## Assumptions to confirm

- [ ] sessionStorage for trail persistence (not localStorage) — trails die when the tab closes, preventing stale resurrection days later.
- [ ] Rehydration restores only the last ~20 nodes of a long trail to bound cold-cache fetch time (~2s at 4 parallel fetches). Older entries tombstone in the panel; trail structure preserved. (Resolved default: 20. Raise `rehydrateRestoreCap` if full restore is wanted.)
- [ ] Clickthrough bumps tokens by 0.7 (above dwell 0.2, below like 1.0).
- [ ] Decay fires once per tab session (sessionStorage sentinel). Multi-tab users decay independently — accepted.
- [ ] `branchFrom` bypasses surprise structurally (`noSurprise` context flag), not via rng override.
- [ ] Variety window widens to 5 with immediate parent excluded — behavioral change, monitor after rollout.
- [ ] Profile popover shows DF-discounted effective weights (what the engine actually uses).
- [ ] Surprise silently skips when pool < topK + 3 — intentional, tested.
- [ ] Dives re-root the chain (deliberate action), unlike surprises which are detours. (Resolved per spec.)

## The plan

### M0 — Bootcamp (baseline integrity)

Run `bun run check`, `bun run test`, `bun run build` on the unmodified tree; document any pre-existing failures so later regressions are attributable.

### M1 — Foundation layer: types, config, discriminated results

(Dependency-first graft: types/config land before consumers. Risk-first graft: discriminated results land early and atomically so later milestones never ship with swallowed errors.)

- `src/lib/feed/types.ts` — add `TrailNode { id, title, relation, fromTitle, isDetour }`, `'dive'` in `Relation`, `FetchResult<T> = { ok: true; data: T } | { ok: false; kind: 'network' | 'notfound' | 'empty' }`, `EngineContext` + `tokenDocFreq`, `seenCount`, `noSurprise`.
- `src/lib/feed/config.ts` — `clickthroughTokenWeight: 0.7`, `dwellTokenWeight: 0.2`, `sessionDecay: 0.85`, `tokenWeightCap: 3`, `recentWindow: 5`, `surpriseFloor: 0.1`, `trailStorageKey: 'wormhole:trail:v1'`, `trailCap: 100`, `rehydrateRestoreCap: 20`, `decayStorageKey: 'wormhole:decay:v1'`.
- `src/lib/feed/feedState.svelte.ts` — convert `fetchCardApi`/`fetchLinksApi` to `FetchResult<T>`; all callsites are in this one file, so the breaking change is a single atomic edit. Add `'stalled'` to `Status`.
- Update test `context()` helpers for the new required `EngineContext` fields.

Exit: check + test green, build passes.

### M2 — Engine: DF discounting, decay, clickthrough, squash, variety

- `score.ts` — `effectiveWeight = weight / (1 + Math.log(1 + df))`; squash becomes `Math.tanh(relevance / 2)`.
- `select.ts` — surprise samples uniformly from candidates ranked below `topK`, excluding political and sub-`surpriseFloor` scores; skip surprise when pool < topK + 3; skip entirely when `ctx.noSurprise`.
- `profile.svelte.ts` — `tokenDocFreq` + `seenCount` state (persisted); `recordSeen(article)` with first-occurrence-per-title dedupe; `recordClickthrough(article: Article)` signature change + 0.7 bump; `applySessionDecay()` (x0.85, floor 0.05, cap 3) browser-guarded, sessionStorage-sentinel-gated; cap enforced in `#bumpTokens`.
- `feedState.svelte.ts` — `#context()` passes new fields; `recordSeen` called in `more()` when a card is revealed (NOT in `#doBuild` — buffered-never-shown cards must not count); variety fix: `all.slice(-(FEED.recentWindow + 1), -1)` excludes the immediate parent.
- `ArticleCard.svelte` — pass full `article` to `recordClickthrough`.

Tests: DF worked example (weight 1, df 10 → ~0.408), decay/floor/cap, surprise pool shape, pool-too-shallow skip, noSurprise guard, political exclusion, recordSeen dedupe.

### M3 — Reader overlay

- New `src/lib/components/ArticleOverlay.svelte` — native `<dialog>` via `showModal()` inside `$effect` (SSR-safe), `fixed inset-0 z-50`, own scroll, sticky header with title + close, Esc native. Props: `article`, `html`, `onDive`, `onClose`.
- `ArticleCard.svelte` — remove inline 75vh expansion; "Read article" fires `onRead`.
- `+page.svelte` — owns overlay state; `onDive` stubbed until M4.
- z-index scale (Dependency-first graft): header z-20, panel z-40, overlay z-50.

### M4 — Trail model + in-article dives

- New `src/lib/feed/trail.ts` (Risk-first graft) — pure `saveTrail` / `loadTrail` / `clearTrail` / `chainTip(nodes)` (last non-detour node); browser-guarded; fully unit-tested with mocked sessionStorage.
- `feedState.svelte.ts`:
  - `trail = $state<TrailNode[]>([])`; `saveTrail` on every cards mutation.
  - `#preSurpriseTip` + `#effectiveTip()` (last non-detour from cards+buffer) — surprise cards are detours; the next build fetches from the pre-surprise tip. Consecutive surprises share the tip (documented, accepted).
  - `addDive(title)` — `await this.#tail` to drain inflight builds (Risk-first graft: race fix), clear buffer, fetch card, append with `relation: 'dive'`, `isDetour: false` (dives re-root), refill.
  - `branchFrom` passes `noSurprise: true`.
  - `start()` calls `clearTrail()` when the new seed differs from the stored one (Risk-first graft: X→Y→X resurrection bug).
- `ArticleOverlay.svelte` — left-click on wormhole links fires `onDive(title)`; middle/cmd-click falls through to `href="/?seed=X"` (new tab, fresh wormhole) unchanged.
- `+page.svelte` — `onDive` → `feed.addDive`, close overlay, scroll to new card.

### M5 — Trail persistence + rehydration

- `feedState.svelte.ts` — `rehydrate()`: load stored trail; seed match → restore trail and fetch last `rehydrateRestoreCap` node articles in batches of 4; `#aborted` flag checked after each await (seed changed mid-rehydrate → clearTrail + start new); null fetches become tombstone skeletons with title preserved; rehydrated cards call `recordSeen`. Seed mismatch → `clearTrail()` + fresh start.
- `+page.svelte` — call `rehydrate()` before normal start; skeletons while `rehydrating`.
- `ConnectionBreadcrumb.svelte` — add 'dive' label ("Dove in from").
- TTL verified: `/api/card` wrapped in `TTL.long` (24h, src/lib/server/cache.ts) — rehydration fetches are server-cached.

### M6 — Error states: stalled vs exhausted

- `feedState.svelte.ts` — `kind: 'network'` → `status = 'stalled'`; `kind: 'empty'` → exhausted path; `retry()` resets and refills; `jumpRelated()` fetches related from chain tip with `noSurprise: true`, falls back to a `showStartOver` flag when related is also empty/seen.
- `+page.svelte` — stalled block ("Connection hiccup — retry"), exhausted block gains "Jump somewhere related" before "Start a new wormhole".

### M7 — Trail map panel

- New `src/lib/components/TrailPanel.svelte` — `<dialog>` slide-over (z-40), trail list with connection icons, detours indented, real buttons, Esc/backdrop close.
- `+page.svelte` — sticky depth chip ("N deep") opens panel; scroll targeting via `data-trail-id` (id-based, not positional — stable across tombstones).

### M8 — Profile popover

- New `src/lib/components/ProfilePopover.svelte` — top 8 tokens by effective (DF-discounted) weight, liked count, "Reset personalization" (calls `profile.reset()` + `clearTrail()` + restart to avoid empty-weight mid-build state), empty state. Header affordance with dot indicator when weights non-empty. Mobile: `w-full sm:w-72`.

### M9 — /start arrow-key nav

- `start/+page.svelte` — `highlighted = $state(-1)`; ArrowDown/Up move it; Enter uses highlighted result, else typed text; reset on results change; `aria-activedescendant` + `aria-selected`.

### M10 — Test coverage completion

Fill remaining acceptance-criteria gaps: detour tip selection (post-surprise card builds from pre-surprise tip), trail round-trip, clearTrail-on-seed-change, rehydrate seed match/mismatch. Final gates: `bun run check`, `bun run test`, `bun run build`, no new dependencies, files under 800 lines.

### File inventory

| File | Action |
|------|--------|
| src/lib/feed/types.ts | Modify |
| src/lib/feed/config.ts | Modify |
| src/lib/feed/score.ts | Modify |
| src/lib/feed/select.ts | Modify |
| src/lib/feed/feedState.svelte.ts | Modify |
| src/lib/feed/trail.ts | Create |
| src/lib/engagement/profile.svelte.ts | Modify |
| src/lib/components/ArticleCard.svelte | Modify |
| src/lib/components/ArticleOverlay.svelte | Create |
| src/lib/components/TrailPanel.svelte | Create |
| src/lib/components/ProfilePopover.svelte | Create |
| src/lib/components/ConnectionBreadcrumb.svelte | Modify |
| src/routes/+page.svelte | Modify |
| src/routes/start/+page.svelte | Modify |
| tests (co-located/new) | Modify/Create |

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Rehydration latency on cold cache | Parallel fetch, concurrency 4; restore last 20 nodes only |
| Seed changes mid-rehydrate | `#aborted` flag after each await → clearTrail + restart |
| Trail/cards divergence on null rehydration fetches | Tombstone skeletons, trail node kept, id-based scroll mapping |
| `addDive` races inflight builds | `await #tail` before buffer mutation |
| `#preSurpriseTip` vs `#tail` ordering | Set synchronously inside serialized `#doBuild` — no race |
| Discriminated-result refactor breakage | All callsites in one file; single atomic edit in M1 |
| Decay double-fire (multi-tab/hot reload) | sessionStorage sentinel; `browser` guard |
| `recordSeen` double-count of never-shown cards | Called only in `more()` on reveal |
| Variety fix split-landing | Both halves in one `#context()` edit |
| Surprise never fires on short articles | Intentional pool guard, tested |
| Consecutive surprises share pre-surprise tip | Accepted, documented; "More like this" is the escape |
| Capped tokens never pruned by decay | Intentional (cap 3 → 2.55 after one session) |
| feedState file growth | trail.ts extracted; extract rehydrate.ts if file nears 600 lines |
| jumpRelated double-failure | `showStartOver` fallback |
| `<dialog>` + Workers SSR | `showModal()` only in `$effect` |
| Stale /start highlight | reset highlighted on results change |

## Resolved gaps (defaults)

- `recordClickthrough(article: Article)` — full object, callsite already has it.
- `recordSeen` fires for rehydrated cards too (they were genuinely seen).
- branchFrom no-surprise: `noSurprise` context flag (structural, testable).
- jumpRelated is a `FeedState` method, not a synthetic-card branchFrom.
- `surpriseFloor: 0.1` (tune post-launch).
- Decay sentinel `wormhole:decay:v1` in sessionStorage; cleared by `profile.reset()`.
- TrailPanel scroll: `data-trail-id` attribute, id-based.
- Popover shows effective weights.
