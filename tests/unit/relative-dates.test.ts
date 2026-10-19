import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { indexKindItems, matchesKindQuery, parseFilterQuery, parseKindQuery, parseQuery, printQuery, queryContext, type KindItem } from "../../src/core/query";
import { dateSpan, isRelativeDateValue, normalizeDateValue, todayIn } from "../../src/core/relative-dates";
import { applyFilters, defaultViews, evaluateView, snapshotContext } from "../../src/core/views";
import { countTasks, taskRows } from "../../src/core/mcp";
import type { CustomFieldDef, WorkspaceSnapshot } from "../../src/core/types";
import { task } from "./fixtures";

/** A Monday. */
const TODAY = "2026-10-19";

describe("date values (T-0950)", () => {
	it("reads days, words, offsets, periods and ranges as spans", () => {
		expect(dateSpan("2026-10-01", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-01" });
		expect(dateSpan("today", TODAY)).toEqual({ from: TODAY, to: TODAY });
		expect(dateSpan("yesterday", TODAY)?.from).toBe("2026-10-18");
		expect(dateSpan("tomorrow", TODAY)?.from).toBe("2026-10-20");
		expect(dateSpan("today-28d", TODAY)?.from).toBe("2026-09-21");
		expect(dateSpan("today+2w", TODAY)?.from).toBe("2026-11-02");
		expect(dateSpan("today-1m", TODAY)?.from).toBe("2026-09-19");
		expect(dateSpan("today+1y", TODAY)?.from).toBe("2027-10-19");
		expect(dateSpan("tomorrow+1d", TODAY)?.from).toBe("2026-10-21");
		expect(dateSpan("this-week", TODAY)).toEqual({ from: "2026-10-19", to: "2026-10-25" });
		expect(dateSpan("last-week", "2026-10-25")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
		expect(dateSpan("next-week", TODAY)).toEqual({ from: "2026-10-26", to: "2026-11-01" });
		expect(dateSpan("this-month", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
		expect(dateSpan("last-month", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
		expect(dateSpan("next-month", "2026-12-15")).toEqual({ from: "2027-01-01", to: "2027-01-31" });
		expect(dateSpan("this-quarter", TODAY)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
		expect(dateSpan("last-quarter", TODAY)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
		expect(dateSpan("this-year", TODAY)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
		expect(dateSpan("last-7-days", TODAY)).toEqual({ from: "2026-10-13", to: TODAY });
		expect(dateSpan("next-7-days", TODAY)).toEqual({ from: TODAY, to: "2026-10-25" });
		expect(dateSpan("last-1-month", TODAY)).toEqual({ from: "2026-09-20", to: TODAY });
		expect(dateSpan("2026-10-01..2026-10-31", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
		expect(dateSpan("today-7d..today", TODAY)).toEqual({ from: "2026-10-12", to: TODAY });
		expect(dateSpan("last-week..this-week", TODAY)).toEqual({ from: "2026-10-12", to: "2026-10-25" });
	});

	it("keeps month ends in shorter months", () => {
		expect(dateSpan("today+1m", "2026-01-31")?.from).toBe("2026-02-28");
		expect(dateSpan("today-1y", "2028-02-29")?.from).toBe("2027-02-28");
	});

	it("normalizes what it reads and turns away what it doesn't", () => {
		expect(normalizeDateValue(" Today ")).toBe("today");
		expect(normalizeDateValue("TODAY-28D")).toBe("today-28d");
		expect(normalizeDateValue("2026-10-01 .. 2026-10-31")).toBe("2026-10-01..2026-10-31");
		for (const bad of ["", "soon", "today-d", "today-28x", "2026-02-30", "last-0-days", "..today", "a..b..c", "this-fortnight"]) {
			expect(normalizeDateValue(bad)).toBeNull();
		}
		expect(isRelativeDateValue("2026-10-01")).toBe(false);
		expect(isRelativeDateValue("2026-10-01..2026-10-31")).toBe(false);
		expect(isRelativeDateValue("today")).toBe(true);
		expect(isRelativeDateValue("2026-10-01..today")).toBe(true);
	});

	it("finds today in a time zone", () => {
		const late = new Date("2026-10-20T03:30:00Z");
		expect(todayIn("America/Chicago", late)).toBe("2026-10-19");
		expect(todayIn("Asia/Tokyo", late)).toBe("2026-10-20");
		expect(todayIn("Not/AZone", late)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

const fields: CustomFieldDef[] = [{ id: "f-follow", key: "CF-0001", slug: "follow-up", name: "Follow up", type: "date" }];

function dated(): WorkspaceSnapshot {
	const base = sampleSnapshot();
	return {
		...base,
		customFields: fields,
		tasks: [
			task({ path: "past", id: "T-1", status: "todo", dueDate: "2026-10-10", createdAt: "2026-09-01T10:00:00.000Z", fields: { "f-follow": "2026-10-18" } }),
			task({ path: "today", id: "T-2", status: "todo", dueDate: TODAY, createdAt: "2026-10-19T09:00:00.000Z", fields: { "f-follow": TODAY } }),
			task({ path: "soon", id: "T-3", status: "todo", dueDate: "2026-10-23", createdAt: "2026-10-14T09:00:00.000Z" }),
			task({ path: "later", id: "T-4", status: "todo", dueDate: "2026-11-20" }),
			task({ path: "done", id: "T-5", status: "done", dueDate: "2026-10-01" }),
			task({ path: "none", id: "T-6", status: "todo" }),
		],
	};
}

describe("relative dates in queries", () => {
	const snapshot = dated();
	const ctx = queryContext(snapshot);
	const at = (today: string) => ({ ...snapshotContext(snapshot), today });
	const paths = (query: string, today = TODAY) => {
		const parsed = parseQuery(query, ctx);
		expect(parsed.issues.filter((issue) => issue.severity === "error")).toEqual([]);
		return applyFilters(snapshot.tasks, parsed.definition.filters, at(today))
			.map((t) => t.path)
			.sort();
	};

	it("matches against the day the query runs", () => {
		expect(paths("due-before:today")).toEqual(["done", "past"]);
		expect(paths("due:today")).toEqual(["today"]);
		expect(paths("due-after:today")).toEqual(["later", "soon"]);
		// The same saved query, a week later.
		expect(paths("due-before:today", "2026-10-26")).toEqual(["done", "past", "soon", "today"]);
	});

	it("matches periods and ranges, and their bounds", () => {
		expect(paths("due:this-week")).toEqual(["soon", "today"]);
		expect(paths("due-before:this-week")).toEqual(["done", "past"]);
		expect(paths("due-after:this-week")).toEqual(["later"]);
		expect(paths("due:2026-10-01..2026-10-19")).toEqual(["done", "past", "today"]);
		expect(paths("due:today..today+7d")).toEqual(["soon", "today"]);
		expect(paths("-due:this-month")).toEqual(["later", "none"]);
		expect(paths("due:this-week,next-month")).toEqual(["later", "soon", "today"]);
		expect(paths("created:last-7-days")).toEqual(["soon", "today"]);
		// The others were made on the fixtures' 2026-01-01.
		expect(paths("created-before:today-28d")).toEqual(["done", "later", "none", "past"]);
	});

	it("reads custom date fields the same way", () => {
		expect(paths("custom.follow-up:<today")).toEqual(["past"]);
		expect(paths("custom.follow-up:<=today")).toEqual(["past", "today"]);
		expect(paths("custom.follow-up:this-week")).toEqual(["today"]);
		expect(paths("custom.follow-up:>last-week")).toEqual(["today"]);
		expect(paths("custom.follow-up:2026-10-18")).toEqual(["past"]);
	});

	it("finds overdue work: open and due before today", () => {
		expect(paths("is:overdue")).toEqual(["past"]);
		expect(paths("is:overdue", "2026-10-24")).toEqual(["past", "soon", "today"]);
	});

	it("prints the words back as written, so a saved view keeps them", () => {
		const round = (query: string) => printQuery(parseQuery(query, ctx).definition, ctx);
		expect(round("due-before:Today")).toContain("due-before:today");
		expect(round("due:this-week,today+7d")).toContain("due:this-week,today+7d");
		expect(round("due:2026-10-01..2026-10-31")).toContain("due:2026-10-01..2026-10-31");
		expect(round("is:overdue")).toContain("is:overdue");
		expect(round("custom.follow-up:<today-1w")).toContain("custom.follow-up:<today-1w");
		expect(parseQuery(round("due-before:today is:overdue"), ctx).definition.filters).toEqual(parseQuery("due-before:today is:overdue", ctx).definition.filters);
	});

	it("turns away dates it can't read", () => {
		const bound = parseQuery("due-before:soon", ctx);
		expect(bound.ok).toBe(false);
		expect(bound.issues[0].message).toContain("today-7d");
		// An exact-day value it can't read is kept, with a warning, as before.
		const exact = parseQuery("due:someday", ctx);
		expect(exact.issues[0].severity).toBe("warning");
		expect(parseFilterQuery("is:overdue due:last-month", ctx).ok).toBe(true);
	});
});

describe("relative dates across kinds", () => {
	const items: KindItem[] = [
		{ kind: "project", key: "P-0001", name: "Old", fields: { created: "2026-09-01T10:00:00Z" } },
		{ kind: "project", key: "P-0002", name: "New", fields: { created: "2026-10-20T10:00:00Z" } },
	];
	const context = { index: indexKindItems(items), today: TODAY };
	const keys = (source: string) => items.filter((item) => matchesKindQuery(item, parseKindQuery(source).query, context)).map((item) => item.key);

	it("reads today, periods and ranges on every kind's dates", () => {
		expect(keys("created-before:today")).toEqual(["P-0001"]);
		expect(keys("created:this-week")).toEqual(["P-0002"]);
		expect(keys("created-after:last-month")).toEqual(["P-0002"]);
		expect(keys("created:2026-08-01..2026-09-30")).toEqual(["P-0001"]);
	});
});

describe("relative dates where the asker's day is passed in", () => {
	const snapshot = dated();
	const ctx = queryContext(snapshot);
	const filters = parseQuery("due-before:today", ctx).definition.filters;

	it("taskRows, countTasks and evaluateView read against it", () => {
		expect(taskRows(snapshot, filters, null, false, { today: "2026-10-12" }).map((row) => row.path).sort()).toEqual(["done", "past"]);
		expect(taskRows(snapshot, filters, null, false, { today: "2026-10-30" }).map((row) => row.path).sort()).toEqual(["done", "past", "soon", "today"]);
		expect(countTasks(snapshot, filters, null, false, [], "2026-10-12").total).toBe(2);
		const view = { ...defaultViews()[0], filters };
		expect(evaluateView(snapshot, view, snapshotContext(snapshot), "2026-10-30").total).toBe(4);
	});
});
