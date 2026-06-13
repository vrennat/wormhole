import { describe, it, expect } from 'vitest';
import { buildEngineContext } from '../src/lib/feed/context';
import type { InterestPayload, SessionPayload } from '../src/lib/feed/types';

const interest: InterestPayload = {
	tokenWeights: { roman: 2, empire: 1 },
	tokenAvoidWeights: { aqueduct: 0.5 },
	tokenDocFreq: { roman: 3 },
	taste: 'history'
};

const session: SessionPayload = {
	seenTitles: ['Roman Empire', 'Aqueduct'],
	recentTokens: ['roman', 'water'],
	noSurprise: true,
	stepIndex: 7
};

describe('buildEngineContext', () => {
	describe('happy path', () => {
		it('rebuilds Sets from the wire arrays and passes through the interest vector', () => {
			const ctx = buildEngineContext(interest, session, () => 0.5);

			expect(ctx.tokenWeights).toEqual({ roman: 2, empire: 1 });
			expect(ctx.tokenAvoidWeights).toEqual({ aqueduct: 0.5 });
			expect(ctx.tokenDocFreq).toEqual({ roman: 3 });
			expect(ctx.taste).toBe('history');
			expect(ctx.seenTitles).toBeInstanceOf(Set);
			expect(ctx.seenTitles.has('Aqueduct')).toBe(true);
			expect(ctx.recentTokens).toBeInstanceOf(Set);
			expect(ctx.recentTokens.has('water')).toBe(true);
			expect(ctx.noSurprise).toBe(true);
			expect(ctx.stepIndex).toBe(7);
			expect(ctx.rng()).toBe(0.5);
		});
	});

	describe('extraSeen (retry-loop blocking)', () => {
		it('merges blocked titles into seenTitles without mutating the payload', () => {
			const ctx = buildEngineContext(interest, session, Math.random, ['Dud Page']);

			expect(ctx.seenTitles.has('Dud Page')).toBe(true);
			expect(ctx.seenTitles.has('Roman Empire')).toBe(true);
			expect(session.seenTitles).toEqual(['Roman Empire', 'Aqueduct']);
		});
	});

	describe('defaults', () => {
		it('tolerates missing fields by defaulting to empty', () => {
			const ctx = buildEngineContext(
				{ tokenWeights: {}, tokenDocFreq: {} },
				{ seenTitles: [], recentTokens: [] }
			);

			expect(ctx.seenTitles.size).toBe(0);
			expect(ctx.recentTokens.size).toBe(0);
			expect(ctx.tokenAvoidWeights).toEqual({});
			expect(ctx.taste).toBe('balanced');
			expect(ctx.noSurprise).toBe(false);
			expect(ctx.stepIndex).toBe(0);
		});

		it('normalizes unknown taste values for older or malformed clients', () => {
			const ctx = buildEngineContext(
				{ tokenWeights: {}, tokenDocFreq: {}, taste: 'weird' as never },
				{ seenTitles: [], recentTokens: [] }
			);

			expect(ctx.taste).toBe('balanced');
		});
	});
});
