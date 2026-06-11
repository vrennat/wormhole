import type { Candidate } from '$lib/wikipedia/types';
import type { EngineContext, Selection } from './types';
import { FEED } from './config';
import { scoreCandidate } from './score';
import { isPolitical } from './politics';

/** Candidates we're allowed to land on at all. */
function eligible(candidates: Candidate[], ctx: EngineContext): Candidate[] {
	return candidates.filter((c) => !c.isDisambiguation && !ctx.seenTitles.has(c.title));
}

/** Weighted-random index into `weights` (assumed non-negative, not all zero). */
function weightedIndex(weights: number[], rng: () => number): number {
	const total = weights.reduce((a, b) => a + b, 0);
	let r = rng() * total;
	for (let i = 0; i < weights.length; i++) {
		r -= weights[i];
		if (r <= 0) return i;
	}
	return weights.length - 1;
}

/** Normal softmax pick over the top-K scored candidates. */
function pickFromTopK(
	scored: { candidate: Candidate; score: number }[],
	rng: () => number
): Selection {
	const top = scored[0].score;
	const weights = scored.map((s) => Math.exp((s.score - top) / FEED.temperature));
	const idx = weightedIndex(weights, rng);
	return { candidate: scored[idx].candidate, surprised: false };
}

/**
 * Choose the next article from a candidate pool.
 *
 * Two modes:
 *  - Surprise (probability `surpriseEpsilon`, when `!ctx.noSurprise`): pick uniformly
 *    from the scored middle — candidates ranked below topK, excluding political
 *    content and sub-floor scores. Falls through to normal mode when the surprise pool
 *    is too shallow (< surpriseMinPool), preventing low-quality detours.
 *  - Default: score everyone, keep the top-K, then softmax-weighted-random among
 *    them so the feed favors strong matches without being robotically predictable.
 *
 * Returns null only when nothing is eligible (true dead end).
 */
export function selectNext(candidates: Candidate[], ctx: EngineContext): Selection | null {
	const pool = eligible(candidates, ctx);
	if (pool.length === 0) return null;

	const scored = pool
		.map((candidate) => ({ candidate, score: scoreCandidate(candidate, ctx) }))
		.sort((a, b) => b.score - a.score);

	const topKScored = scored.slice(0, FEED.topK);

	if (!ctx.noSurprise && ctx.rng() < FEED.surpriseEpsilon) {
		// Surprise pool: candidates ranked below the top-K, excluding political and
		// sub-floor scores. We want genuine serendipity, not garbage.
		const surprisePool = scored
			.slice(FEED.topK)
			.filter((s) => {
				const blob = `${s.candidate.title} ${s.candidate.description ?? ''} ${(s.candidate.categories ?? []).join(' ')}`;
				return s.score >= FEED.surpriseFloor && !isPolitical(blob);
			});

		// If the pool is too shallow, fall through to normal picks — a dud surprise is worse than none.
		if (surprisePool.length >= FEED.surpriseMinPool) {
			const idx = Math.floor(ctx.rng() * surprisePool.length);
			return { candidate: surprisePool[idx].candidate, surprised: true };
		}
	}

	// Normal path: softmax over top-K.
	if (topKScored.length === 0) return null;
	return pickFromTopK(topKScored, ctx.rng);
}
