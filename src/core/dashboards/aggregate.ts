/**
 * Turning a filtered task list into chart-ready data (§Dashboards Phase 1).
 *
 * Pure: the dashboard container applies the dashboard-wide `ViewFilters` once
 * (through the shared `applyFilters` engine) and hands the resulting task list
 * here. Chart components receive the output as props and stay presentational.
 */

import { NONE, customFieldKeyOf } from "../types";
import type {
	CustomFieldDef,
	CustomFieldRef,
	DashboardFieldMapping,
	DashboardGoal,
	DashboardGroupBy,
	DashboardGroupingField,
	DashboardMetric,
	DashboardScope,
	DashboardTemporalField,
	DashboardTimeBucket,
	DashboardWidget,
	Task,
} from "../types";
import { contextToday, type ViewContext } from "../views/context";
import { dateSpan } from "../relative-dates";
import { customFieldByKey, customValueOf } from "../views/custom-fields";
import { customKeys, groupingField } from "../views/group";
import { displayColor } from "../taxonomy/engine";
import { COLOR_PALETTE } from "../color";
import { linksMatch } from "../links";
import { buildGraph, graphSnapshot, layoutGraph, type GraphSnapshot } from "../graph";
import { metricLabel, valueLabel } from "./title";

const NONE_COLOR = "#94a3b8";

export interface CategoricalDatum {
	key: string;
	label: string;
	value: number;
	color: string;
	/** A split chart's parts of this bar, one per split value it has
	 *  (T-1127), in `splits` order. */
	parts?: CategoricalPart[];
}

/** One part of a split bar: what one value of the split measures. */
export interface CategoricalPart {
	key: string;
	value: number;
}

/**
 * A goal as a chart draws it (T-1128): the amount, and when it's due in
 * words ("Fri", "Oct 31", "today"), and whether that's passed.
 */
export interface GoalState {
	amount: number;
	/** The current period, when the goal has one ("this week"). */
	period?: string;
	/** The due day in words, when the goal has a period. */
	due?: string;
	/** The due day has passed (later in the same period). */
	past?: boolean;
}

/** A table's row or column (T-1127). */
export interface TableAxisEntry {
	key: string;
	label: string;
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
	/** Why the chart can't be drawn: a custom field it uses was removed, or
	 *  is no longer the kind of field it needs. The chart is `empty`, and
	 *  says so. */
	unavailable?: string;
	/** What a bar's height measures when it isn't a task count ("Points
	 *  sum"), for its tooltip. */
	label?: string;
}

export type WidgetData =
	| ({
			kind: "kpi";
			value: number;
			/** For a count of part of the dashboard's tasks (a scope): how many
			 *  tasks the dashboard has in all, so it reads "6 of 25". */
			of?: number;
			/** Its goal (T-1128). */
			goal?: GoalState;
			empty: boolean;
	  } & Measure)
	| ({
			kind: "categorical";
			data: CategoricalDatum[];
			/** A split chart's split values, in order and colored (T-1127). */
			splits?: SeriesMeta[];
			/** Each bar's goal (T-1128). */
			goal?: GoalState;
			empty: boolean;
	  } & Measure)
	| ({
			kind: "table";
			rows: TableAxisEntry[];
			/** Empty for a table of one column. */
			columns: TableAxisEntry[];
			/** `cells[row][column]`; null: nothing there to measure. A table of
			 *  one column has one cell per row. */
			cells: Array<Array<number | null>>;
			rowTotals: Array<number | null>;
			columnTotals: Array<number | null>;
			total: number | null;
			empty: boolean;
	  } & Measure)
	| ({
			kind: "series";
			/** A bucket with nothing to measure (no task finished that week, for
			 *  an average) leaves its series' key out -- a gap, not a zero. */
			data: Array<Record<string, number | string>>;
			series: SeriesMeta[];
			empty: boolean;
	  } & Measure)
	| ({
			kind: "graph";
			/** The tasks as the Graph layout places them: shapes, states and
			 *  days only, never a name or a key (T-0729). */
			snapshot: GraphSnapshot;
			empty: boolean;
	  } & Measure);

// ---------------------------------------------------------------------------
// Discrete grouping
// ---------------------------------------------------------------------------

/** The discrete key(s) a task falls under for `field`. Only `label`, a
 *  multi-select and a member field return >1. A custom field needs the
 *  `context` that holds the workspace's fields. */
export function groupKeys(
	task: Task,
	field: DashboardGroupBy,
	context?: Pick<ViewContext, "customFields">,
): string[] {
	if (customFieldKeyOf(field)) {
		const def = context ? groupingField(field as CustomFieldRef, context) : undefined;
		return def ? customKeys(task, def) : [NONE];
	}
	switch (field as DashboardGroupingField) {
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
		case "milestone":
			return [task.milestone ?? NONE];
		case "label":
			return task.labels.length > 0 ? task.labels.slice() : [NONE];
		case "space":
			return [task.space ?? NONE];
	}
}

function colorFor(
	field: DashboardGroupBy,
	key: string,
	index: number,
	context: ViewContext,
): string {
	if (key === NONE) return NONE_COLOR;
	const custom = groupingField(field as CustomFieldRef, context);
	if (custom) {
		return (
			(custom.type === "member" ? undefined : custom.options?.find((o) => o.id === key)?.color) ??
			COLOR_PALETTE[index % COLOR_PALETTE.length]
		);
	}
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
	// assignee / project have no taxonomy colour - cycle the taxonomy palette.
	return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

/** Taxonomy display order for ordered taxonomies, else "biggest bar first". */
function orderedKeys(
	field: DashboardGroupBy,
	counts: Map<string, number>,
	context: ViewContext,
): string[] {
	const present = [...counts.keys()];
	// A select's (or multi-select's) choices come in the field's own order.
	const custom = groupingField(field as CustomFieldRef, context);
	if (custom?.options) {
		const order = custom.options.map((o) => o.id);
		const rank = (k: string) => {
			const i = order.indexOf(k);
			return i === -1 ? order.length + (k === NONE ? 1 : 0) : i;
		};
		return present.sort((a, b) => rank(a) - rank(b));
	}
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

export function matchesScope(
	task: Task,
	scope: DashboardScope,
	context?: Pick<ViewContext, "customFields">,
): boolean {
	const keys = groupKeys(task, scope.field, context);
	if (scope.field === "milestone" && scope.value === NONE) return task.milestone == null;
	if (scope.field === "space" && scope.value === NONE) return task.space == null;
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
		// ISO week - snap back to Monday.
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

function isFieldMetric(metric: DashboardMetric): boolean {
	return metric === "fieldSum" || metric === "fieldAvg";
}

/** The numbers a number custom field holds on some tasks (unset ones skipped). */
function fieldNumbers(tasks: Task[], field: CustomFieldDef): number[] {
	return tasks
		.map((task) => customValueOf(task, field))
		.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

/** How a metric's numbers read. A sum of a number field shows decimals only
 *  when some value has them (`tasks` and `field`: what it adds up). */
export function measureOf(
	metric: DashboardMetric,
	tasks?: Task[],
	field?: CustomFieldDef,
): Measure {
	if (isCycleTime(metric)) return { decimals: 1, unit: "days" };
	if (metric === "fieldAvg") return { decimals: 1 };
	if (metric === "fieldSum") {
		const fractional = field && tasks ? fieldNumbers(tasks, field).some((n) => !Number.isInteger(n)) : false;
		return { decimals: fractional ? 2 : 0 };
	}
	return { decimals: metric === "estimateAvg" ? 1 : 0 };
}

function median(values: number[]): number {
	const sorted = values.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * A metric over some tasks. `null` when there's nothing to measure: no task
 * among them has a cycle time, or no task has a value for the number field
 * `fieldAvg` averages. (An estimate average over tasks without estimates
 * stays 0, as it always has; a sum of a field none has a value for is 0.)
 * `field` is the number custom field `fieldSum` and `fieldAvg` read.
 */
export function aggregateMetric(
	tasks: Task[],
	metric: DashboardMetric,
	field?: CustomFieldDef,
): number | null {
	if (metric === "count") return tasks.length;
	if (isFieldMetric(metric)) {
		if (!field) return null;
		const numbers = fieldNumbers(tasks, field);
		const sum = numbers.reduce((acc, n) => acc + n, 0);
		if (metric === "fieldSum") return sum;
		return numbers.length === 0 ? null : sum / numbers.length;
	}
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

/** The custom fields a mapping uses, found in the workspace's: what it
 *  groups by, and the number it measures. `problem` says why it can't be
 *  drawn (a field removed, or no longer the right kind). */
export function mappingFields(
	mapping: DashboardFieldMapping,
	context: Pick<ViewContext, "customFields">,
): { group?: CustomFieldDef; measure?: CustomFieldDef; problem: string | null } {
	let group: CustomFieldDef | undefined;
	let measure: CustomFieldDef | undefined;
	// What it groups by first, then a split's or a table's columns (T-1127).
	const groupings: Array<DashboardGroupBy | null | undefined> =
		mapping.chartType === "kpi" || mapping.chartType === "graph"
			? []
			: mapping.chartType === "table"
				? [mapping.rows, mapping.columns]
				: mapping.chartType === "bar"
					? [mapping.groupBy, mapping.splitBy]
					: [mapping.groupBy];
	for (const [index, grouping] of groupings.entries()) {
		const groupKey = grouping ? customFieldKeyOf(grouping) : null;
		if (!groupKey) continue;
		const def = customFieldByKey(context, groupKey);
		if (!def) return { group, problem: `The field this chart ${index === 0 ? "groups" : "splits"} by was removed. Edit the chart to pick another.` };
		const fits = groupingField(grouping as CustomFieldRef, context);
		if (!fits) return { group, problem: `${def.name} is no longer a choice or person field. Edit the chart to pick another.` };
		if (index === 0) group = fits;
	}
	const scope = mapping.chartType === "kpi" ? mapping.scope : null;
	const scopeKey = scope ? customFieldKeyOf(scope.field) : null;
	if (scope && scopeKey) {
		const def = customFieldByKey(context, scopeKey);
		if (!def) return { group, problem: "The field this chart is narrowed by was removed. Edit the chart to pick another." };
		if (!groupingField(scope.field as CustomFieldRef, context)) {
			return { group, problem: `${def.name} is no longer a choice or person field. Edit the chart to pick another.` };
		}
	}
	const metric = "metric" in mapping ? mapping.metric : undefined;
	if (metric && isFieldMetric(metric)) {
		const ref = "metricField" in mapping ? mapping.metricField : undefined;
		const key = ref ? customFieldKeyOf(ref) : null;
		if (!key) return { group, problem: "Pick a number field for this chart to measure." };
		measure = customFieldByKey(context, key);
		if (!measure) return { group, problem: "The field this chart measures was removed. Edit the chart to pick another." };
		if (measure.type !== "number") return { group, problem: `${measure.name} is no longer a number field. Edit the chart to pick another.` };
	}
	return { group, measure, problem: null };
}

/**
 * The graph of `tasks`, as the Tasks Graph layout draws it: each task joined
 * to its project and milestone. The hubs are named from the context where it
 * can, though the snapshot keeps no names anyway.
 */
function graphOf(tasks: Task[], context: ViewContext): GraphSnapshot {
	const projects = new Map<string, { key: string; name: string }>();
	for (const [path, project] of context.projects ?? []) projects.set(path, { key: path, name: project.title });
	const milestones = new Map<string, { key: string; name: string; done?: boolean }>();
	for (const [path, milestone] of context.milestones ?? []) milestones.set(path, { key: path, name: milestone.title, done: milestone.state === "completed" });
	const graph = buildGraph(tasks, { statuses: context.taxonomies.status, projects, milestones });
	return graphSnapshot(graph, layoutGraph(graph));
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PERIOD_WORDS = { day: "today", week: "this-week", month: "this-month" } as const;
const PERIOD_NAMES = { day: "today", week: "this week", month: "this month" } as const;

/**
 * A goal's current period and due day (T-1128), and the tasks that count
 * toward it: those finished in the period -- the same days
 * `completed:this-week` matches. Without a period, every task counts.
 */
export function goalWindow(
	goal: DashboardGoal,
	tasks: Task[],
	context: Pick<ViewContext, "today">,
): { state: GoalState; counted: Task[] } {
	if (!goal.period) return { state: { amount: goal.amount }, counted: tasks };
	const today = contextToday(context);
	const span = dateSpan(PERIOD_WORDS[goal.period], today);
	if (!span) return { state: { amount: goal.amount }, counted: tasks };
	const counted = tasks.filter((task) => {
		const day = task.completedAt?.slice(0, 10);
		return day != null && span.from <= day && day <= span.to;
	});
	let dueDay = span.to;
	if (goal.period === "week" && goal.dueDay) {
		const monday = new Date(`${span.from}T00:00:00Z`);
		monday.setUTCDate(monday.getUTCDate() + goal.dueDay - 1);
		dueDay = monday.toISOString().slice(0, 10);
	}
	const due = new Date(`${dueDay}T00:00:00Z`);
	const words =
		goal.period === "day"
			? "today"
			: goal.period === "week"
				? WEEKDAYS[(due.getUTCDay() + 6) % 7]
				: `${MONTHS[due.getUTCMonth()]} ${due.getUTCDate()}`;
	return {
		state: { amount: goal.amount, period: PERIOD_NAMES[goal.period], due: words, past: today > dueDay },
		counted,
	};
}

/** Tasks per key of a grouping (a task under each of its keys). */
function membersBy(tasks: Task[], field: DashboardGroupBy, context: ViewContext): Map<string, Task[]> {
	const members = new Map<string, Task[]>();
	for (const task of tasks) {
		for (const key of groupKeys(task, field, context)) {
			let list = members.get(key);
			if (!list) members.set(key, (list = []));
			list.push(task);
		}
	}
	return members;
}

/**
 * A bar chart, split or not, with or without a goal (T-1127, T-1128). A
 * goal with a period measures only what was finished in it, but every group
 * (and split) the dashboard's tasks have still shows -- at 0 when nothing
 * is finished yet, the bar people most need to see.
 */
function barData(
	mapping: Extract<DashboardFieldMapping, { chartType: "bar" | "pie" }>,
	tasks: Task[],
	context: ViewContext,
	measure: CustomFieldDef | undefined,
): WidgetData {
	// A pie's slices must add up to its whole, so it only ever counts.
	const metric: DashboardMetric = mapping.chartType === "bar" ? (mapping.metric ?? "count") : "count";
	const goal = mapping.chartType === "bar" && mapping.goal ? goalWindow(mapping.goal, tasks, context) : null;
	const splitBy = mapping.chartType === "bar" ? mapping.splitBy : undefined;
	const counted = goal ? goal.counted : tasks;
	const all = membersBy(tasks, mapping.groupBy, context);
	const members = goal ? all : membersBy(counted, mapping.groupBy, context);
	const countedSet = new Set(counted);
	// A group with nothing to measure (no finished task, for cycle time)
	// gets no bar -- except toward a goal, where it's a 0 to make up.
	const values = new Map<string, number>();
	for (const [key, list] of members) {
		const value = aggregateMetric(goal ? list.filter((t) => countedSet.has(t)) : list, metric, measure);
		if (value != null) values.set(key, value);
		else if (goal) values.set(key, 0);
	}
	const keys = orderedKeys(mapping.groupBy, goal ? new Map([...all].map(([k, l]) => [k, l.length])) : values, context);

	let splits: SeriesMeta[] | undefined;
	const partsOf = new Map<string, CategoricalPart[]>();
	if (splitBy) {
		const splitCounts = new Map<string, number>();
		for (const task of goal ? tasks : counted) {
			for (const key of groupKeys(task, splitBy, context)) splitCounts.set(key, (splitCounts.get(key) ?? 0) + 1);
		}
		const splitKeys = orderedKeys(splitBy, splitCounts, context);
		splits = splitKeys.map((key, index) => ({ key, label: valueLabel(splitBy, key, context), color: colorFor(splitBy, key, index, context) }));
		for (const key of keys) {
			const inGroup = members.get(key) ?? [];
			const bySplit = membersBy(inGroup, splitBy, context);
			const parts: CategoricalPart[] = [];
			for (const split of splitKeys) {
				const list = bySplit.get(split);
				if (!list) continue;
				const value = aggregateMetric(goal ? list.filter((t) => countedSet.has(t)) : list, metric, measure);
				if (value != null) parts.push({ key: split, value });
				else if (goal) parts.push({ key: split, value: 0 });
			}
			partsOf.set(key, parts);
		}
	}

	const data: CategoricalDatum[] = keys.map((key, index) => ({
		key,
		label: valueLabel(mapping.groupBy, key, context),
		value: values.get(key) ?? 0,
		color: colorFor(mapping.groupBy, key, index, context),
		...(splits ? { parts: partsOf.get(key) ?? [] } : {}),
	}));
	return {
		kind: "categorical",
		data,
		...(splits ? { splits } : {}),
		...(goal ? { goal: goal.state } : {}),
		...measureOf(metric, counted, measure),
		...(metric !== "count" ? { label: metricLabel(metric, measure) } : {}),
		empty: data.length === 0,
	};
}

/**
 * A table (T-1127): a row per value of one grouping, a column per value of
 * another, each cell what its tasks measure. Totals measure the tasks
 * themselves, so a task under two labels counts once in its row's total.
 */
function tableData(
	mapping: Extract<DashboardFieldMapping, { chartType: "table" }>,
	tasks: Task[],
	context: ViewContext,
	measure: CustomFieldDef | undefined,
): WidgetData {
	const metric: DashboardMetric = mapping.metric ?? "count";
	const byRow = membersBy(tasks, mapping.rows, context);
	const rowKeys = orderedKeys(mapping.rows, new Map([...byRow].map(([k, l]) => [k, l.length])), context);
	const rows = rowKeys.map((key, index) => ({ key, label: valueLabel(mapping.rows, key, context), color: colorFor(mapping.rows, key, index, context) }));
	const columnsBy = mapping.columns;
	const byColumn = columnsBy ? membersBy(tasks, columnsBy, context) : new Map<string, Task[]>();
	const columnKeys = columnsBy ? orderedKeys(columnsBy, new Map([...byColumn].map(([k, l]) => [k, l.length])), context) : [];
	const columns = columnsBy ? columnKeys.map((key, index) => ({ key, label: valueLabel(columnsBy, key, context), color: colorFor(columnsBy, key, index, context) })) : [];
	const cells = rowKeys.map((row) => {
		const inRow = byRow.get(row) ?? [];
		if (!columnsBy) return [aggregateMetric(inRow, metric, measure)];
		const split = membersBy(inRow, columnsBy, context);
		return columnKeys.map((column) => {
			const list = split.get(column);
			return list ? aggregateMetric(list, metric, measure) : metric === "count" ? 0 : null;
		});
	});
	return {
		kind: "table",
		rows,
		columns,
		cells,
		rowTotals: rowKeys.map((row) => aggregateMetric(byRow.get(row) ?? [], metric, measure)),
		columnTotals: columnKeys.map((column) => aggregateMetric(byColumn.get(column) ?? [], metric, measure)),
		total: aggregateMetric(tasks, metric, measure),
		...measureOf(metric, tasks, measure),
		...(metric !== "count" ? { label: metricLabel(metric, measure) } : {}),
		empty: rows.length === 0,
	};
}

export function computeWidgetData(
	widget: DashboardWidget,
	tasks: Task[],
	context: ViewContext,
): WidgetData {
	const mapping = widget.fieldMapping;
	const used = mappingFields(mapping, context);
	if (used.problem) {
		const base = { decimals: 0, unavailable: used.problem, empty: true as const };
		if (mapping.chartType === "kpi") return { kind: "kpi", value: 0, ...base };
		if (mapping.chartType === "graph") return { kind: "graph", snapshot: graphOf([], context), ...base };
		if (mapping.chartType === "bar" || mapping.chartType === "pie") return { kind: "categorical", data: [], ...base };
		if (mapping.chartType === "table") return { kind: "table", rows: [], columns: [], cells: [], rowTotals: [], columnTotals: [], total: null, ...base };
		return { kind: "series", data: [], series: [], ...base };
	}

	if (mapping.chartType === "kpi") {
		const inScope = mapping.scope
			? tasks.filter((t) => matchesScope(t, mapping.scope as DashboardScope, context))
			: tasks;
		// Toward a goal with a period, only what was finished in it counts (T-1128).
		const goal = mapping.goal ? goalWindow(mapping.goal, inScope, context) : null;
		const scoped = goal ? goal.counted : inScope;
		const value = aggregateMetric(scoped, mapping.metric, used.measure);
		return {
			kind: "kpi",
			value: value ?? 0,
			...(mapping.scope && mapping.metric === "count" && !goal ? { of: tasks.length } : {}),
			...(goal ? { goal: goal.state } : {}),
			...measureOf(mapping.metric, scoped, used.measure),
			// Toward a goal, nothing yet is a 0 to make up, not "no tasks".
			empty: goal ? false : scoped.length === 0 || value == null,
		};
	}

	if (mapping.chartType === "table") return tableData(mapping, tasks, context, used.measure);

	if (mapping.chartType === "graph") {
		const snapshot = graphOf(tasks, context);
		return { kind: "graph", snapshot, decimals: 0, empty: snapshot.counts.tasks === 0 };
	}

	if (mapping.chartType === "bar" || mapping.chartType === "pie") return barData(mapping, tasks, context, used.measure);

	// line / timeline - temporal buckets, optionally split into series. A
	// running total only adds up, so a timeline only ever counts.
	const cumulative = mapping.chartType === "timeline";
	const metric: DashboardMetric = cumulative ? "count" : (mapping.metric ?? "count");
	const measure = measureOf(metric, tasks, used.measure);
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
		mapping.groupBy ? groupKeys(task, mapping.groupBy, context) : ["__all__"];
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
					: metricLabel(metric, used.measure)
				: valueLabel(mapping.groupBy as DashboardGroupBy, key, context),
		color:
			key === "__all__"
				? COLOR_PALETTE[10]
				: colorFor(mapping.groupBy as DashboardGroupBy, key, index, context),
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
				const value = aggregateMetric(members, metric, used.measure);
				if (value != null) row[meta.key] = value;
			}
		}
		data.push(row);
	}

	return { kind: "series", data, series, ...measure, empty: false };
}
