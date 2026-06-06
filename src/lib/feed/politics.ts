/**
 * Political-content detection for feed dampening.
 *
 * The feed tends to slide into presidential elections and party politics. We match
 * a candidate's title + description + categories against these stems and apply a
 * heavy (but non-blocking) score penalty so politics stops dominating the rabbit hole.
 *
 * Stems are deliberately broad ("politic" catches political/politician/politics,
 * "president" catches presidential/presidency). Tune here.
 */
export const POLITICAL_STEMS = [
	'election',
	'electoral',
	'president',
	'politic', // political, politician, politics, political party
	'senat', // senate, senator
	'congress',
	'parliament',
	'governor',
	'prime minister',
	'vice president',
	'ballot',
	'referend', // referendum, referenda
	'legislat', // legislature, legislator, legislative
	'political campaign',
	'democratic party',
	'republican party'
] as const;

const PATTERN = new RegExp(`\\b(${POLITICAL_STEMS.join('|')})`, 'i');

/** True if the text reads as political (elections, presidents, parties, politicians, …). */
export function isPolitical(text: string): boolean {
	return PATTERN.test(text);
}
