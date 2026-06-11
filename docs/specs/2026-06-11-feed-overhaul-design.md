# Feed Overhaul: Engagement Signals + Persistent Trail

Date: 2026-06-11
Status: approved for implementation
Source: code review of the feed engine and UX (2026-06-11 session)

## Overview

Two coordinated workstreams, coupled through `feedState`:

1. **Engine** — fix the engagement-signal pipeline so the interest vector reflects
   real preference (clickthrough signal, decay, document-frequency discounting) and
   make surprise jumps a feature instead of a chain-derailing bug.
2. **Trail** — redesign client feed state around a persistent, branch-aware trail so
   refresh, back-navigation, and in-article dives never destroy the wormhole, plus
   the UI that makes the trail visible (trail map, error states, reader overlay,
   profile panel).

The engine stays a pure module (`src/lib/feed/`); changes there are surgical. The
client state layer (`feedState.svelte.ts`) and feed page are redesigned.

## Goals

- The interest vector tracks current, genuine preference — not "everything ever scrolled past".
- Surprise jumps add serendipity without re-rooting the chain on a dud.
- A wormhole survives refresh, back button, and diving into in-article links.
- Transient network failure is recoverable and visually distinct from a true dead end.
- The trail (the app's whole premise) is visible and navigable.
- Reading works well on mobile.
- The personalization loop is visible and resettable.

## Non-goals

- Shareable trail URLs (future; the trail model is designed so titles+relations can serialize to a URL later).
- Server-side profiles or accounts. localStorage/sessionStorage only.
- Multi-wormhole history page.
- Re-tuning `positionWeight`/`imageBonus`/prominence — recent commits already iterated those from observed behavior.

## Workstream 1: Engine

### 1.1 Clickthrough feeds the interest vector

`recordClickthrough` currently stores titles that nothing reads. Expanding an
article is the strongest intent signal in the app. Change: on first clickthrough of
a title, bump its tokens by `clickthroughTokenWeight: 0.7` (between dwell 0.35 and
like 1.0). Keep the title list for dedupe.

### 1.2 Interest vector decay

`tokenWeights` only grows, across sessions, forever. Change: on profile load (once
per session start), multiply all weights by `sessionDecay: 0.85` and drop tokens
below `0.05`. Also cap any single token at `tokenWeightCap: 3` at bump time so no
token saturates the vector. Dwell stays as a signal but its weight drops to `0.2`
now that clickthrough carries explicit-read intent.

### 1.3 Document-frequency discounting

Liking three American musicians makes "american" dominate. Change: profile tracks
`tokenDocFreq` (how many distinct seen cards contained each token) and `seenCount`.
Every card shown calls `recordSeen(article)` once. The engine receives both via
`EngineContext` and discounts: `effectiveWeight(token) = weight / (1 + Math.log(1 + df))`.
Pure, computed in `score.ts`. Also soften the near-binary squash: `tanh(relevance / 2)`
instead of `tanh(relevance)` so one matched token gives ~0.46 of max instead of 0.76.

### 1.4 Surprise jumps: detour, don't derail

Current: 18% uniform pick over up to 50 candidates, bypasses the political filter,
and the chain continues from it. Changes:

- Surprise samples uniformly from the **scored middle** — candidates ranked below
  `topK` after scoring, excluding `isPolitical` and bottom-floor scores. If the pool
  has fewer than `topK + 3` candidates, skip the surprise this round.
- A surprise card is a **detour**: the next card is built from the pre-surprise tip,
  so a dud jump self-heals. "More like this" on the surprise card is the explicit
  way to adopt the detour as the new direction (existing affordance, no new UI).
- `branchFrom` ("More like this") gets an epsilon-0 context — it must never surprise.

### 1.5 Variety penalty scope

The immediate parent card sits inside `recentWindow`, so candidates are penalized
for sharing tokens with the very article that links them — punishing on-topic
continuation while loops longer than 3 cards go free. Change: exclude the immediate
parent from `recentTokens`; widen `recentWindow` to 5.

### Engine config deltas (`config.ts`)

| Knob | From | To |
| --- | --- | --- |
| `clickthroughTokenWeight` | — | 0.7 |
| `dwellTokenWeight` | 0.35 | 0.2 |
| `sessionDecay` | — | 0.85 |
| `tokenWeightCap` | — | 3 |
| `recentWindow` | 3 | 5 |
| relevance squash | `tanh(x)` | `tanh(x / 2)` |

## Workstream 2: Trail

### 2.1 Trail model + persistence

Replace the implicit chain with an explicit trail. Each entry:

```ts
interface TrailNode {
  id: string;
  title: string;
  relation: Relation;     // 'seed' | 'link' | 'related' | 'surprise' | 'dive'
  fromTitle: string;
  isDetour: boolean;      // surprise detours; chain tip skips these
}
```

- `feedState` derives the chain tip as the last non-detour node.
- Persist `{ seedTitle, trail }` (titles + relations only — tiny) to
  `sessionStorage` (`wormhole:trail:v1`) on every change, capped at 100 nodes.
- On load with a matching seed param (or no seed param), rehydrate: restore trail
  nodes and refetch article cards by title through `/api/card` (server-cached,
  cheap). Show skeletons during rehydrate. A *different* seed param starts fresh.

### 2.2 In-article dives join the trail

Links inside the expanded reader currently `goto('/?seed=X')`, resetting
everything. Change: a dive **appends to the current trail** with relation `'dive'`
(breadcrumb: "Dove in from <article>"), closes the reader, scrolls to the new card,
and continues the chain from it (a dive is deliberate — it re-roots, unlike a
surprise). The URL keeps the original seed; sessionStorage holds the truth.
Middle/cmd-click still opens a fresh wormhole in a new tab via the rewritten href.

### 2.3 Error vs exhausted

`fetchLinksApi`/`fetchCardApi` return a discriminated result
(`{ ok: true, ... } | { ok: false }`) instead of swallowing errors into `[]`/`null`.
New status value `'stalled'`: shown with "Connection hiccup — retry" (button re-runs
the build). `'exhausted'` is only set when Wikipedia genuinely returns zero usable
candidates; its end-card offers **"Jump somewhere related"** (one `fetchRelated`
hop from the tip) before "Start a new wormhole".

### 2.4 Trail map UI

- Sticky chip in the header area: "12 deep" — always visible (replaces the
  scroll-away counter).
- Tapping it opens a slide-over panel listing the trail: connection icon + title
  per node, detours visually indented. Tapping a node scrolls to its card.
- Keyboard accessible (it's a real `<button>` + dialog semantics).

### 2.5 Reader overlay

The inline 75vh nested scroll area becomes a full-screen overlay (`fixed inset-0`,
own scroll, sticky header with title + close). Esc and close button collapse it.
Dives (2.2) launch from here. Card body keeps the extract + actions; "Read article"
opens the overlay. This removes the nested-scroll trap on mobile.

### 2.6 Profile visibility + reset

Small popover from a header affordance ("Tuned for you" dot once `tokenWeights` is
non-empty): shows top ~8 interest tokens by effective weight, liked count, and a
"Reset personalization" button wired to the existing `profile.reset()`.

### 2.7 Small fixes riding along

- Search results on /start: arrow-key navigation; Enter selects the highlighted
  result, plain Enter with no highlight uses the typed text (not silently `results[0]`).
- Card tap-to-read gets a keyboard path via the existing "Read article" button being
  focusable first in DOM order (no change to pointer behavior).

## Open questions (resolved with defaults)

| Question | Default |
| --- | --- |
| Decay rate / cadence | x0.85 once per session start |
| Clickthrough token weight | 0.7 |
| DF discount formula | `w / (1 + ln(1 + df))` |
| Trail persistence scope | sessionStorage (per-tab); localStorage would resurrect stale trails days later |
| Trail cap | 100 nodes |
| Surprise skip threshold | pool < topK + 3 |
| Dwell signal | kept at 0.2, not removed — passive interest still carries some information once decay bounds it |

## Acceptance criteria

- Engine changes covered by vitest unit tests (pure functions): DF discounting,
  decay+cap, surprise sampling pool, detour tip selection, epsilon-0 branch context.
- Reload mid-feed restores the same trail (titles + relations) with no duplicate fetch storm.
- Killing the network mid-scroll shows the retry state; retrying after restore continues the feed; a genuine zero-candidate page shows exhausted + related-jump.
- Expanding an article updates `tokenWeights` (visible in the profile popover).
- A dive from the reader appends to the trail; Back does not destroy the feed.
- Surprise card followed by a normal card: the normal card's `fromTitle` is the pre-surprise tip.
- `bun run check` and `bun run test` pass; no new dependencies.
