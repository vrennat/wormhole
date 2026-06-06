import { describe, it, expect } from 'vitest';
import type { Candidate } from '../src/lib/wikipedia/types';
import type { EngineContext } from '../src/lib/feed/types';
import { scoreCandidate } from '../src/lib/feed/score';
import { selectNext } from '../src/lib/feed/select';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
	return {
		title: 'Aqueduct',
		description: 'water channel',
		thumbnail: { source: 'x', width: 1, height: 1 },
		isDisambiguation: false,
		relation: 'link',
		categories: [],
		position: 0,
		...overrides
	};
}

function context(overrides: Partial<EngineContext> = {}): EngineContext {
	return {
		tokenWeights: {},
		recentTokens: new Set(),
		seenTitles: new Set(),
		rng: () => 0.5,
		...overrides
	};
}

/** Deterministic RNG that yields a fixed sequence, repeating the last value. */
function seq(values: number[]): () => number {
	let i = 0;
	return () => values[Math.min(i++, values.length - 1)];
}

describe('scoreCandidate', () => {
	describe('exclusions', () => {
		it('excludes already-seen titles', () => {
			const ctx = context({ seenTitles: new Set(['Aqueduct']) });
			expect(scoreCandidate(candidate(), ctx)).toBe(-Infinity);
		});

		it('excludes disambiguation pages', () => {
			expect(scoreCandidate(candidate({ isDisambiguation: true }), context())).toBe(-Infinity);
		});
	});

	describe('relevance', () => {
		it('scores a candidate matching the interest vector higher', () => {
			const ctx = context({ tokenWeights: { water: 2, channel: 2 } });
			const relevant = scoreCandidate(candidate(), ctx);
			const irrelevant = scoreCandidate(
				candidate({ title: 'Jazz', description: 'music genre' }),
				ctx
			);
			expect(relevant).toBeGreaterThan(irrelevant);
		});
	});

	describe('signals', () => {
		it('rewards a lead image', () => {
			const withImage = scoreCandidate(candidate(), context());
			const without = scoreCandidate(candidate({ thumbnail: null }), context());
			expect(withImage).toBeGreaterThan(without);
		});

		it('penalizes overlap with recently shown articles (variety)', () => {
			const ctx = context({ recentTokens: new Set(['water', 'channel']) });
			const monotonous = scoreCandidate(candidate(), ctx);
			const fresh = scoreCandidate(candidate({ title: 'Volcano', description: 'erupting mountain' }), ctx);
			expect(fresh).toBeGreaterThan(monotonous);
		});

		it('slightly prefers real links over related fallbacks', () => {
			const link = scoreCandidate(candidate({ relation: 'link' }), context());
			const related = scoreCandidate(candidate({ relation: 'related' }), context());
			expect(link).toBeGreaterThan(related);
		});

		it('prefers prominent (earlier-in-article) links', () => {
			const lead = scoreCandidate(candidate({ position: 0 }), context());
			const deep = scoreCandidate(candidate({ position: 40 }), context());
			expect(lead).toBeGreaterThan(deep);
		});
	});

	describe('political dampening', () => {
		it('sinks political candidates far below neutral ones', () => {
			const neutral = scoreCandidate(candidate({ title: 'Volcano', description: 'mountain' }), context());
			const political = scoreCandidate(
				candidate({ title: '2020 United States presidential election', description: 'US election' }),
				context()
			);
			expect(political).toBeLessThan(neutral - 100);
		});

		it('detects politics from categories when title/description look neutral', () => {
			const c = candidate({
				title: 'John Q. Public',
				description: 'American lawyer',
				categories: ['Category:United States senators from Ohio']
			});
			expect(scoreCandidate(c, context())).toBeLessThan(0);
		});

		it('does not dampen apolitical articles', () => {
			expect(scoreCandidate(candidate({ title: 'Octopus', description: 'mollusc' }), context()))
				.toBeGreaterThan(0);
		});

		it('keeps political candidates eligible (soft penalty, not a block)', () => {
			// Even heavily penalized, a political candidate is still selectable if it's all there is.
			const pool = [candidate({ title: 'United States Congress', description: 'legislature' })];
			expect(selectNext(pool, context({ rng: seq([0.99, 0]) }))).not.toBeNull();
		});
	});
});

describe('selectNext', () => {
	describe('dead ends', () => {
		it('returns null when nothing is eligible', () => {
			expect(selectNext([], context())).toBeNull();
		});

		it('returns null when every candidate was already seen', () => {
			const ctx = context({ seenTitles: new Set(['Aqueduct']) });
			expect(selectNext([candidate()], ctx)).toBeNull();
		});
	});

	describe('relevance mode', () => {
		it('picks the top scorer when RNG points at the strongest weight', () => {
			// rng[0]=0.99 skips surprise; rng[1]=0 selects the first (highest) softmax bucket.
			const ctx = context({
				tokenWeights: { roman: 5 },
				rng: seq([0.99, 0])
			});
			const pool = [
				candidate({ title: 'Jazz', description: 'music' }),
				candidate({ title: 'Roman Empire', description: 'roman state' })
			];
			const result = selectNext(pool, ctx);
			expect(result?.candidate.title).toBe('Roman Empire');
			expect(result?.surprised).toBe(false);
		});

		it('never selects a disambiguation page', () => {
			const ctx = context({ rng: seq([0.99, 0]) });
			const pool = [candidate({ title: 'Mercury', isDisambiguation: true }), candidate()];
			expect(selectNext(pool, ctx)?.candidate.isDisambiguation).toBe(false);
		});
	});

	describe('surprise mode', () => {
		it('fires when RNG falls under the epsilon and flags the selection', () => {
			// rng[0]=0 triggers surprise; rng[1]=0 picks pool[0].
			const ctx = context({ rng: seq([0, 0]) });
			const pool = [candidate({ title: 'A' }), candidate({ title: 'B' })];
			const result = selectNext(pool, ctx);
			expect(result?.surprised).toBe(true);
			expect(result?.candidate.title).toBe('A');
		});
	});
});
