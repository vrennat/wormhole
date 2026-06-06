import type { Candidate } from '$lib/wikipedia/types';
import type { EngineContext } from './types';
import { FEED } from './config';
import { isPolitical } from './politics';
import { tokenize } from './tokens';

/**
 * Score a single candidate as the next step. Pure: same inputs -> same output.
 *
 * Returns -Infinity for candidates we must never pick (already seen, disambiguation),
 * so callers can filter them out uniformly.
 */
export function scoreCandidate(candidate: Candidate, ctx: EngineContext): number {
	if (ctx.seenTitles.has(candidate.title)) return -Infinity;
	if (candidate.isDisambiguation) return -Infinity;

	const tokens = tokenize(`${candidate.title} ${candidate.description ?? ''}`);

	let relevance = 0;
	let overlap = 0;
	for (const token of tokens) {
		relevance += ctx.tokenWeights[token] ?? 0;
		if (ctx.recentTokens.has(token)) overlap += 1;
	}

	let score = FEED.base;
	// tanh squashes the interest sum into [-1, 1] so a few hot tokens can't dominate.
	score += FEED.relevanceWeight * Math.tanh(relevance);
	score += overlap * FEED.varietyPenalty;
	if (candidate.thumbnail) score += FEED.imageBonus;
	if (candidate.relation === 'related') score += FEED.relatedPenalty;

	// Prominence: links earlier in the article (lead section) are the real rabbit-hole
	// connections. Exponential decay so the first handful get a strong, tapering boost.
	const position = candidate.position ?? FEED.positionHalfLife;
	score += FEED.positionWeight * Math.exp(-position / FEED.positionHalfLife);

	// Dampen politics, matching title + description + (when present) categories.
	const categories = candidate.categories ?? [];
	const blob = `${candidate.title} ${candidate.description ?? ''} ${categories.join(' ')}`;
	if (isPolitical(blob)) score += FEED.politicalPenalty;

	return score;
}
