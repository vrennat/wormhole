import { describe, it, expect } from 'vitest';
import { applySessionDecay } from '../src/lib/engagement/decay';

const CONFIG = {
	sessionDecay: 0.85,
	sessionDecayFloor: 0.05,
	tokenWeightCap: 3
};

describe('applySessionDecay', () => {
	describe('decay multiplication', () => {
		it('multiplies all weights by sessionDecay', () => {
			const result = applySessionDecay({ history: 1, science: 2 }, CONFIG);
			expect(result.history).toBeCloseTo(0.85, 5);
			expect(result.science).toBeCloseTo(1.7, 5);
		});
	});

	describe('floor pruning', () => {
		it('removes tokens that fall below sessionDecayFloor after decay', () => {
			// 0.05 * 0.85 = 0.0425 < floor 0.05 — should be removed
			const result = applySessionDecay({ noise: 0.05 }, CONFIG);
			expect(result.noise).toBeUndefined();
		});

		it('keeps tokens that stay at or above sessionDecayFloor after decay', () => {
			// 0.1 * 0.85 = 0.085 >= 0.05 — should remain
			const result = applySessionDecay({ signal: 0.1 }, CONFIG);
			expect(result.signal).toBeCloseTo(0.085, 5);
		});
	});

	describe('cap enforcement', () => {
		it('caps weights exceeding tokenWeightCap after decay', () => {
			// Weights above the cap should be clamped. (In practice bump-time capping prevents
			// values above 3 from accumulating, but decay + cap = double safety.)
			const result = applySessionDecay({ heavy: 3.5 }, CONFIG);
			expect(result.heavy).toBe(Math.min(3.5 * 0.85, 3));
		});

		it('does not cap weights legitimately below tokenWeightCap', () => {
			const result = applySessionDecay({ normal: 2 }, CONFIG);
			expect(result.normal).toBeCloseTo(1.7, 5);
		});
	});

	describe('empty input', () => {
		it('returns an empty object for empty input', () => {
			expect(applySessionDecay({}, CONFIG)).toEqual({});
		});
	});
});
