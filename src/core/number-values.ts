/**
 * Numbers a query compares a task's own number fields with (T-0951):
 * `estimate:3`, `estimate:>3`, `comments:<=2`, `estimate:3..8` (both ends
 * included). Stored as written, tidied (`> 3.0` -> `>3`), so they print
 * back the same and live in a filter list like any other value.
 *
 * An estimate can also be a length of time -- `estimate:>2h`,
 * `estimate:30m..1d`, `estimate:1h30m` -- for a workspace whose estimates
 * are time, saved in minutes. A bare number there is hours, the way a time
 * estimate is typed on a task (`estimatesInTime` on the workspace).
 */

/** A day, for `1d`: a working day, as the app reads a typed `2d`. */
export const ESTIMATE_HOURS_PER_DAY = 8;

const AMOUNT = String.raw`-?\d+(?:\.\d+)?`;
const DURATION = String.raw`(?:\d+(?:\.\d+)?[dhm])+`;
const COMPARED = new RegExp(`^(>=|<=|>|<)?\\s*(${AMOUNT})$`);
const RANGE = new RegExp(`^(${AMOUNT})\\s*\\.\\.\\s*(${AMOUNT})$`);
const COMPARED_TIME = new RegExp(`^(>=|<=|>|<)?\\s*(${AMOUNT}|${DURATION})$`);
const RANGE_TIME = new RegExp(`^(${AMOUNT}|${DURATION})\\s*\\.\\.\\s*(${AMOUNT}|${DURATION})$`);

const UNIT_MINUTES: Record<string, number> = { d: ESTIMATE_HOURS_PER_DAY * 60, h: 60, m: 1 };

/** `2h` / `1h30m` as a tidy amount: lowercase, no spaces, numbers as numbers. */
function tidyAmount(amount: string): string {
	if (!/[dhm]/.test(amount)) return String(Number(amount));
	return amount.replace(/\d+(?:\.\d+)?/g, (n) => String(Number(n)));
}

/** A number value as a filter stores it, or null when it isn't one.
 *  `durations` lets it be a length of time too (an estimate's). */
export function normalizeNumberValue(raw: string, { durations = false }: { durations?: boolean } = {}): string | null {
	// `1h 30m` and `2 h` are `1h30m` and `2h`.
	const text = durations ? raw.trim().toLowerCase().replace(/(\d)\s+(?=[dhm])/g, "$1").replace(/([dhm])\s+(?=\d)/g, "$1") : raw.trim();
	const range = (durations ? RANGE_TIME : RANGE).exec(text);
	if (range) return `${tidyAmount(range[1])}..${tidyAmount(range[2])}`;
	const compared = (durations ? COMPARED_TIME : COMPARED).exec(text);
	if (compared) return `${compared[1] ?? ""}${tidyAmount(compared[2])}`;
	return null;
}

/** An amount as the number it's compared with: a length of time in
 *  minutes, a bare number times `bare` (60 when bare numbers are hours). */
function amountOf(amount: string, bare: number): number {
	if (!/[dhm]/.test(amount)) return Number(amount) * bare;
	let total = 0;
	for (const [, n, unit] of amount.matchAll(/(\d+(?:\.\d+)?)([dhm])/g)) total += Number(n) * UNIT_MINUTES[unit];
	return total;
}

/** Whether `actual` meets a stored number value. A value that isn't one
 *  (saved by hand) meets nothing. `bareHours`: the field is in minutes
 *  and a bare number means hours (a time estimate's). */
export function matchesNumberValue(actual: number, value: string, { bareHours = false }: { bareHours?: boolean } = {}): boolean {
	const bare = bareHours ? 60 : 1;
	const range = RANGE_TIME.exec(value);
	if (range) return amountOf(range[1], bare) <= actual && actual <= amountOf(range[2], bare);
	const compared = COMPARED_TIME.exec(value);
	if (!compared) return false;
	const n = amountOf(compared[2], bare);
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
