/**
 * Numbers a query compares a task's own number fields with (T-0951):
 * `estimate:3`, `estimate:>3`, `comments:<=2`, `estimate:3..8` (both ends
 * included). Stored as written, tidied (`> 3.0` -> `>3`), so they print
 * back the same and live in a filter list like any other value.
 */

const COMPARED = /^(>=|<=|>|<)?\s*(-?\d+(?:\.\d+)?)$/;
const RANGE = /^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/;

/** A number value as a filter stores it, or null when it isn't one. */
export function normalizeNumberValue(raw: string): string | null {
	const text = raw.trim();
	const range = RANGE.exec(text);
	if (range) return `${Number(range[1])}..${Number(range[2])}`;
	const compared = COMPARED.exec(text);
	if (compared) return `${compared[1] ?? ""}${Number(compared[2])}`;
	return null;
}

/** Whether `actual` meets a stored number value. A value that isn't one
 *  (saved by hand) meets nothing. */
export function matchesNumberValue(actual: number, value: string): boolean {
	const range = RANGE.exec(value);
	if (range) return Number(range[1]) <= actual && actual <= Number(range[2]);
	const compared = COMPARED.exec(value);
	if (!compared) return false;
	const n = Number(compared[2]);
	switch (compared[1]) {
		case ">":
			return actual > n;
		case ">=":
			return actual >= n;
		case "<":
			return actual < n;
		case "<=":
			return actual <= n;
		default:
			return actual === n;
	}
}
