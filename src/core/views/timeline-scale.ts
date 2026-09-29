/**
 * The Timeline layout's zoom and time axis: named zoom levels (pixels per
 * day), the date span a chart draws, and the two-band header (month or year
 * bands over equal-width day, week or month columns). Ported from
 * vertex-flow-obsidian's TimelineView so both apps draw the same axis; the
 * bar math itself is in `timeline.ts`. All dates are UTC day numbers
 * (`dayNumber`), like everything else here.
 */
import type { TimelineZoom } from "../types";
import { MS_PER_DAY, dateRangeOf, dayNumber, type Bar } from "./timeline";

/** Pixels per day for each fixed zoom level. `all` has none: it fits the
 *  scheduled span to the chart's width (`timelineScale`). */
export const TIMELINE_ZOOM_SCALES: Record<Exclude<TimelineZoom, "all">, number> = {
	day: 40,
	week: 18,
	month: 7,
	quarter: 2.6,
	year: 1,
};

export const TIMELINE_ZOOMS: TimelineZoom[] = ["day", "week", "month", "quarter", "year", "all"];

export const DEFAULT_TIMELINE_ZOOM: TimelineZoom = "week";

export const MIN_TIMELINE_SCALE = 0.4;
export const MAX_TIMELINE_SCALE = 120;

/** Blank days kept on each side of the outermost bar. */
export const TIMELINE_PADDING_DAYS = 7;

export function clampTimelineScale(scale: number): number {
	return Math.min(MAX_TIMELINE_SCALE, Math.max(MIN_TIMELINE_SCALE, scale));
}

export interface TimelineDomain {
	/** First day drawn (a `dayNumber`). */
	minDay: number;
	/** Last day drawn, inclusive. */
	maxDay: number;
	days: number;
}

/**
 * The span the bars need: their own range padded by `TIMELINE_PADDING_DAYS`
 * each side (a month either side of today when nothing is scheduled), always
 * reaching at least two days either side of today.
 */
export function timelineContentDomain(bars: Bar[], todayIso: string): TimelineDomain {
	const range = dateRangeOf(bars);
	const today = dayNumber(todayIso);
	let minDay = range ? dayNumber(range.min) - TIMELINE_PADDING_DAYS : today - 30;
	let maxDay = range ? dayNumber(range.max) + TIMELINE_PADDING_DAYS : today + 30;
	minDay = Math.min(minDay, today - 2);
	maxDay = Math.max(maxDay, today + 2);
	return { minDay, maxDay, days: maxDay - minDay + 1 };
}

/** Pixels per day for a zoom level; `all` fits `content` into `width`. */
export function timelineScale(zoom: TimelineZoom, content: TimelineDomain, width: number): number {
	if (zoom !== "all") return TIMELINE_ZOOM_SCALES[zoom];
	return width > 0 ? clampTimelineScale(width / Math.max(1, content.days)) : TIMELINE_ZOOM_SCALES.week;
}

/**
 * The span actually drawn: `content`, widened evenly with blank days until it
 * fills `width` -- day columns keep their width, there are just more of them,
 * so the chart never trails off into empty space.
 */
export function timelineDomain(content: TimelineDomain, width: number, scale: number): TimelineDomain {
	if (width <= 0) return content;
	const needed = Math.ceil(width / scale);
	if (needed <= content.days) return content;
	const extra = needed - content.days;
	const before = Math.floor(extra / 2);
	return { minDay: content.minDay - before, maxDay: content.maxDay + (extra - before), days: needed };
}

export interface TimeBand {
	key: string;
	left: number;
	width: number;
	label: string;
}

export interface TimeTick {
	key: number;
	left: number;
	width: number;
	label: string;
	/** Opens a new month (day columns) or year (month columns): a heavier line. */
	major: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const dateOf = (day: number) => new Date(day * MS_PER_DAY);
const startOfMonth = (day: number) => {
	const d = dateOf(day);
	return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / MS_PER_DAY);
};
const addMonths = (day: number, n: number) => {
	const d = dateOf(day);
	return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1) / MS_PER_DAY);
};
const startOfYear = (day: number) => Math.round(Date.UTC(dateOf(day).getUTCFullYear(), 0, 1) / MS_PER_DAY);
const addYears = (day: number, n: number) => Math.round(Date.UTC(dateOf(day).getUTCFullYear() + n, 0, 1) / MS_PER_DAY);

/**
 * The two-band header: wide month (or year) `bands` over equal-width `ticks`.
 * Granularity follows the zoom -- 1, 2 or 7-day columns under month bands
 * zoomed in, month columns under year bands zoomed out. Keeping the month
 * name out of the day columns is what keeps every column the same width.
 */
export function buildTimeScale(minDay: number, days: number, scale: number): { bands: TimeBand[]; ticks: TimeTick[] } {
	const maxDay = minDay + days;
	const bands: TimeBand[] = [];
	const ticks: TimeTick[] = [];
	const dayStep = scale >= 20 ? 1 : scale >= 10 ? 2 : scale >= 4 ? 7 : 0;

	if (dayStep > 0) {
		for (let d = minDay; d < maxDay; d += dayStep) {
			const date = dateOf(d);
			ticks.push({
				key: d,
				left: (d - minDay) * scale,
				width: dayStep * scale,
				label: `${date.getUTCDate()}`,
				major: date.getUTCMonth() !== dateOf(d - dayStep).getUTCMonth(),
			});
		}
		for (let m = startOfMonth(minDay); m < maxDay; m = addMonths(m, 1)) {
			const from = Math.max(m, minDay);
			const to = Math.min(addMonths(m, 1), maxDay);
			const date = dateOf(m);
			const width = (to - from) * scale;
			bands.push({
				key: `m${m}`,
				left: (from - minDay) * scale,
				width,
				label:
					width > 96
						? `${MONTHS_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}`
						: width > 44
							? `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
							: MONTHS[date.getUTCMonth()],
			});
		}
	} else {
		for (let m = startOfMonth(minDay); m < maxDay; m = addMonths(m, 1)) {
			const from = Math.max(m, minDay);
			const to = Math.min(addMonths(m, 1), maxDay);
			const date = dateOf(m);
			const width = (to - from) * scale;
			ticks.push({
				key: m,
				left: (from - minDay) * scale,
				width,
				label: width > 22 ? MONTHS[date.getUTCMonth()] : MONTHS[date.getUTCMonth()][0],
				major: date.getUTCMonth() === 0,
			});
		}
		for (let y = startOfYear(minDay); y < maxDay; y = addYears(y, 1)) {
			const from = Math.max(y, minDay);
			const to = Math.min(addYears(y, 1), maxDay);
			bands.push({ key: `y${y}`, left: (from - minDay) * scale, width: (to - from) * scale, label: `${dateOf(y).getUTCFullYear()}` });
		}
	}
	return { bands, ticks };
}
