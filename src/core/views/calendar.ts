/**
 * Calendar view — pure day-bucketing (phase 2).
 *
 * The Calendar is a *day-bucketing* view, not a range view: it drops each Task
 * onto the single day named by one chosen date field and paints a month grid.
 * That's the whole reason Projects stay out of it — a Project's authoritative
 * date *range* has nowhere to live on a day grid, and Timeline already
 * covers ranges.
 *
 * Day and month arithmetic is shared, not re-rolled: `dayNumber` / `isoFromDay`
 * / `MS_PER_DAY` come from `timeline.ts`, the peer module that already owns the
 * "turn an ISO string into a comparable integer, clamped to a four-digit year"
 * logic. Nothing here does string slicing to find a month.
 *
 * No drag math lives here either — dragging a chip reuses `taskBar` /
 * `shiftBar` / `barDates` from `timeline.ts` as-is (a chip move is a Timeline
 * body-drag with a whole-day delta); only the pixel→cell hit-test belongs to
 * the UI layer.
 */

import type { CalendarDateField, CalendarMode, IsoDate, Task } from "../types";
import { MS_PER_DAY, dayNumber, isoFromDay } from "./timeline";

// ---------------------------------------------------------------------------
// Anchoring a task to a day
// ---------------------------------------------------------------------------

/**
 * The day this task sits on for the given toggle, or `null` if it has no value
 * in *that* field.
 *
 * A direct read of the selected field only — a task with `startDate` set but no
 * `dueDate` is unscheduled under the "Due" toggle, never quietly borrowed from
 * its start date, or the toggle would stop meaning what it says. Normalised to
 * a bare `YYYY-MM-DD` so bucket keys are canonical even when a field holds a
 * full datetime.
 */
export function calendarAnchor(
	task: Task,
	field: CalendarDateField,
): IsoDate | null {
	const value = task[field];
	return value ? value.slice(0, 10) : null;
}

/** Group tasks by the day their selected field lands on. Order within a day is preserved. */
export function bucketByDay(
	tasks: Task[],
	field: CalendarDateField,
): Map<IsoDate, Task[]> {
	const buckets = new Map<IsoDate, Task[]>();
	for (const task of tasks) {
		const anchor = calendarAnchor(task, field);
		if (!anchor) continue;
		const bucket = buckets.get(anchor);
		if (bucket) bucket.push(task);
		else buckets.set(anchor, [task]);
	}
	return buckets;
}

/**
 * The complement of `bucketByDay` / `calendarSpan` — tasks with no value in
 * the selected field (or, with two, in either of them).
 */
export function unscheduledForCalendar(
	tasks: Task[],
	field: CalendarDateField,
	endField: CalendarDateField | null = null,
): Task[] {
	return tasks.filter((task) => calendarSpan(task, field, endField) === null);
}

// ---------------------------------------------------------------------------
// Spans (two dates: `date:start,due`)
// ---------------------------------------------------------------------------

/** Where a task sits on the calendar: one day, or a run of days. */
export interface CalendarSpan {
	start: IsoDate;
	end: IsoDate;
	/** Two dates were asked for, and the task has only one of them -- it
	 *  sits on that day, drawn as open-ended. */
	partial: boolean;
}

/**
 * The days a task covers for one date (`field`) or two (`field`, `endField`).
 * With two, the span runs from the earlier date to the later, whichever
 * field holds which -- `created,due` works for a task due before it was
 * created. A task with only one of the two sits on that day (`partial`);
 * with neither, it's unscheduled (`null`). Like `calendarAnchor`, it never
 * borrows a field that wasn't asked for.
 */
export function calendarSpan(
	task: Task,
	field: CalendarDateField,
	endField: CalendarDateField | null = null,
): CalendarSpan | null {
	const a = calendarAnchor(task, field);
	if (!endField || endField === field) return a ? { start: a, end: a, partial: false } : null;
	const b = calendarAnchor(task, endField);
	if (a && b) return a <= b ? { start: a, end: b, partial: false } : { start: b, end: a, partial: false };
	const only = a ?? b;
	return only ? { start: only, end: only, partial: true } : null;
}

/** A span placed in one week row: its first column, how many days it
 *  covers there, its lane (row within the week, from the top), and whether
 *  it carries on from the week before or into the week after. */
export interface PlacedSpan<T> {
	item: T;
	span: CalendarSpan;
	col: number;
	length: number;
	lane: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
}

/**
 * Lays out the spans that touch a run of `days` days starting at
 * `weekStart` (a week row of a month, or a week view), each in the first
 * lane free for all of its days -- the way calendar apps stack multi-day
 * events. Earlier starts first, and among those the longer span first, so
 * long bars sit on top and short ones fill the gaps below; otherwise the
 * given order is kept.
 */
export function layoutWeek<T>(
	items: { item: T; span: CalendarSpan }[],
	weekStart: IsoDate,
	days = 7,
): PlacedSpan<T>[] {
	const first = dayNumber(weekStart);
	const last = first + days - 1;
	const touching = items
		.map((entry, index) => ({ ...entry, index, s: dayNumber(entry.span.start), e: dayNumber(entry.span.end) }))
		.filter((entry) => entry.e >= first && entry.s <= last)
		.sort((a, b) => a.s - b.s || b.e - b.s - (a.e - a.s) || a.index - b.index);
	const laneEnds: number[] = [];
	return touching.map((entry) => {
		const from = Math.max(entry.s, first);
		const to = Math.min(entry.e, last);
		let lane = laneEnds.findIndex((end) => end < from);
		if (lane === -1) lane = laneEnds.length;
		laneEnds[lane] = to;
		return {
			item: entry.item,
			span: entry.span,
			col: from - first,
			length: to - from + 1,
			lane,
			continuesBefore: entry.s < first,
			continuesAfter: entry.e > last,
		};
	});
}

// ---------------------------------------------------------------------------
// The days each layout shows (`calendar:` clause)
// ---------------------------------------------------------------------------

/** How many weeks a week-based layout shows. */
export const CALENDAR_MODE_WEEKS: Partial<Record<CalendarMode, number>> = { week: 1, "2weeks": 2, "4weeks": 4 };

/** The Sunday that starts the week containing `date`. */
export function startOfWeek(date: IsoDate): IsoDate {
	const day = dayNumber(date);
	return isoFromDay(day - new Date(day * MS_PER_DAY).getUTCDay());
}

/**
 * Where a layout starts for a given date: the 1st of its month for
 * `month`, the Sunday of its week for the week layouts, the day itself for
 * `schedule` -- one canonical anchor per page, like `visibleMonth`.
 */
export function calendarAnchorDate(mode: CalendarMode, date: IsoDate): IsoDate {
	if (mode === "month") return startOfMonth(date);
	if (mode === "schedule") return isoFromDay(dayNumber(date));
	return startOfWeek(date);
}

/** The next (`n` = 1) or previous (-1) page: a month, or as many weeks as
 *  the layout shows. Schedule pages a week at a time. */
export function shiftCalendar(mode: CalendarMode, anchor: IsoDate, n: number): IsoDate {
	if (mode === "month") return isoFromDay(addMonthsDay(dayNumber(anchor), n));
	const weeks = CALENDAR_MODE_WEEKS[mode] ?? 1;
	return isoFromDay(dayNumber(calendarAnchorDate(mode, anchor)) + n * weeks * 7);
}

/** The day cells a grid layout shows, whole weeks from Sunday: the month
 *  grid, or 7 / 14 / 28 days. */
export function calendarDays(mode: CalendarMode, anchor: IsoDate): IsoDate[] {
	if (mode === "month") return monthGrid(anchor);
	const first = dayNumber(startOfWeek(anchor));
	const count = (CALENDAR_MODE_WEEKS[mode] ?? 1) * 7;
	return Array.from({ length: count }, (_, i) => isoFromDay(first + i));
}

// ---------------------------------------------------------------------------
// Month arithmetic (built on timeline.ts's day numbers)
// ---------------------------------------------------------------------------

/** Whole days from the epoch for the 1st of the month containing `day`. */
export function monthStartDay(day: number): number {
	const d = new Date(day * MS_PER_DAY);
	return Math.round(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / MS_PER_DAY,
	);
}

/** `monthStartDay`, shifted by `n` whole months. */
export function addMonthsDay(day: number, n: number): number {
	const d = new Date(day * MS_PER_DAY);
	return Math.round(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1) / MS_PER_DAY,
	);
}

/**
 * Normalise any date to the 1st of its month.
 *
 * `visibleMonth` is always stored this way — from prev, next, or Today — so the
 * furniture has one representation, the same discipline `canonicalizeFilters` /
 * `canonicalizeHiddenFields` apply elsewhere. Built on `dayNumber` /
 * `isoFromDay`, not string slicing.
 */
export function startOfMonth(date: IsoDate): IsoDate {
	return isoFromDay(monthStartDay(dayNumber(date)));
}

/**
 * The day cells for a month view: the month itself plus the leading/trailing
 * days from adjacent months needed to fill whole weeks. Weeks start on Sunday
 * (`getUTCDay` 0), so the result is 28–42 cells — 28 only for a non-leap
 * February that begins on a Sunday.
 */
export function monthGrid(month: IsoDate): IsoDate[] {
	const first = monthStartDay(dayNumber(month));
	const lastDay = addMonthsDay(first, 1) - 1;

	const leading = new Date(first * MS_PER_DAY).getUTCDay();
	const trailing = 6 - new Date(lastDay * MS_PER_DAY).getUTCDay();

	const cells: IsoDate[] = [];
	for (let day = first - leading; day <= lastDay + trailing; day += 1) {
		cells.push(isoFromDay(day));
	}
	return cells;
}
