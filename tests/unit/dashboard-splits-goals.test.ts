import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { snapshotContext } from "../../src/core/views";
import { parseDashboard, serializeDashboard } from "../../src/core/serialization/dashboards";
import {
	autoTitle,
	computeWidgetData,
	defaultFieldMapping,
	goalWindow,
	isFieldMappingValid,
	retargetFieldMapping,
} from "../../src/core/dashboards";
import type { DashboardFieldMapping, DashboardWidget, Task } from "../../src/core/types";
import type { WidgetData } from "../../src/core/dashboards/aggregate";

/** Charts split by a second grouping, tables, and goals (T-1127, T-1128). */
const snapshot = sampleSnapshot();
// A Wednesday: this week runs Monday the 19th to Sunday the 25th.
const context = { ...snapshotContext(snapshot), today: "2026-10-21" };
const [base] = snapshot.tasks;
const task = (id: string, over: Partial<Task>): Task => ({ ...base, id, path: id, title: id, labels: [], completedAt: null, ...over });

const tasks: Task[] = [
	task("t1", { assignee: "trey", project: "algebra", status: "done", completedAt: "2026-10-20T15:00:00Z", labels: ["a", "b"] }),
	task("t2", { assignee: "trey", project: "algebra", status: "done", completedAt: "2026-10-12T15:00:00Z", labels: ["a"] }),
	task("t3", { assignee: "trey", project: "biology", status: "todo" }),
	task("t4", { assignee: "aj", project: "math", status: "done", completedAt: "2026-10-22T09:00:00Z" }),
	task("t5", { assignee: "aj", project: "math", status: "done", completedAt: "2026-10-21T09:00:00Z" }),
];

const widget = (fieldMapping: DashboardFieldMapping): DashboardWidget => ({
	id: "w",
	chartType: fieldMapping.chartType,
	title: "",
	titleIsCustom: false,
	fieldMapping,
	layout: { x: 0, y: 0, w: 6, h: 4 },
});
const data = (mapping: DashboardFieldMapping) => computeWidgetData(widget(mapping), tasks, context);
type Categorical = Extract<WidgetData, { kind: "categorical" }>;
type Table = Extract<WidgetData, { kind: "table" }>;

describe("a bar split by a second grouping", () => {
	it("gives each bar its parts, one per split value, with the split values colored", () => {
		const out = data({ chartType: "bar", groupBy: "assignee", splitBy: "project" }) as Categorical;
		expect(out.splits?.map((s) => s.key)).toEqual(expect.arrayContaining(["algebra", "biology", "math"]));
		const trey = out.data.find((d) => d.key === "trey")!;
		expect(trey.value).toBe(3);
		expect(trey.parts).toEqual(expect.arrayContaining([{ key: "algebra", value: 2 }, { key: "biology", value: 1 }]));
		expect(trey.parts?.some((p) => p.key === "math")).toBe(false);
	});

	it("draws exactly as before without a split", () => {
		const out = data({ chartType: "bar", groupBy: "assignee" }) as Categorical;
		expect(out.splits).toBeUndefined();
		expect(out.data.every((d) => d.parts === undefined)).toBe(true);
	});
});

describe("a table", () => {
	it("measures each row and column, with totals that count a task once", () => {
		const out = data({ chartType: "table", rows: "assignee", columns: "label" }) as Table;
		const trey = out.rows.findIndex((r) => r.key === "trey");
		const a = out.columns.findIndex((c) => c.key === "a");
		const b = out.columns.findIndex((c) => c.key === "b");
		expect(out.cells[trey][a]).toBe(2);
		expect(out.cells[trey][b]).toBe(1);
		// t1 has two labels but is one task in Trey's row.
		expect(out.rowTotals[trey]).toBe(3);
		expect(out.total).toBe(5);
	});

	it("has one column without a second grouping", () => {
		const out = data({ chartType: "table", rows: "project", columns: null }) as Table;
		expect(out.columns).toEqual([]);
		expect(out.cells.every((row) => row.length === 1)).toBe(true);
	});
});

describe("a goal", () => {
	it("counts what was finished this week, and shows every group, at 0 when it has nothing yet", () => {
		const out = data({ chartType: "bar", groupBy: "project", goal: { amount: 2, period: "week", dueDay: 5 } }) as Categorical;
		const value = (key: string) => out.data.find((d) => d.key === key)?.value;
		expect(value("algebra")).toBe(1); // t2 was last week
		expect(value("math")).toBe(2);
		expect(value("biology")).toBe(0);
		expect(out.goal).toEqual({ amount: 2, period: "this week", due: "Fri", past: false });
	});

	it("splits toward a goal: a part per kid and class, zeros included", () => {
		const out = data({ chartType: "bar", groupBy: "assignee", splitBy: "project", goal: { amount: 2, period: "week" } }) as Categorical;
		const trey = out.data.find((d) => d.key === "trey")!;
		expect(trey.parts).toEqual(expect.arrayContaining([{ key: "algebra", value: 1 }, { key: "biology", value: 0 }]));
		expect(trey.parts?.some((p) => p.key === "math")).toBe(false);
	});

	it("says when the due day has passed", () => {
		const { state } = goalWindow({ amount: 2, period: "week", dueDay: 2 }, tasks, context);
		expect(state).toMatchObject({ due: "Tue", past: true });
	});

	it("gives a KPI its number toward the goal", () => {
		const out = data({ chartType: "kpi", metric: "count", scope: null, goal: { amount: 6, period: "week" } });
		expect(out).toMatchObject({ kind: "kpi", value: 3, goal: { amount: 6, due: "Sun" }, empty: false });
	});

	it("without a period, compares the chart's own count", () => {
		const out = data({ chartType: "kpi", metric: "count", scope: null, goal: { amount: 10 } });
		expect(out).toMatchObject({ value: 5, goal: { amount: 10 } });
	});
});

describe("settings", () => {
	it("accepts the new settings when whole, and rejects broken ones", () => {
		expect(isFieldMappingValid({ chartType: "bar", groupBy: "status", splitBy: "assignee" })).toBe(true);
		expect(isFieldMappingValid({ chartType: "bar", groupBy: "status", splitBy: "status" })).toBe(false);
		expect(isFieldMappingValid({ chartType: "bar", groupBy: "status", sideBySide: true })).toBe(false);
		expect(isFieldMappingValid({ chartType: "bar", groupBy: "status", goal: { amount: 0 } })).toBe(false);
		expect(isFieldMappingValid({ chartType: "bar", groupBy: "status", goal: { amount: 2, dueDay: 5 } })).toBe(false);
		expect(isFieldMappingValid({ chartType: "kpi", metric: "count", scope: null, goal: { amount: 2, period: "week", dueDay: 5 } })).toBe(true);
		expect(isFieldMappingValid(defaultFieldMapping("table"))).toBe(true);
	});

	it("carries a split to a table's columns and back, and a goal between bar and KPI", () => {
		const table = retargetFieldMapping({ chartType: "bar", groupBy: "assignee", splitBy: "project" }, "table");
		expect(table).toEqual({ chartType: "table", rows: "assignee", columns: "project" });
		expect(retargetFieldMapping(table, "bar")).toEqual({ chartType: "bar", groupBy: "assignee", splitBy: "project" });
		expect(retargetFieldMapping({ chartType: "bar", groupBy: "project", goal: { amount: 2, period: "week" } }, "kpi")).toEqual({
			chartType: "kpi",
			metric: "count",
			scope: null,
			goal: { amount: 2, period: "week" },
		});
		expect(retargetFieldMapping({ chartType: "bar", groupBy: "project", goal: { amount: 2 } }, "pie")).toEqual({ chartType: "pie", groupBy: "project" });
	});

	it("names them", () => {
		expect(autoTitle({ chartType: "bar", groupBy: "assignee", splitBy: "project", goal: { amount: 2, period: "week" } }, context)).toBe(
			"Tasks by Assignee, split by Project, goal 2 a week",
		);
		expect(autoTitle({ chartType: "table", rows: "assignee", columns: "taskType" }, context)).toBe("Tasks by Assignee and Type");
	});
});

describe("saved charts", () => {
	// Every kind of chart as dashboards hold them before T-1127/T-1128.
	const before: DashboardFieldMapping[] = [
		{ chartType: "bar", groupBy: "status" },
		{ chartType: "bar", groupBy: "assignee", metric: "estimateSum" },
		{ chartType: "pie", groupBy: "priority" },
		{ chartType: "line", xField: "completedAt", bucket: "week", groupBy: "assignee" },
		{ chartType: "timeline", xField: "createdAt", bucket: "month", groupBy: null },
		{ chartType: "kpi", metric: "count", scope: { field: "status", value: "done" } },
		{ chartType: "graph" },
	];
	const dashboard = (mappings: DashboardFieldMapping[]) => ({
		name: "D",
		widgets: mappings.map((fieldMapping, i) => ({ ...widget(fieldMapping), id: `w${i}`, layout: { x: 0, y: i * 4, w: 6, h: 4 } })),
	});

	it("read back exactly as they were saved, with nothing added", () => {
		const { value } = parseDashboard(dashboard(before), { path: "W/Dashboards/d" });
		expect(value.widgets.map((w) => w.fieldMapping)).toEqual(before);
		expect(serializeDashboard(value).widgets).toEqual((serializeDashboard(parseDashboard(dashboard(before), { path: "W/Dashboards/d" }).value) as { widgets: unknown }).widgets);
	});

	it("keep a split, a goal and a table through a save", () => {
		const after: DashboardFieldMapping[] = [
			{ chartType: "bar", groupBy: "assignee", splitBy: "project", sideBySide: true, goal: { amount: 2, period: "week", dueDay: 5 } },
			{ chartType: "table", rows: "assignee", columns: "label", metric: "estimateSum" },
			{ chartType: "kpi", metric: "count", scope: null, goal: { amount: 10, period: "month" } },
		];
		const saved = serializeDashboard(parseDashboard(dashboard(after), { path: "W/Dashboards/d" }).value);
		expect(parseDashboard(saved, { path: "W/Dashboards/d" }).value.widgets.map((w) => w.fieldMapping)).toEqual(after);
	});

	it("leave out a broken goal or split rather than the chart", () => {
		const { value } = parseDashboard(
			dashboard([{ chartType: "bar", groupBy: "status", splitBy: "status", goal: { amount: -1 } } as DashboardFieldMapping]),
			{ path: "W/Dashboards/d" },
		);
		expect(value.widgets[0].fieldMapping).toEqual({ chartType: "bar", groupBy: "status" });
	});
});
