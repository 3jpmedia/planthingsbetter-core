/**
 * Turning a filtered task list into chart-ready data (§Dashboards Phase 1).
 *
 * Pure: the dashboard container applies the dashboard-wide `ViewFilters` once
 * (through the shared `applyFilters` engine) and hands the resulting task list
 * here. Chart components receive the output as props and stay presentational.
 */

import { NONE } from "../types";
import type {
	DashboardGroupingField,
	DashboardMetric,
	DashboardScope,
	DashboardTemporalField,
	DashboardTimeBucket,
	DashboardWidget,
	Task,
} from "../types";
import type { ViewContext } from "../views/context";
import { displayColor } from "../taxonomy/engine";
import { COLOR_PALETTE } from "../color";
import { linksMatch } from "../links";
import { metricLabel, valueLabel } from "./title";

const NONE_COLOR = "#94a3b8";

export interface CategoricalDatum {
	key: string;
	label: string;
	value: number;
	color: string;
}

export interface SeriesMeta {
	key: string;
	label: string;
	color: string;
}

/**
 * How a chart's numbers read: decimals to show, and a unit when they aren't
 * plain counts ("days" for cycle time).
 */
export interface Measure {
	decimals: number;
	unit?: "days";
}

export type WidgetData =
	| ({ kind: "kpi"; value: number; empty: boolean } & Measure)
	| ({ kind: "categorical"; data: CategoricalDatum[]; empty: boolean } & Measure)
	| ({
			kind: "series";
			/** A bucket with nothing to measure (no task finished that week, for
			 *  an average) leaves its series' key out -- a gap, not a zero. */
			data: Array<Record<string, number | string>>;
			series: SeriesMeta[];
			empty: boolean;
	  } & Measure);

// ---------------------------------------------------------------------------
// Discrete grouping
// ---------------------------------------------------------------------------

/** The discrete key(s) a task falls under for `field`. Only `label` returns >1. */
export function groupKeys(task: Task, field: DashboardGroupingField): string[] {
	switch (field) {
		case "status":
			return [task.status ?? NONE];
		case "priority":
			return [task.priority ?? NONE];
		case "taskType":
			return [task.taskType ?? NONE];
		case "assignee":
			return [task.assignee ?? NONE];
		case "project":
			return [task.project ?? NONE];
		case "label":
			return task.labels.length > 0 ? task.labels.slice() : [NONE];
	}
}

function colorFor(
	field: DashboardGroupingField,
	key: string,
	index: number,
	context: ViewContext,
): string {
	if (key === NONE) return NONE_COLOR;
	if (
		field === "status" ||
		field === "priority" ||
		field === "taskType" ||
		field === "label"
	) {
		return (
			displayColor(context.taxonomies[field], key) ??
			COLOR_PALETTE[index % COLOR_PALETTE.length]
		);
	}
	// assignee / project have no taxonomy colour — cycle the taxonomy palette.
	return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

/** Taxonomy display order for ordered taxonomies, else "biggest bar first". */
function orderedKeys(
	field: DashboardGroupingField,
	counts: Map<string, number>,
	context: ViewContext,
): string[] {
	const present = [...counts.keys()];
	if (field === "status" || field === "priority") {
		const order = context.taxonomies[field].values
			.slice()
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
			.map((v) => v.id);
		const rank = (k: string) => {
			const i = order.indexOf(k);
			return i === -1 ? order.length + (k === NONE ? 1 : 0) : i;
		};
		return present.sort((a, b) => rank(a) - rank(b));
	}
	return present.sort((a, b) => {
		if (a === NONE) return 1;
		if (b === NONE) return -1;
		return (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
	});
}

// ---------------------------------------------------------------------------
// Scope predicate (KPI)
// ---------------------------------------------------------------------------

export function matchesScope(task: Task, scope: DashboardScope): boolean {
	const keys = groupKeys(task, scope.field);
	if (scope.field === "project") {
		if (scope.value === NONE) return task.project == null;
		return keys.some(
			(k) => k !== NONE && (k === scope.value || linksMatch(k, scope.value)),
		);
	}
	return keys.includes(scope.value);
}

// ---------------------------------------------------------------------------
// Temporal bucketing
// ---------------------------------------------------------------------------

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function ymd(date: Date): string {
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Normalise a task's temporal field to a `Date` at UTC midnight, or null. */
function temporalValue(task: Task, field: DashboardTemporalField): Date | null {
	// Each temporal field is the task property of the same name.
	const raw = task[field];
	if (!raw) return null;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return null;
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function bucketStart(date: Date, bucket: DashboardTimeBucket): Date {
	if (bucket === "month") {
		return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
	}
	if (bucket === "week") {
		// ISO week — snap back to Monday.
		const day = (date.getUTCDay() + 6) % 7;
		return new Date(date.getTime() - day * 86400000);
	}
	return date;
}

function nextBucket(date: Date, bucket: DashboardTimeBucket): Date {
	if (bucket === "month") {
		return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
	}
	return new Date(date.getTime() + (bucket === "week" ? 7 : 1) * 86400000);
}

function bucketLabel(iso: string, bucket: DashboardTimeBucket): string {
	const [y, m, d] = iso.split("-");
	if (bucket === "month") return `${y}-${m}`;
	return `${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

/** Days from a task's start to its completion, or null without both (or
 *  with a completion before its start). */
export function cycleTimeDays(task: Task): number | null {
	if (!task.startedAt || !task.completedAt) return null;
	const start = new Date(task.startedAt).getTime();
	const end = new Date(task.completedAt).getTime();
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
	return (end - start) / DAY_MS;
}

function isCycleTime(metric: DashboardMetric): boolean {
	return metric === "cycleTimeAvg" || metric === "cycleTimeMedian";
}

/** How a metric's numbers read. */
export function measureOf(metric: DashboardMetric): Measure {
	if (isCycleTime(metric)) return { decimals: 1, unit: "days" };
	return { decimals: metric === "estimateAvg" ? 1 : 0 };
}

function median(values: number[]): number {
	const sorted = values.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * A metric over some tasks. `null` when there's nothing to measure: no task
 * among them has a cycle time. (An estimate average over tasks without
 * estimates stays 0, as it always has.)
 */
export function aggregateMetric(tasks: Task[], metric: DashboardMetric): number | null {
	if (metric === "count") return tasks.length;
	if (isCycleTime(metric)) {
		const days = tasks.map(cycleTimeDays).filter((n): n is number => n != null);
		if (days.length === 0) return null;
		return metric === "cycleTimeMedian"
			? median(days)
			: days.reduce((acc, n) => acc + n, 0) / days.length;
	}
	const values = tasks
		.map((t) => t.estimate)
		.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
	const sum = values.reduce((acc, n) => acc + n, 0);
	if (metric === "estimateSum") return sum;
	return values.length === 0 ? 0 : sum / values.length;
}

export function computeWidgetData(
	widget: DashboardWidget,
	tasks: Task[],
	context: ViewContext,
): WidgetData {
	const mapping = widget.fieldMapping;

	if (mapping.chartType === "kpi") {
		const scoped = mapping.scope
			? tasks.filter((t) => matchesScope(t, mapping.scope as DashboardScope))
			: tasks;
		const value = aggregateMetric(scoped, mapping.metric);
		return {
			kind: "kpi",
			value: value ?? 0,
			...measureOf(mapping.metric),
			empty: scoped.length === 0 || value == null,
		};
	}

	if (mapping.chartType === "bar" || mapping.chartType === "pie") {
		// A pie's slices must add up to its whole, so it only ever counts.
		const metric: DashboardMetric =
			mapping.chartType === "bar" ? (mapping.metric ?? "count") : "count";
		const members = new Map<string, Task[]>();
		for (const task of tasks) {
			for (const key of groupKeys(task, mapping.groupBy)) {
				let list = members.get(key);
				if (!list) members.set(key, (list = []));
				list.push(task);
			}
		}
		// A group with nothing to measure (no finished task, for cycle time)
		// gets no bar.
		const values = new Map<string, number>();
		for (const [key, list] of members) {
			const value = aggregateMetric(list, metric);
			if (value != null) values.set(key, value);
		}
		const keys = orderedKeys(mapping.groupBy, values, context);
		const data: CategoricalDatum[] = keys.map((key, index) => ({
			key,
			label: valueLabel(mapping.groupBy, key, context),
			value: values.get(key) ?? 0,
			color: colorFor(mapping.groupBy, key, index, context),
		}));
		return {
			kind: "categorical",
			data,
			...measureOf(metric),
			empty: data.length === 0,
		};
	}

	// line / timeline — temporal buckets, optionally split into series. A
	// running total only adds up, so a timeline only ever counts.
	const cumulative = mapping.chartType === "timeline";
	const metric: DashboardMetric = cumulative ? "count" : (mapping.metric ?? "count");
	const measure = measureOf(metric);
	const dated = tasks
		.map((task) => ({ task, date: temporalValue(task, mapping.xField) }))
		.filter((row): row is { task: Task; date: Date } => row.date != null);

	if (dated.length === 0) {
		return { kind: "series", data: [], series: [], ...measure, empty: true };
	}

	const starts = dated
		.map((row) => bucketStart(row.date, mapping.bucket))
		.sort((a, b) => a.getTime() - b.getTime());
	const first = starts[0];
	const last = starts[starts.length - 1];

	// One series per discrete value, or a single "Tasks" series.
	const seriesCounts = new Map<string, number>();
	const rowKeys = (task: Task): string[] =>
		mapping.groupBy ? groupKeys(task, mapping.groupBy) : ["__all__"];
	for (const { task } of dated) {
		for (const key of rowKeys(task)) {
			seriesCounts.set(key, (seriesCounts.get(key) ?? 0) + 1);
		}
	}
	const seriesKeys = mapping.groupBy
		? orderedKeys(mapping.groupBy, seriesCounts, context)
		: ["__all__"];
	const series: SeriesMeta[] = seriesKeys.map((key, index) => ({
		key,
		label:
			key === "__all__"
				? metric === "count"
					? "Tasks"
					: metricLabel(metric)
				: valueLabel(mapping.groupBy as DashboardGroupingField, key, context),
		color:
			key === "__all__"
				? COLOR_PALETTE[10]
				: colorFor(mapping.groupBy as DashboardGroupingField, key, index, context),
	}));

	// Per-bucket, per-series tasks.
	const perBucket = new Map<string, Map<string, Task[]>>();
	for (const { task, date } of dated) {
		const iso = ymd(bucketStart(date, mapping.bucket));
		let bucket = perBucket.get(iso);
		if (!bucket) perBucket.set(iso, (bucket = new Map<string, Task[]>()));
		for (const key of rowKeys(task)) {
			let list = bucket.get(key);
			if (!list) bucket.set(key, (list = []));
			list.push(task);
		}
	}

	const data: Array<Record<string, number | string>> = [];
	const running = new Map<string, number>();
	for (
		let cursor = new Date(first.getTime());
		cursor.getTime() <= last.getTime();
		cursor = nextBucket(cursor, mapping.bucket)
	) {
		const iso = ymd(cursor);
		const bucket = perBucket.get(iso);
		const row: Record<string, number | string> = {
			bucket: iso,
			label: bucketLabel(iso, mapping.bucket),
		};
		for (const meta of series) {
			const members = bucket?.get(meta.key) ?? [];
			if (cumulative) {
				running.set(meta.key, (running.get(meta.key) ?? 0) + members.length);
				row[meta.key] = running.get(meta.key) ?? 0;
			} else {
				const value = aggregateMetric(members, metric);
				if (value != null) row[meta.key] = value;
			}
		}
		data.push(row);
	}

	return { kind: "series", data, series, ...measure, empty: false };
}
