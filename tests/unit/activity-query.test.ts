import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { queryContext, type QueryContext } from "../../src/core/query";
import {
	activityItemFilters,
	activityItemScopeActive,
	activityListDelta,
	activityQueriesEqual,
	parseActivityQuery,
	printActivityQuery,
	type ActivityQuery,
} from "../../src/core/activity";
import { NONE, SELF } from "../../src/core/types";

const snapshot = sampleSnapshot();
const ctx: QueryContext = {
	...queryContext(snapshot),
	people: [
		{ id: "u1", name: "Allan", email: "allan@example.com" },
		{ id: "u2", name: "Bea", email: "bea@example.com" },
	],
	selfId: "u1",
};
const status = snapshot.workspace.statuses[0];
const label = snapshot.workspace.labels[0];

function expectRoundTrip(query: ActivityQuery) {
	const source = printActivityQuery(query, ctx);
	const parsed = parseActivityQuery(source, ctx);
	expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
	expect(activityQueriesEqual(parsed.query, query)).toBe(true);
}

describe("parseActivityQuery", () => {
	it("splits task clauses from activity clauses", () => {
		const parsed = parseActivityQuery(`status:${status.id} activityBy:me activityAction:trashed,restored`, ctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.query.items.status).toEqual([status.id]);
		expect(parsed.query.activity).toEqual({ by: [SELF], action: ["trash", "restore"] });
	});

	it("resolves people by email, name, `me` and `system`", () => {
		const parsed = parseActivityQuery("activityBy:bea@example.com,Allan,system", ctx);
		expect(parsed.query.activity.by).toEqual(["u2", "u1", NONE]);
		expect(parsed.ok).toBe(true);
	});

	it("knows a table's fields", () => {
		const parsed = parseActivityQuery("activityField:rows,cells,column,table-views", ctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.query.activity.field).toEqual(["rows", "cell", "column", "tableViews"]);
	});

	it("excludes with a leading minus", () => {
		const parsed = parseActivityQuery("-activityBy:me -activityItem:label", ctx);
		expect(parsed.query.activity).toEqual({ notBy: [SELF], notKind: ["label"] });
	});

	it("resolves activityTo:/activityFrom: against the one field named, wherever it is", () => {
		const parsed = parseActivityQuery(`activityTo:"${status.name}" activityField:status`, ctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.query.activity).toEqual({ field: ["status"], to: [status.id] });
		const labels = parseActivityQuery(`activityField:labels activityFrom:"${label.name}"`, ctx);
		expect(labels.query.activity.from).toEqual([label.id]);
	});

	it("refuses activityTo: without exactly one nameable field", () => {
		expect(parseActivityQuery("activityTo:done", ctx).ok).toBe(false);
		expect(parseActivityQuery("activityField:status,priority activityTo:done", ctx).ok).toBe(false);
		expect(parseActivityQuery("activityField:title activityTo:hello", ctx).ok).toBe(false);
	});

	it("takes date bounds and rejects bad dates", () => {
		const parsed = parseActivityQuery("activity-after:2026-09-01 activity-before:2026-10-01", ctx);
		expect(parsed.query.activity).toEqual({ after: "2026-09-01", before: "2026-10-01" });
		expect(parseActivityQuery("activity-after:last-week", ctx).ok).toBe(false);
	});

	it("flags unknown values and layout clauses", () => {
		expect(parseActivityQuery("activityAction:exploded", ctx).ok).toBe(false);
		expect(parseActivityQuery("activityItem:spaceship", ctx).ok).toBe(false);
		expect(parseActivityQuery("group:status", ctx).ok).toBe(false);
	});

	it("suggests an activity field for a typo", () => {
		const parsed = parseActivityQuery("activityBi:me", ctx);
		expect(parsed.ok).toBe(false);
		expect(parsed.issues[0].suggestion).toBe("activityby");
	});

	it("keeps error spans pointing into the original text", () => {
		const source = "activityBy:me staus:x";
		const issue = parseActivityQuery(source, ctx).issues.find((i) => i.code === "unknown-field")!;
		expect(source.slice(issue.span.start, issue.span.end)).toBe("staus");
	});
});

describe("printActivityQuery", () => {
	it("round-trips every clause", () => {
		expectRoundTrip({
			items: { status: [status.id], labels: [label.id] },
			activity: {
				by: [SELF, "u2", NONE],
				notAction: ["comment"],
				field: ["status"],
				from: [status.id],
				to: [snapshot.workspace.statuses[1].id],
				kind: ["task"],
				after: "2026-09-01",
				before: "2026-10-01",
			},
		});
		expectRoundTrip({ items: {}, activity: { action: ["delete"], notBy: [SELF] } });
		expectRoundTrip({ items: {}, activity: {} });
	});

	it("prints people by email and the system by keyword", () => {
		const text = printActivityQuery({ items: {}, activity: { by: ["u2", NONE] } }, ctx);
		expect(text).toBe("activityBy:bea@example.com,system");
	});

	it("spells out someone called system verbatim", () => {
		const context = { ...ctx, people: [{ id: "u9", name: "system" }] };
		const text = printActivityQuery({ items: {}, activity: { by: ["u9"] } }, context);
		expect(parseActivityQuery(text, context).query.activity.by).toEqual(["u9"]);
	});
});

describe("item scope", () => {
	it("ignores archived alone, and includes archived tasks by default", () => {
		expect(activityItemScopeActive({})).toBe(false);
		expect(activityItemScopeActive({ archived: "only" })).toBe(false);
		expect(activityItemScopeActive({ labels: ["x"] })).toBe(true);
		expect(activityItemFilters({}).archived).toBe("included");
		expect(activityItemFilters({ archived: "only" }).archived).toBe("only");
	});
});

describe("activityListDelta", () => {
	it("derives what was added and removed", () => {
		const a = { id: "a", name: "A" };
		const b = { id: "b", name: "B" };
		const c = { id: "c", name: "C" };
		expect(activityListDelta([a, b], [b, c])).toEqual({ added: [c], removed: [a] });
		expect(activityListDelta(null, [a])).toEqual({ added: [a], removed: [] });
	});
});

describe("dashboard fields", () => {
	it("parse and print", () => {
		const parsed = parseActivityQuery("activityItem:dashboard activityField:charts,chart,chart-layout,filter", ctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.query.activity.field).toEqual(["charts", "chart", "chartLayout", "filter"]);
		expectRoundTrip(parsed.query);
	});
});
