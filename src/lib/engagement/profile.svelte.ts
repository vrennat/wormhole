import { browser } from '$app/environment';
import type { Article } from '$lib/wikipedia/types';
import { FEED } from '$lib/feed/config';
import { tokenize } from '$lib/feed/tokens';
import { applySessionDecay } from './decay';

const STORAGE_KEY = 'tangent:profile:v1';

interface Persisted {
	likedTitles: string[];
	clickthroughs: string[];
	engagedTitles: string[];
	tokenWeights: Record<string, number>;
	dwellMsByTitle: Record<string, number>;
	tokenDocFreq: Record<string, number>;
	seenCount: number;
	seenForDfTitles: string[];
}

const EMPTY: Persisted = {
	likedTitles: [],
	clickthroughs: [],
	engagedTitles: [],
	tokenWeights: {},
	dwellMsByTitle: {},
	tokenDocFreq: {},
	seenCount: 0,
	seenForDfTitles: []
};

function load(): Persisted {
	if (!browser) return structuredClone(EMPTY);
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return structuredClone(EMPTY);
		return { ...structuredClone(EMPTY), ...JSON.parse(raw) };
	} catch {
		return structuredClone(EMPTY);
	}
}

/**
 * The user's engagement profile, persisted to localStorage.
 *
 * It owns the interest vector (`tokenWeights`) that the feed engine reads to bias
 * relevance. Likes weigh heavily; explicit clickthrough reads weigh moderately;
 * passive dwell weighs lightly. Reactive ($state) so the UI updates instantly.
 *
 * Session decay (x0.85) runs once per tab session via a sessionStorage sentinel so
 * stale interests fade without accumulating indefinitely across page loads.
 */
class EngagementProfile {
	likedTitles = $state<string[]>([]);
	clickthroughs = $state<string[]>([]);
	tokenWeights = $state<Record<string, number>>({});
	tokenDocFreq = $state<Record<string, number>>({});
	seenCount = $state(0);

	#engaged = new Set<string>();
	#dwellMs: Record<string, number> = {};
	// Titles we've already counted in tokenDocFreq — dedupe across the session.
	#seenForDfTitles = new Set<string>();

	constructor() {
		const data = load();
		this.likedTitles = data.likedTitles;
		this.clickthroughs = data.clickthroughs;
		this.tokenWeights = data.tokenWeights;
		this.tokenDocFreq = data.tokenDocFreq;
		this.seenCount = data.seenCount;
		this.#engaged = new Set(data.engagedTitles);
		this.#dwellMs = data.dwellMsByTitle;
		this.#seenForDfTitles = new Set(data.seenForDfTitles);

		// Once per tab session: decay weights so old interests fade.
		if (browser && !sessionStorage.getItem(FEED.decayStorageKey)) {
			this.tokenWeights = applySessionDecay(this.tokenWeights, {
				sessionDecay: FEED.sessionDecay,
				sessionDecayFloor: FEED.sessionDecayFloor,
				tokenWeightCap: FEED.tokenWeightCap
			});
			sessionStorage.setItem(FEED.decayStorageKey, '1');
			this.#save();
		}
	}

	isLiked(title: string): boolean {
		return this.likedTitles.includes(title);
	}

	toggleLike(article: Article): void {
		if (this.isLiked(article.title)) {
			this.likedTitles = this.likedTitles.filter((t) => t !== article.title);
			this.#bumpTokens(article, -FEED.likeTokenWeight);
		} else {
			this.likedTitles = [...this.likedTitles, article.title];
			this.#bumpTokens(article, FEED.likeTokenWeight);
		}
		this.#save();
	}

	/**
	 * Record that the user actively opened this article to read it.
	 * First clickthrough bumps the interest vector by `clickthroughTokenWeight`.
	 */
	recordClickthrough(article: Article): void {
		if (!this.clickthroughs.includes(article.title)) {
			this.clickthroughs = [...this.clickthroughs, article.title];
			this.#bumpTokens(article, FEED.clickthroughTokenWeight);
			this.#save();
		}
	}

	/**
	 * Record that this article was shown to the user (revealed in the feed).
	 * Updates document-frequency counts for DF-discounting in the engine.
	 * Deduped by title so scrolling past the same card twice doesn't double-count.
	 */
	recordSeen(article: Article): void {
		if (this.#seenForDfTitles.has(article.title)) return;
		this.#seenForDfTitles.add(article.title);
		this.seenCount = this.seenCount + 1;

		const tokens = new Set(tokenize(`${article.title} ${article.description ?? ''}`));
		const nextDf = { ...this.tokenDocFreq };
		for (const token of tokens) {
			nextDf[token] = (nextDf[token] ?? 0) + 1;
		}
		this.tokenDocFreq = nextDf;
		this.#save();
	}

	/** Accumulate dwell time; once an article crosses the threshold, count it lightly. */
	recordDwell(article: Article, ms: number): void {
		const next = (this.#dwellMs[article.title] ?? 0) + ms;
		this.#dwellMs[article.title] = next;
		if (next >= FEED.dwellThresholdMs && !this.#engaged.has(article.title)) {
			this.#engaged.add(article.title);
			this.#bumpTokens(article, FEED.dwellTokenWeight);
		}
		this.#save();
	}

	reset(): void {
		this.likedTitles = [];
		this.clickthroughs = [];
		this.tokenWeights = {};
		this.tokenDocFreq = {};
		this.seenCount = 0;
		this.#engaged = new Set();
		this.#dwellMs = {};
		this.#seenForDfTitles = new Set();
		// Remove the decay sentinel so the fresh profile gets decayed when the session restarts.
		if (browser) sessionStorage.removeItem(FEED.decayStorageKey);
		this.#save();
	}

	#bumpTokens(article: Article, delta: number): void {
		const tokens = new Set(tokenize(`${article.title} ${article.description ?? ''}`));
		const next = { ...this.tokenWeights };
		for (const token of tokens) {
			const value = (next[token] ?? 0) + delta;
			if (value <= 0) {
				delete next[token];
			} else {
				// Cap prevents any single token from saturating the vector.
				next[token] = Math.min(value, FEED.tokenWeightCap);
			}
		}
		this.tokenWeights = next;
	}

	#save(): void {
		if (!browser) return;
		const data: Persisted = {
			likedTitles: this.likedTitles,
			clickthroughs: this.clickthroughs,
			engagedTitles: [...this.#engaged],
			tokenWeights: this.tokenWeights,
			dwellMsByTitle: this.#dwellMs,
			tokenDocFreq: this.tokenDocFreq,
			seenCount: this.seenCount,
			seenForDfTitles: [...this.#seenForDfTitles]
		};
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		} catch {
			// localStorage full or unavailable — degrade silently, engagement is best-effort.
		}
	}
}

export const profile = new EngagementProfile();
