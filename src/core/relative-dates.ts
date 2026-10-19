/**
 * Dates a query can name without a fixed day (T-0950): `today`,
 * `yesterday`, `tomorrow`, an offset from one of them (`today-28d`,
 * `today+2w`), a named period (`this-week`, `last-month`, `last-7-days`) or
 * a range of either (`2026-10-01..2026-10-31`, `today-7d..today`).
 *
 * A query keeps them as written -- a saved view, dashboard or link stores
 * `due-before:today` -- and they become days only when the query runs,
 * against the `today` the caller passes in (`ViewContext.today`). That's
 * what lets a view of "past due" move on by itself every day.
 *
 * Every value is a span of days, `from` to `to` (both included): a day is a
 * span of one. `due:this-week` is a day in the span, `due-before:` is before
 * its first day and `due-after:` after its last. Weeks run Monday to Sunday.
 */

import { isValidIsoDay } from "./date";
import type { IsoDate } from "./types";

export interface DateSpan {
	from: IsoDate;
	to: IsoDate;
}

type Unit = "d" | "w" | "m" | "y";

const ANCHORS: Record<string, number> = { today: 0, yesterday: -1, tomorrow: 1 };
const RELATIVE = /^(today|yesterday|tomorrow)(?:([+-])(\d{1,4})([dwmy]))?$/;
const PERIOD = /^(this|last|next)-(week|month|quarter|year)$/;
const ROLLING = /^(last|next)-(\d{1,4})-(days?|weeks?|months?|years?)$/;
const RANGE = "..";

/** Words a date clause takes besides a day, in the order suggestions show
 *  them. */
export const DATE_WORDS = [
	"today",
	"yesterday",
	"tomorrow",
	"this-week",
	"last-week",
	"next-week",
	"this-month",
	"last-month",
	"next-month",
	"this-quarter",
	"last-quarter",
	"next-quarter",
	"this-year",
	"last-year",
	"next-year",
	"last-7-days",
	"last-30-days",
	"next-7-days",
	"next-30-days",
] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (date: Date): IsoDate => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const fromIso = (day: IsoDate) => new Date(`${day}T00:00:00Z`);

/** `day` moved by `n` days. */
function addDays(day: IsoDate, n: number): IsoDate {
	const date = fromIso(day);
	date.setUTCDate(date.getUTCDate() + n);
	return toIso(date);
}

/** `day` moved by `n` months, on the same day of the month or the last
 *  day of a shorter one (Jan 31 + 1 month is Feb 28). */
function addMonths(day: IsoDate, n: number): IsoDate {
	const date = fromIso(day);
	const wanted = date.getUTCDate();
	date.setUTCDate(1);
	date.setUTCMonth(date.getUTCMonth() + n);
	const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
	date.setUTCDate(Math.min(wanted, last));
	return toIso(date);
}

function shift(day: IsoDate, n: number, unit: Unit): IsoDate {
	if (unit === "d") return addDays(day, n);
	if (unit === "w") return addDays(day, n * 7);
	if (unit === "m") return addMonths(day, n);
	return addMonths(day, n * 12);
}

/** The Monday of `day`'s week. */
function startOfWeek(day: IsoDate): IsoDate {
	const weekday = (fromIso(day).getUTCDay() + 6) % 7;
	return addDays(day, -weekday);
}

function period(which: "this" | "last" | "next", size: "week" | "month" | "quarter" | "year", today: IsoDate): DateSpan {
	const step = which === "this" ? 0 : which === "last" ? -1 : 1;
	if (size === "week") {
		const from = addDays(startOfWeek(today), step * 7);
		return { from, to: addDays(from, 6) };
	}
	const months = size === "month" ? 1 : size === "quarter" ? 3 : 12;
	const date = fromIso(today);
	const month = date.getUTCMonth();
	const first = size === "year" ? 0 : size === "quarter" ? month - (month % 3) : month;
	const from = addMonths(toIso(new Date(Date.UTC(date.getUTCFullYear(), first, 1))), step * months);
	return { from, to: addDays(addMonths(from, months), -1) };
}

/** One side of a value: a day, or a word for one. */
function singleSpan(value: string, today: IsoDate): DateSpan | null {
	if (isValidIsoDay(value)) return { from: value, to: value };
	const relative = RELATIVE.exec(value);
	if (relative) {
		let day = addDays(today, ANCHORS[relative[1]]);
		if (relative[2]) day = shift(day, (relative[2] === "-" ? -1 : 1) * Number(relative[3]), relative[4] as Unit);
		return { from: day, to: day };
	}
	const named = PERIOD.exec(value);
	if (named) return period(named[1] as "this" | "last" | "next", named[2] as "week" | "month" | "quarter" | "year", today);
	const rolling = ROLLING.exec(value);
	if (rolling) {
		const n = Number(rolling[2]);
		if (n < 1) return null;
		const unit = rolling[3][0] as Unit;
		// `last-7-days` is today and the six days before it; `next-7-days`
		// today and the six after.
		return rolling[1] === "last" ? { from: addDays(shift(today, -n, unit), 1), to: today } : { from: today, to: addDays(shift(today, n, unit), -1) };
	}
	return null;
}

/**
 * A date value as a query stores it, or null when it isn't one: a day as
 * typed, a word in lower case, a range as its two sides joined by `..`.
 */
export function normalizeDateValue(raw: string): string | null {
	const text = raw.trim().toLowerCase();
	if (!text) return null;
	const at = text.indexOf(RANGE);
	if (at >= 0) {
		const from = text.slice(0, at).trim();
		const to = text.slice(at + RANGE.length).trim();
		if (!from || !to || to.includes(RANGE)) return null;
		if (!singleSpan(from, "2000-01-01") || !singleSpan(to, "2000-01-01")) return null;
		return `${from}${RANGE}${to}`;
	}
	return singleSpan(text, "2000-01-01") ? text : null;
}

/** Whether a stored date value depends on the day it runs (anything but a
 *  plain day, or a range of two). */
export function isRelativeDateValue(value: string): boolean {
	return value
		.split(RANGE)
		.some((side) => !isValidIsoDay(side.trim()));
}

/** The days a stored date value covers on `today`, or null when it isn't
 *  one. A range whose end comes before its start covers nothing. */
export function dateSpan(value: string, today: IsoDate): DateSpan | null {
	const text = value.trim().toLowerCase();
	const at = text.indexOf(RANGE);
	if (at < 0) return singleSpan(text, today);
	const from = singleSpan(text.slice(0, at).trim(), today);
	const to = singleSpan(text.slice(at + RANGE.length).trim(), today);
	if (!from || !to) return null;
	return { from: from.from, to: to.to };
}

/**
 * Today's date in a time zone (an IANA name, "America/Chicago"), as
 * `YYYY-MM-DD`. Without one, or with one this runtime doesn't know, the
 * runtime's own local day.
 */
export function todayIn(timeZone?: string | null, now: Date = new Date()): IsoDate {
	if (timeZone) {
		try {
			const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
			const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
			const day = `${part("year")}-${part("month")}-${part("day")}`;
			if (isValidIsoDay(day)) return day;
		} catch {
			// An unknown zone: fall back to the local day.
		}
	}
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
