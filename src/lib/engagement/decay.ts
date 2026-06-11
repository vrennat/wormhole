/**
 * Pure decay math extracted so it can be unit-tested without DOM/browser APIs.
 *
 * Decay is applied once per session (gated by a sessionStorage sentinel in the
 * caller) to prevent stale interests from permanently dominating the feed.
 */

interface DecayConfig {
	sessionDecay: number;
	sessionDecayFloor: number;
	tokenWeightCap: number;
}

/**
 * Apply session decay to a token weight map.
 *
 * - Multiplies each weight by `sessionDecay`.
 * - Removes tokens that fall below `sessionDecayFloor` (they've faded to noise).
 * - Caps any weight exceeding `tokenWeightCap` (so bump-time capping is reflected after decay too).
 */
export function applySessionDecay(
	weights: Record<string, number>,
	config: DecayConfig
): Record<string, number> {
	const result: Record<string, number> = {};
	for (const [token, weight] of Object.entries(weights)) {
		const decayed = weight * config.sessionDecay;
		if (decayed >= config.sessionDecayFloor) {
			result[token] = Math.min(decayed, config.tokenWeightCap);
		}
	}
	return result;
}
